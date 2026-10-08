import { pathBounds } from './bezier.ts';
import { signedArea } from './flatten.ts';
import { fromPaper, toPaper, withPaper } from './paper-adapter.ts';
import type { FillRule, Seg, Subpath } from './types.ts';

export type BooleanOp = 'union' | 'intersect' | 'subtract' | 'exclude';
export type Shape = { readonly subpaths: readonly Subpath[]; readonly fillRule: FillRule };

const PAPER_METHOD = { union: 'unite', intersect: 'intersect', subtract: 'subtract', exclude: 'exclude' } as const;

/**
 * Boolean of two filled shapes through paper.js (D5). Each operand's fill rule is honoured, and an
 * open subpath counts as closed, as SVG fills it.
 *
 * The result is reoriented with `reorient(true, true)` (spike finding F3): outer loops run clockwise
 * and holes counter-clockwise. Nonzero and evenodd then fill it the same way, and `signedArea()` is
 * its covered area.
 *
 * Epsilon handling, relative to the operands' size: zero-length segments and zero-area sliver loops
 * are dropped. When one operand is empty, the other is returned unchanged, without calling paper.
 */
export function booleanOp(op: BooleanOp, a: Shape, b: Shape): Shape {
  const left: Shape = { ...a, subpaths: a.subpaths.filter((sp) => sp.segs.length > 0) };
  const right: Shape = { ...b, subpaths: b.subpaths.filter((sp) => sp.segs.length > 0) };
  if (left.subpaths.length === 0 || right.subpaths.length === 0) return withEmptyOperand(op, left, right);
  const box = pathBounds([...left.subpaths, ...right.subpaths])!;
  const size = Math.max(1, Math.hypot(box.width, box.height));
  return withPaper((scope) => {
    // Fill closes every subpath. Hand them to paper closed: its own close for open paths merges
    // a last point that equals the start and then straightens that last curve.
    const pa = toPaper(scope, left.subpaths.map(asClosed), left.fillRule);
    const pb = toPaper(scope, right.subpaths.map(asClosed), right.fillRule);
    const result = pa[PAPER_METHOD[op]](pb, { insert: false });
    result.reorient(true, true);
    return { subpaths: tidy(fromPaper(result), size), fillRule: 'nonzero' };
  });
}

const asClosed = (sp: Subpath): Subpath => (sp.closed ? sp : { ...sp, closed: true });

function withEmptyOperand(op: BooleanOp, a: Shape, b: Shape): Shape {
  const none: Shape = { subpaths: [], fillRule: 'nonzero' };
  if (op === 'intersect') return none;
  if (op === 'subtract') return a.subpaths.length > 0 ? a : none;
  return a.subpaths.length > 0 ? a : b; // union and exclude keep whichever side is not empty
}

/**
 * Drops segments that do not move (all three points within 1e-9·size of the current point) and
 * loops whose area is below (1e-4·size)². A closed loop keeps ending exactly at its start.
 * After reorient the net signed area is the covered area. When that is below the same epsilon the
 * result is empty, even if paper returned loops that cancel: near-coincident curves give two
 * full-size loops of opposite orientation.
 */
function tidy(subpaths: readonly Subpath[], size: number): Subpath[] {
  const pointEps = 1e-9 * size, areaEps = (1e-4 * size) ** 2;
  const out: Subpath[] = [];
  for (const sp of subpaths) {
    let [px, py] = sp.start;
    const segs: Seg[] = [];
    for (const s of sp.segs) {
      const moves = Math.max(Math.hypot(s[0] - px, s[1] - py), Math.hypot(s[2] - px, s[3] - py), Math.hypot(s[4] - px, s[5] - py)) > pointEps;
      if (!moves) continue;
      segs.push(s);
      px = s[4];
      py = s[5];
    }
    const last = segs.at(-1);
    if (sp.closed && last && Math.hypot(last[4] - sp.start[0], last[5] - sp.start[1]) <= pointEps) {
      segs[segs.length - 1] = [last[0], last[1], last[2], last[3], sp.start[0], sp.start[1]];
    }
    const clean: Subpath = { start: sp.start, segs, closed: sp.closed };
    if (segs.length > 0 && Math.abs(signedArea([clean])) >= areaEps) out.push(clean);
  }
  return Math.abs(signedArea(out)) < areaEps ? [] : out;
}
