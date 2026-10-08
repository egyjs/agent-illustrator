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

const FONT_FILES = ['Tajawal-Regular.ttf', 'Tajawal-Bold.ttf'] as const;

/**
 * Bundled fonts for rendering. Published: dist/fonts/ (copied by tsdown). Source: the engine's
 * assets/fonts/ (dev and tests only). As with agentKitDir, a bundle never falls back to the workspace.
 */
export function fontFiles(moduleUrl: string = import.meta.url): { files: string[]; defaultFamily: string } {
  const dirs = [new URL('./fonts/', moduleUrl)];
  if (moduleUrl.endsWith('.ts')) dirs.push(new URL('../../engine/assets/fonts/', moduleUrl));
  const paths = dirs.map((u) => fileURLToPath(u));
  const dir = paths.find((d) => FONT_FILES.every((f) => existsSync(`${d}${f}`)));
  if (dir === undefined) throw new Error(`bundled fonts not found; looked in: ${paths.join(', ')}`);
  return { files: FONT_FILES.map((f) => `${dir}${f}`), defaultFamily: 'Tajawal' };
}
