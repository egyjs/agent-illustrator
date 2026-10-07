import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentKitDir } from '../src/assets.ts';

describe('agentKitDir', () => {
  it('finds the workspace agent-kit content when running from source', () => {
    expect(existsSync(join(agentKitDir(), 'core-contract.md'))).toBe(true);
  });

  it('never falls back to workspace source when running from a bundle', () => {
    // A bundle at packages/mcp-server/nodist/cli.mjs with no copied content: ../../agent-kit/content
    // exists in the repo, so a source fallback would hide a broken publish.
    const bundleWithoutContent = new URL('../nodist/cli.mjs', import.meta.url).href;
    expect(() => agentKitDir(bundleWithoutContent)).toThrow(/agent-kit content not found/);
  });
});
