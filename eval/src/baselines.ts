// Regenerates the render-regression baselines: `pnpm --filter @agent-illustrator/eval baselines [name…]`.
// With no names, every fixture is rendered. Review the PNGs before committing them.
import { mkdirSync, writeFileSync } from 'node:fs';
import { baselinePath, fixtureNames, fixturePath, renderFixture } from './regression.ts';
import { PATHS } from './paths.ts';

const all = fixtureNames();
const names = process.argv.slice(2);
const unknown = names.filter((n) => !all.includes(n));
if (unknown.length > 0) {
  console.error(`unknown fixture ${unknown.join(', ')}; known: ${all.join(', ')}`);
  process.exit(1);
}

mkdirSync(PATHS.baselines, { recursive: true });
for (const name of names.length > 0 ? names : all) {
  const { width, height, png } = renderFixture(fixturePath(name));
  writeFileSync(baselinePath(name), png);
  console.log(`${name}: ${width}x${height}`);
}
