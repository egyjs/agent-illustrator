import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentKitDir } from '../src/assets.ts';

describe('agentKitDir', () => {
  it('finds the workspace agent-kit content when running from source', () => {
    expect(existsSync(join(agentKitDir(), 'core-contract.md'))).toBe(true);
  });
});
