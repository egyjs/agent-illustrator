import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createDocument, createRegistry, executeBatch } from '@agent-illustrator/engine';
import { describe, expect, it } from 'vitest';
import { loadAgentKit, markdownTitle, yamlScalar } from '../src/agent-kit.ts';
import { agentKitDir, fontFiles, REQUIRED_AGENT_KIT_FILES } from '../src/assets.ts';

/** Writes `files` (relative path → text) into a fresh directory and returns it. */
function writeKit(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ai-kit-'));
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), body);
  }
  return dir;
}

describe('loadAgentKit', () => {
  it('names guides, presets and overlays by file, skips README.md and lists every file', () => {
    const kit = loadAgentKit(
      writeKit({
        'core-contract.md': '# Contract\n',
        'workflow.md': '# Workflow\n',
        'guides/README.md': '# About guides\n',
        'guides/color.md': '# Color\n',
        'guides/layout.md': '# Layout\n',
        'presets/flat.yaml': 'name: flat\n',
        'overlays/text-only.md': '# Text only\n',
        'prompts/illustrate.md': 'Draw {{brief}}\n',
      }),
    );
    expect(kit.instructions).toBe('# Contract\n');
    expect([...kit.guides.keys()]).toEqual(['workflow', 'color', 'layout']);
    expect([...kit.presets.keys()]).toEqual(['flat']);
    expect([...kit.overlays.keys()]).toEqual(['text-only']);
    expect(kit.prompt).toBe('Draw {{brief}}\n');
    expect(kit.files).toEqual(['core-contract.md', 'guides/README.md', 'guides/color.md', 'guides/layout.md', 'overlays/text-only.md', 'presets/flat.yaml', 'prompts/illustrate.md', 'workflow.md']);
  });

  it('needs only core-contract.md', () => {
    const kit = loadAgentKit(writeKit({ 'core-contract.md': 'x' }));
    expect([kit.guides.size, kit.presets.size, kit.overlays.size, kit.prompt]).toEqual([0, 0, 0, undefined]);
    expect(() => loadAgentKit(writeKit({ 'workflow.md': 'x' }))).toThrow(/core-contract\.md/);
  });
});

describe('topic descriptions', () => {
  it('markdownTitle returns the first heading of any level, or an empty string', () => {
    expect(markdownTitle('intro\n\n## Layout: anchors and snapping  \n# Later')).toBe('Layout: anchors and snapping');
    expect(markdownTitle('no heading\n#hashtag')).toBe('');
  });

  it('yamlScalar reads plain, quoted and block values of top-level keys only', () => {
    expect(yamlScalar('name: flat\ndescription: Flat shapes.\n', 'description')).toBe('Flat shapes.');
    expect(yamlScalar('description: "Quoted: yes"\n', 'description')).toBe('Quoted: yes');
    expect(yamlScalar('description: >\n  Line one\n  line two\nrules:\n  - a\n', 'description')).toBe('Line one line two');
    expect(yamlScalar('defaults:\n  name: nested\n', 'name')).toBe('');
  });
});

/**
 * CI check for the agent kit (FR-13, M9): the shipped content must agree with the engine.
 * A failure here means the content names an op that does not exist or shows a batch that does not run.
 */
describe('agent-kit content', () => {
  const dir = agentKitDir();
  const kit = loadAgentKit(dir);
  const registry = createRegistry();
  const fonts = fontFiles();
  const content = kit.files.map((file) => [file, readFileSync(join(dir, file), 'utf8')] as const);
  const lines = (body: string) => body.trimEnd().split(/\r?\n/).length;
  const jsonBlocks = content.flatMap(([file, body]) => [...body.matchAll(/```json\r?\n([\s\S]*?)```/g)].map((m, i) => ({ label: `${file} block ${i + 1}`, source: m[1]! })));

  it('has the files a published package must carry', () => {
    for (const file of REQUIRED_AGENT_KIT_FILES) expect(kit.files).toContain(file);
  });

  it('keeps the server instructions at 30 lines and each guide at 80', () => {
    expect(lines(kit.instructions)).toBeLessThanOrEqual(30);
    expect([...kit.guides].filter(([, body]) => lines(body) > 80).map(([name]) => name)).toEqual([]);
  });

  it('names only registered ops', () => {
    const named = content.flatMap(([file, body]) => [...body.matchAll(/"op"\s*:\s*"([^"]+)"/g)].map((m) => ({ file, op: m[1]! })));
    expect(named.filter(({ op }) => registry.get(op) === undefined)).toEqual([]);
  });

  it('shows at least three complete batches', () => {
    expect(jsonBlocks.length).toBeGreaterThanOrEqual(3);
  });

  for (const { label, source } of jsonBlocks) {
    it(`${label} runs ok on an empty 800x600 document`, () => {
      const ops: unknown = JSON.parse(source);
      expect(Array.isArray(ops), 'a json block is one array of op calls').toBe(true);
      const result = executeBatch(registry, createDocument({ width: 800, height: 600 }), ops as unknown[], { fonts });
      expect(result.ok, JSON.stringify(result.results.filter((r) => r.status === 'error'))).toBe(true);
    });
  }

  it('gives every preset a name and a description', () => {
    for (const [file, yaml] of kit.presets) {
      expect({ file, name: yamlScalar(yaml, 'name') }).toEqual({ file, name: file });
      expect({ file, described: yamlScalar(yaml, 'description') !== '' }).toEqual({ file, described: true });
    }
  });
});
