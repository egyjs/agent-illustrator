import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PATHS } from '../src/paths.ts';

describe('eval paths', () => {
  it('point at the repo root and the bundled fonts', () => {
    expect(existsSync(`${PATHS.root}package.json`)).toBe(true);
    for (const f of PATHS.fonts) expect(existsSync(f)).toBe(true);
  });
});
