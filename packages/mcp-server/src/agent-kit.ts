import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { agentKitDir } from './assets.ts';

/** The agent-kit content (FR-13), read once at startup. Maps are keyed by topic name and ordered by file name. */
export type AgentKit = {
  /** core-contract.md: sent to the client as the server instructions. */
  readonly instructions: string;
  /** workflow.md as `workflow`, then every guides/*.md except README.md. */
  readonly guides: ReadonlyMap<string, string>;
  /** presets/*.yaml: style presets as YAML text. */
  readonly presets: ReadonlyMap<string, string>;
  /** overlays/*.md: add-ons for particular models, such as `text-only`. */
  readonly overlays: ReadonlyMap<string, string>;
  /** prompts/illustrate.md: the template behind the `illustrate` prompt. */
  readonly prompt: string | undefined;
  /** Every content file, relative to the content directory, with `/` separators. */
  readonly files: readonly string[];
};

/** Reads the content directory. Only core-contract.md is required; the rest may be missing. */
export function loadAgentKit(dir: string = agentKitDir()): AgentKit {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
    .sort();
  if (!files.includes('core-contract.md')) throw new Error(`agent-kit content has no core-contract.md; looked in ${dir}`);
  const read = (file: string) => readFileSync(join(dir, file), 'utf8');
  const named = (pattern: RegExp): [string, string][] =>
    files.flatMap((file) => {
      const name = pattern.exec(file)?.[1];
      return name === undefined || name === 'README' ? [] : [[name, read(file)]];
    });
  return {
    instructions: read('core-contract.md'),
    guides: new Map([...named(/^(workflow)\.md$/), ...named(/^guides\/([^/]+)\.md$/)]),
    presets: new Map(named(/^presets\/([^/]+)\.yaml$/)),
    overlays: new Map(named(/^overlays\/([^/]+)\.md$/)),
    prompt: files.includes('prompts/illustrate.md') ? read('prompts/illustrate.md') : undefined,
    files,
  };
}

/** The text of the first Markdown heading, or '' when there is none. */
export function markdownTitle(markdown: string): string {
  return /^#{1,6}[ \t]+(.+?)[ \t]*$/m.exec(markdown)?.[1] ?? '';
}

/** The value of a top-level `key:` line in simple YAML: plain, quoted, or a `>` / `|` block joined into one line. '' when absent. */
export function yamlScalar(yaml: string, key: string): string {
  const lines = yaml.split(/\r?\n/);
  const at = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (at < 0) return '';
  const value = lines[at]!.slice(key.length + 1).trim();
  if (!/^[>|][+-]?$/.test(value)) return value.replace(/^(["'])(.*)\1$/, '$2');
  const block: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (!/^\s+\S/.test(line)) break;
    block.push(line.trim());
  }
  return block.join(' ');
}
