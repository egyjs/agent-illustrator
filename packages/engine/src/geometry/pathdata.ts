import { arcToCubics, line, quadToCubic } from './paths.ts';
import type { Seg, Subpath, Vec2 } from './types.ts';

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
const SEPARATORS = /[\s,]*/y;
const COMMANDS = 'MmZzLlHhVvCcSsQqTtAa';

/**
 * SVG path data → cubic subpaths (FR-3.3). Handles every command in absolute and relative form,
 * implicit repeats (after M they are L), S/T reflection and compact arc flags ("a5 5 0 0110 0").
 * A subpath that only moves draws nothing and is dropped. Throws RangeError naming the position.
 */
export function parsePathData(d: string): Subpath[] {
  let i = 0;
  const skip = (): void => {
    SEPARATORS.lastIndex = i;
    SEPARATORS.exec(d);
    i = SEPARATORS.lastIndex;
  };
  const fail = (what: string): never => {
    throw new RangeError(`path data: expected ${what} at position ${i}${i < d.length ? ` ("${d[i]}")` : ' (end)'}`);
  };
  const num = (): number => {
    skip();
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(d);
    if (!m) return fail('a number');
    const value = Number(m[0]);
    if (!Number.isFinite(value)) return fail('a finite number');
    i = NUMBER.lastIndex;
    return value;
  };
  const flag = (): boolean => {
    skip();
    const c = d[i];
    if (c !== '0' && c !== '1') return fail('an arc flag (0 or 1)');
    i++;
    return c === '1';
  };
  const atNumber = (): boolean => {
    NUMBER.lastIndex = i;
    return NUMBER.test(d);
  };

  skip();
  if (i >= d.length) throw new RangeError('path data is empty');
  if (d[i] !== 'M' && d[i] !== 'm') fail('"M" to start the path');

  const out: Subpath[] = [];
  let segs: Seg[] = [];
  let start: Vec2 = [0, 0];
  let open = false;
  let x = 0, y = 0;
  let c2x = 0, c2y = 0; // second control of the last cubic, for S
  let qx = 0, qy = 0; // control of the last quadratic, for T
  let cmd = '';
  let prev = '';
  const begin = (): void => {
    if (open) return;
    start = [x, y];
    segs = [];
    open = true;
  };
  const finish = (closed: boolean): void => {
    if (open && segs.length > 0) out.push({ start, segs, closed });
    segs = [];
    open = false;
  };

  for (;;) {
    skip();
    if (i >= d.length) break;
    const c = d[i]!;
    if (COMMANDS.includes(c)) {
      cmd = c;
      i++;
    } else if (cmd === '' || cmd === 'Z' || cmd === 'z' || !atNumber()) {
      fail('a path command');
    }
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M': {
        finish(false);
        x = ox + num();
        y = oy + num();
        begin();
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'Z': {
        if (open && segs.length > 0) {
          if (x !== start[0] || y !== start[1]) segs.push(line([x, y], start));
          finish(true);
        }
        open = false;
        [x, y] = start;
        break;
      }
      case 'L': {
        begin();
        const nx = ox + num(), ny = oy + num();
        segs.push(line([x, y], [nx, ny]));
        [x, y] = [nx, ny];
        break;
      }
      case 'H': {
        begin();
        const nx = ox + num();
        segs.push(line([x, y], [nx, y]));
        x = nx;
        break;
      }
      case 'V': {
        begin();
        const ny = oy + num();
        segs.push(line([x, y], [x, ny]));
        y = ny;
        break;
      }
      case 'C': {
        begin();
        const a = ox + num(), b = oy + num(), e = ox + num(), f = oy + num(), nx = ox + num(), ny = oy + num();
        segs.push([a, b, e, f, nx, ny]);
        [c2x, c2y, x, y] = [e, f, nx, ny];
        break;
      }
      case 'S': {
        begin();
        const reflect = prev === 'C' || prev === 'S';
        const a = reflect ? 2 * x - c2x : x, b = reflect ? 2 * y - c2y : y;
        const e = ox + num(), f = oy + num(), nx = ox + num(), ny = oy + num();
        segs.push([a, b, e, f, nx, ny]);
        [c2x, c2y, x, y] = [e, f, nx, ny];
        break;
      }
      case 'Q': {
        begin();
        const a = ox + num(), b = oy + num(), nx = ox + num(), ny = oy + num();
        segs.push(quadToCubic([x, y], [a, b], [nx, ny]));
        [qx, qy, x, y] = [a, b, nx, ny];
        break;
      }
      case 'T': {
        begin();
        const reflect = prev === 'Q' || prev === 'T';
        const a = reflect ? 2 * x - qx : x, b = reflect ? 2 * y - qy : y;
        const nx = ox + num(), ny = oy + num();
        segs.push(quadToCubic([x, y], [a, b], [nx, ny]));
        [qx, qy, x, y] = [a, b, nx, ny];
        break;
      }
      case 'A': {
        begin();
        const rx = num(), ry = num(), rot = num(), large = flag(), sweep = flag(), nx = ox + num(), ny = oy + num();
        segs.push(...arcToCubics([x, y], rx, ry, rot, large, sweep, [nx, ny]));
        [x, y] = [nx, ny];
        break;
      }
    }
    prev = cmd.toUpperCase();
  }
  finish(false);
  return out;
}
