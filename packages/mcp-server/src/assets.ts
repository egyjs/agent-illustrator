import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Directory holding agent-kit content.
 * Published: dist/cli.mjs → dist/agent-kit/ (copied by tsdown).
 * Source:    src/assets.ts → ../../agent-kit/content/ (workspace package).
 */
export function agentKitDir(): string {
  const candidates = [
    new URL('./agent-kit/', import.meta.url),
    new URL('../../agent-kit/content/', import.meta.url),
  ].map((url) => fileURLToPath(url));
  const found = candidates.find((dir) => existsSync(dir));
  if (found === undefined) {
    throw new Error(`agent-kit content not found; looked in: ${candidates.join(', ')}`);
  }
  return found;
}
