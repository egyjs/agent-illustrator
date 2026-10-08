import { describe, expect, it } from 'vitest';
import { parsePathData } from '../../src/geometry/pathdata.ts';
import { arcToCubics, line, polyline, quadToCubic } from '../../src/geometry/paths.ts';
import { square } from './helpers.ts';

describe('geometry/pathdata', () => {
  it('reads absolute lines and closes with an explicit segment', () => {
    expect(parsePathData('M10 10 L20 10 L20 20 Z')).toEqual([polyline([[10, 10], [20, 10], [20, 20]], true)]);
  });

  it('reads relative commands, H and V', () => {
    expect(parsePathData('m10 10 h10 v10 h-10 z')).toEqual([square(10, 10, 10)]);
  });

  it('repeats the last command for extra coordinates; after M the repeat is L', () => {
    expect(parsePathData('M0 0 10 0 10 10')).toEqual([polyline([[0, 0], [10, 0], [10, 10]], false)]);
    expect(parsePathData('m0 0 10 0 0 10')).toEqual([polyline([[0, 0], [10, 0], [10, 10]], false)]);
  });

  it('reflects the previous control point for S and T', () => {
    const [s] = parsePathData('M0 0 C0 10 10 10 10 0 S20 -10 20 0');
    expect(s!.segs[1]).toEqual([10, -10, 20, -10, 20, 0]);
    const [t] = parsePathData('M0 0 Q5 10 10 0 T20 0');
    expect(t!.segs[1]).toEqual(quadToCubic([10, 0], [15, -10], [20, 0]));
  });

  it('reads arcs, including compact flags', () => {
    expect(parsePathData('M0 0a50 50 0 01100 0')).toEqual([{ start: [0, 0], segs: arcToCubics([0, 0], 50, 50, 0, false, true, [100, 0]), closed: false }]);
  });

  it('reads compact numbers', () => {
    expect(parsePathData('M-.5.5L1e1-2')).toEqual([{ start: [-0.5, 0.5], segs: [line([-0.5, 0.5], [10, -2])], closed: false }]);
  });

  it('starts a new subpath at the old start after Z, and keeps several subpaths', () => {
    const sps = parsePathData('M0 0 L10 0 L10 10 Z L5 5 M20 20 L30 20');
    expect(sps).toHaveLength(3);
    expect(sps[1]).toEqual({ start: [0, 0], segs: [line([0, 0], [5, 5])], closed: false });
    expect(sps[2]!.start).toEqual([20, 20]);
  });

  it.each([
    ['', 'empty'],
    ['L10 10', '"M"'],
    ['M10', 'a number'],
    ['M0 0 X5 5', 'a path command'],
    ['M0 0 A10 10 0 2 0 5 5', 'an arc flag'],
    ['M0 0 L1e999 0', 'a finite number'],
  ])('rejects %j with a message naming %s', (d, what) => {
    expect(() => parsePathData(d)).toThrow(RangeError);
    expect(() => parsePathData(d)).toThrow(what);
  });
});
