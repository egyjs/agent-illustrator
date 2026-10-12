import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRegistry, EngineError } from '@agent-illustrator/engine';
import { describe, expect, it } from 'vitest';
import { loadAgentKit } from '../src/agent-kit.ts';
import { fontFiles } from '../src/assets.ts';
import { loadConfig } from '../src/config.ts';
import { guideTool, illustratePrompt } from '../src/guide-tool.ts';
import { imageSource } from '../src/images.ts';
import { createLogger } from '../src/logging.ts';
import { MemorySessionStore } from '../src/sessions.ts';
import type { ToolDeps, ToolResult } from '../src/tools.ts';

const files: Record<string, string> = {
  'core-contract.md': '# Contract\nUse the tools.\n',
  'workflow.md': '# Workflow: plan, block in, detail, critique\n1. Plan.\n',
  'guides/README.md': '# About the guides\n',
  'guides/color.md': '# Color: palettes, tokens and gradients\nStart from `palette`.\n',
  'overlays/text-only.md': '# Text-only models\nSkip render; read describe_scene.\n',
  'presets/flat.yaml': 'name: flat\ndescription: Flat shapes, no outlines.\nrules:\n  - No strokes.\n',
  'presets/line-art.yaml': 'name: line-art\ndescription: >\n  Strokes only,\n  no fills.\n',
  'prompts/illustrate.md': 'Brief: {{brief}}\nPreset: {{preset}}\nOverlay: {{overlay}}\nExport at the end.\n',
};
const dir = mkdtempSync(join(tmpdir(), 'ai-guide-'));
for (const [file, body] of Object.entries(files)) {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), body);
}
const kit = loadAgentKit(dir);
const config = loadConfig({});
const deps: ToolDeps = { sessions: new MemorySessionStore(config.maxDocuments), registry: createRegistry(), config, fonts: fontFiles(), images: imageSource(), log: createLogger('silent') };

const body = (r: ToolResult) => (r.content[0] as { text: string }).text;
const guide = (args: unknown) => guideTool(deps, kit, args);
const error = (r: ToolResult) => (JSON.parse(body(r)) as { error: { code: string; message: string; hint: string } }).error;

