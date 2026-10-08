import type { Rng } from './rng.ts';

export type Area = { x: number; y: number; width: number; height: number };

/** Most grid cells the sampler will allocate. */
const MAX_CELLS = 4_000_000;

/**
 * Poisson-disk samples (Bridson): points in `area` for which `inside` holds, no two closer than `r`.
 * Stops when no active point can place another, or at `maxPoints`. Throws a RangeError when `r` is
 * so small for the area that the lookup grid would be huge.
 */
export function poissonDisk(rng: Rng, area: Area, r: number, inside: (x: number, y: number) => boolean, maxPoints: number, k = 30): [number, number][] {
  if (!(r > 0)) throw new RangeError('min_distance must be > 0');
  const cell = r / Math.SQRT2;
  const cols = Math.max(1, Math.ceil(area.width / cell));
  const rows = Math.max(1, Math.ceil(area.height / cell));
  if (cols * rows > MAX_CELLS) throw new RangeError('min_distance is too small for this area; raise it');
  const points: [number, number][] = [];
  if (maxPoints < 1) return points;

  // One point per cell at most, since a cell's diagonal is r. Holds the point's index, or -1.
  const grid = new Int32Array(cols * rows).fill(-1);
  const colOf = (x: number) => Math.min(cols - 1, Math.floor((x - area.x) / cell));
  const rowOf = (y: number) => Math.min(rows - 1, Math.floor((y - area.y) / cell));
  const inArea = (x: number, y: number) => x >= area.x && y >= area.y && x < area.x + area.width && y < area.y + area.height;
  const far = (x: number, y: number): boolean => {
    const c = colOf(x), rw = rowOf(y);
    for (let j = Math.max(0, rw - 2); j <= Math.min(rows - 1, rw + 2); j++) {
      for (let i = Math.max(0, c - 2); i <= Math.min(cols - 1, c + 2); i++) {
        const p = points[grid[j * cols + i]!];
        if (p && (p[0] - x) ** 2 + (p[1] - y) ** 2 < r * r) return false;
      }
    }
    return true;
  };

  const active: number[] = [];
  const add = (x: number, y: number) => {
    grid[rowOf(y) * cols + colOf(x)] = points.length;
    active.push(points.length);
    points.push([x, y]);
  };

  for (let tries = 0; tries < 100 && points.length === 0; tries++) {
    const x = area.x + rng() * area.width, y = area.y + rng() * area.height;
    if (inArea(x, y) && inside(x, y)) add(x, y);
  }
  while (active.length > 0 && points.length < maxPoints) {
    const at = Math.floor(rng() * active.length);
    const [px, py] = points[active[at]!]!;
    let placed = false;
    for (let n = 0; n < k && !placed; n++) {
      // Uniform over the ring between r and 2r around the active point.
      const angle = rng() * 2 * Math.PI, dist = r * Math.sqrt(1 + 3 * rng());
      const x = px + dist * Math.cos(angle), y = py + dist * Math.sin(angle);
      // `far` is cheap and `inside` may be a point-in-shape test, so it goes last.
      if (inArea(x, y) && far(x, y) && inside(x, y)) {
        add(x, y);
        placed = true;
      }
    }
    if (!placed) {
      active[at] = active[active.length - 1]!;
      active.pop();
    }
  }
  return points;
}
