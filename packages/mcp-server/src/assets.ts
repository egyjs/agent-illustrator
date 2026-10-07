import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Files the published package must carry; `--doctor` checks each one. */
export const REQUIRED_AGENT_KIT_FILES = ['core-contract.md', 'guides/README.md'] as const;

/**
 * Directory holding agent-kit content.
 * Published: dist/cli.mjs → dist/agent-kit/content/ (tsdown copies the folder recursively).
 * A bundle never falls back to the workspace, so a broken copy fails loudly instead of passing in the repo.
 * Source:    src/assets.ts → ../../agent-kit/content/ (workspace package; dev and tests only).
 */
export function agentKitDir(moduleUrl: string = import.meta.url): string {
  const urls = [new URL('./agent-kit/content/', moduleUrl)];
  if (moduleUrl.endsWith('.ts')) urls.push(new URL('../../agent-kit/content/', moduleUrl));
  const candidates = urls.map((url) => fileURLToPath(url));
  const found = candidates.find((dir) => existsSync(dir));
  if (found === undefined) {
    throw new Error(`agent-kit content not found; looked in: ${candidates.join(', ')}`);
  }
  return found;
}
