import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { PATHS } from '../src/paths.ts';
import { baselinePath, fixtureNames, fixturePath, renderFixture } from '../src/regression.ts';

/** Share of pixels allowed to differ; antialiasing varies a little between operating systems. */
const MAX_DIFF = 0.005;
const names = fixtureNames();

/** Writes the actual render and a diff image under `eval/runs/regression/`, returns the diff's path. */
function saveFailure(name: string, actual: Uint8Array, diff?: PNG): string {
  const dir = `${PATHS.runs}regression/`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}${name}-actual.png`, actual);
  if (diff) writeFileSync(`${dir}${name}-diff.png`, PNG.sync.write(diff));
  return `${dir}${name}-${diff ? 'diff' : 'actual'}.png`;
}

describe('render regression', () => {
  it('has fixtures', () => {
    expect(names.length).toBeGreaterThanOrEqual(10);
  });

  describe.each(names)('%s', (name) => {
    const fix = `to accept the change, run: pnpm --filter @agent-illustrator/eval baselines ${name}`;

    it('renders the same pixels twice', () => {
      const a = renderFixture(fixturePath(name));
      const b = renderFixture(fixturePath(name));
      expect(Buffer.compare(a.pixels, b.pixels)).toBe(0);
    });

    it('matches its baseline', () => {
      if (!existsSync(baselinePath(name))) expect.fail(`no baseline ${baselinePath(name)}; ${fix}`);
      const actual = renderFixture(fixturePath(name));
      const expected = PNG.sync.read(readFileSync(baselinePath(name)));
      if (expected.width !== actual.width || expected.height !== actual.height) {
        const saved = saveFailure(name, actual.png);
        expect.fail(`${name} renders ${actual.width}x${actual.height}, its baseline is ${expected.width}x${expected.height} (actual: ${saved}); ${fix}`);
      }
      const diff = new PNG({ width: actual.width, height: actual.height });
      const differing = pixelmatch(actual.pixels, expected.data, diff.data, actual.width, actual.height, { threshold: 0.1 });
      const share = differing / (actual.width * actual.height);
      if (share > MAX_DIFF) {
        const saved = saveFailure(name, actual.png, diff);
        expect.fail(`${name}: ${differing} pixels differ (${(share * 100).toFixed(2)}%, limit ${MAX_DIFF * 100}%); diff: ${saved}; ${fix}`);
      }
    });
  });
});