describe('guide tool', () => {
  it('without a topic lists every topic with its description', () => {
    const r = guide({});
    expect(r.isError).toBeUndefined();
    expect(body(r)).toBe(
      [
        'Topics (pass one as `topic`):',
        'workflow - Workflow: plan, block in, detail, critique',
        'color - Color: palettes, tokens and gradients',
        'text-only - Text-only models',
        'ops - every op by domain with its signature',
        'op:<name> - one op in full: fields, defaults, examples',
        'presets - the style presets',
        'preset:<name> - one style preset as YAML',
      ].join('\n'),
    );
  });

  it('returns a guide or an overlay as written, whatever the case or spacing of the topic', () => {
    expect(body(guide({ topic: 'workflow' }))).toBe(files['workflow.md']);
    expect(body(guide({ topic: ' Color ' }))).toBe(files['guides/color.md']);
    expect(body(guide({ topic: 'text-only' }))).toBe(files['overlays/text-only.md']);
  });

  it('ops lists every registered op once, grouped by domain, with a signature and a first sentence', () => {
    const text = body(guide({ topic: 'ops' }));
    const registry = createRegistry();
    for (const name of registry.names()) expect(text.match(new RegExp(`^${name}\\(`, 'gm'))).toHaveLength(1);
    for (const domain of new Set(registry.list().map((def) => def.domain))) expect(text).toContain(`## ${domain}\n`);
    expect(text).toContain('rect(x, y, width, height, id?, parent?, style?, radius?) - Rectangle from its top-left corner (x, y), width and height, with optional rounded corners (radius, clamped to half the shorter side).');
  });

  it('op:<name> shows the fields with types and every example as JSON', () => {
    const text = body(guide({ topic: 'op:rect' }));
    expect(text).toContain('rect (shapes)\nRectangle from its top-left corner');
    expect(text).toContain('- x: number | "N%"');
    expect(text).toContain('- radius?: number | "N%"');
    expect(text).toContain('- style?: { fill?: ');
    for (const example of createRegistry().get('rect')!.examples) expect(text).toContain(JSON.stringify(example));
  });

  it('op:<name> works for every registered op', () => {
    const registry = createRegistry();
    for (const def of registry.list()) {
      const r = guide({ topic: `op:${def.name}` });
      expect(r.isError, def.name).toBeUndefined();
      expect(body(r), def.name).toContain(`${def.name} (${def.domain})`);
      expect(body(r), def.name).not.toContain('undefined');
    }
  });

  it('lists presets with their descriptions and returns one as YAML', () => {
    expect(body(guide({ topic: 'presets' }))).toBe('Style presets. Guide topic "preset:<name>" returns one as YAML.\nflat - Flat shapes, no outlines.\nline-art - Strokes only, no fills.');
    expect(body(guide({ topic: 'preset:flat' }))).toBe(files['presets/flat.yaml']);
  });

  it('answers an unknown topic with suggestions and the index', () => {
    const r = guide({ topic: 'colour' });
    expect(r.isError).toBe(true);
    expect(error(r)).toMatchObject({ code: 'invalid_input', message: 'guide: unknown topic "colour"' });
    expect(error(r).hint).toMatch(/^Did you mean "color"\?\n\nTopics/);
    expect(error(r).hint).toContain('workflow - Workflow: plan, block in, detail, critique');
    expect(error(guide({ topic: 'op:elipse' })).hint).toMatch(/^Did you mean "op:ellipse"/);
    expect(error(guide({ topic: 'zzzzzzzz' })).hint).toMatch(/^Topics /);
  });

  it('rejects input of the wrong shape with an example', () => {
    const r = guide({ topic: 3 });
    expect(r.isError).toBe(true);
    expect(error(r)).toMatchObject({ code: 'invalid_input' });
    expect(error(r).hint).toContain('Example');
  });

  it('refuses a topic over 200 characters before looking for it', () => {
    expect(guide({ topic: 'x'.repeat(200) }).isError).toBe(true);
    const r = guide({ topic: 'x'.repeat(201) });
    expect(error(r)).toMatchObject({ code: 'invalid_input' });
    expect(error(r).message).toContain('guide:');
    expect(error(r).message).not.toContain('xxxxxxxxxx');
    expect(error(r).hint).toContain('Example');
  });
});

describe('illustrate prompt', () => {
  const template = kit.prompt!;
  const run = (args: Parameters<typeof illustratePrompt>[2]) => illustratePrompt(kit, template, args).messages[0]!.content.text;

  it('fills in the brief, the preset YAML and no overlay by default', () => {
    expect(run({ brief: 'a red fox at dusk', style: 'flat' })).toBe(`Brief: a red fox at dusk\nPreset: ${files['presets/flat.yaml']}\nOverlay: \nExport at the end.\n`);
    expect(run({ brief: 'a fox', vision: 'yes' })).toBe('Brief: a fox\nPreset: none\nOverlay: \nExport at the end.\n');
  });

  it('adds the text-only overlay when the model cannot see images', () => {
    expect(run({ brief: 'a fox', vision: 'no' })).toContain(`Overlay: ${files['overlays/text-only.md']}`);
  });

  it('leaves placeholder syntax and replacement patterns in the brief alone', () => {
    expect(run({ brief: '{{preset}} costs $& and $1', style: 'flat' })).toContain('Brief: {{preset}} costs $& and $1\nPreset: name: flat');
  });

  it('names the presets when the style is unknown', () => {
    const attempt = () => run({ brief: 'a fox', style: 'neon' });
    expect(attempt).toThrow(EngineError);
    expect(attempt).toThrow('unknown style "neon"; presets: flat, line-art');
  });
});
