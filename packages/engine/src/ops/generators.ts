import { castDraft } from 'immer';
import { z } from 'zod';
import { EngineError } from '../errors.ts';
import { measure, type SubpathMeasure } from '../geometry/bezier.ts';
import { line, smooth } from '../geometry/paths.ts';
import { applyToSubpaths, invert } from '../geometry/transform.ts';
import type { Mat6, Subpath, Vec2 } from '../geometry/types.ts';
import { noise2D, rngFor } from '../random/rng.ts';
import type { PathNode } from '../scene/model.ts';
import { subtreeIds, worldSubpaths, worldTransform } from '../scene/query.ts';
import { addPath, common, geometryInput, positive, resolveIds } from './common.ts';
import { defineOp, Length, type OpContext } from './registry.ts';

/** Most points one wave may sample; a longer run needs a longer wavelength. */
const MAX_WAVE_POINTS = 4000;
/** Subpaths shorter than this have no direction to push along and are left alone. */
const MIN_LENGTH = 1e-9;

export const blob = defineOp({
  name: 'blob',
  domain: 'generators',
  description:
    'Organic closed blob around (cx, cy): `points` anchors on a circle of `radius`, each pushed in or out by smooth noise (randomness 0..1 is the share of the radius, frequency is how quickly the outline wobbles), joined by a smooth curve. ' +
    'The same seed (default: the document seed) and id always give the same shape.',
  schema: z.strictObject({
    ...common,
    cx: Length,
    cy: Length,
    radius: Length,
    points: z.number().int().min(3).max(64).optional(),
    randomness: z.number().min(0).max(1).optional(),
    frequency: z.number().min(0.1).max(10).optional(),
    seed: z.number().int().optional(),
  }),
  examples: [
    [{ op: 'blob', id: 'cloud', cx: 400, cy: 300, radius: 120, points: 10, randomness: 0.35, seed: 7, style: { fill: '#a8dadc' } }],
    [{ op: 'blob', id: 'puddle', cx: '50%', cy: '70%', radius: 90, style: { fill: '#457b9d' } }],
  ],
  handler(input, ctx) {
    const cx = ctx.len(input.cx, 'x'), cy = ctx.len(input.cy, 'y');
    const radius = positive('blob', 'radius', ctx.len(input.radius, 'min'));
    const points = input.points ?? 8, randomness = input.randomness ?? 0.3, frequency = input.frequency ?? 1.2;
    const seed = input.seed ?? ctx.doc.seed;
    const subpaths = (id: string): Subpath[] => {
      const noise = noise2D(rngFor(seed, id, 'blob'));
      const pts = Array.from({ length: points }, (_, k): Vec2 => {
        const theta = (2 * Math.PI * k) / points;
        const c = Math.cos(theta), s = Math.sin(theta);
        const r = radius * (1 + randomness * noise(c * frequency, s * frequency));
        return [cx + r * c, cy + r * s];
      });
      return [geometryInput(() => smooth(pts, true), 'Use a larger radius or less randomness.')];
    };
    return { id: addPath(ctx, input, { prefix: 'blob', subpaths, source: { kind: 'blob', cx, cy, radius, points, randomness, frequency, seed } }) };
  },
});

export const wave = defineOp({
  name: 'wave',
  domain: 'generators',
  description:
    'Sine wave from (x, y) across `width`: it first rises `amplitude` above y, one cycle per `wavelength`; phase shifts it in degrees. ' +
    'With `bottom` the wave becomes a closed band down to that y, ready to fill (sea, hills).',
  schema: z.strictObject({
    ...common,
    x: Length,
    y: Length,
    width: Length,
    amplitude: Length,
    wavelength: Length,
    phase: z.number().optional(),
    bottom: Length.optional(),
  }),
  examples: [
    [{ op: 'wave', id: 'ripple', x: 0, y: 300, width: '100%', amplitude: 12, wavelength: 120, style: { fill: 'none', stroke: '#264653', strokeWidth: 3 } }],
    [{ op: 'wave', id: 'sea', x: 0, y: 420, width: '100%', amplitude: 14, wavelength: 160, phase: 90, bottom: '100%', style: { fill: '#457b9d' } }],
  ],
  handler(input, ctx) {
    const x = ctx.len(input.x, 'x'), y = ctx.len(input.y, 'y');
    const width = positive('wave', 'width', ctx.len(input.width, 'x'));
    const amplitude = positive('wave', 'amplitude', ctx.len(input.amplitude, 'y'));
    const wavelength = positive('wave', 'wavelength', ctx.len(input.wavelength, 'x'));
    const phase = input.phase ?? 0;
    const bottom = input.bottom === undefined ? undefined : ctx.len(input.bottom, 'y');
    const step = wavelength / 8;
    const count = Math.max(2, Math.ceil(width / step - 1e-3) + 1);
    if (count > MAX_WAVE_POINTS) {
      throw new EngineError('limit_exceeded', `a wave of ${width} wide with wavelength ${wavelength} needs ${count} points; the limit is ${MAX_WAVE_POINTS}`, 'Use a longer wavelength or a smaller width.');
    }
    const phi = (phase * Math.PI) / 180;
    const pts = Array.from({ length: count }, (_, i): Vec2 => {
      const px = i === count - 1 ? x + width : x + i * step;
      return [px, y - amplitude * Math.sin((2 * Math.PI * (px - x)) / wavelength + phi)];
    });
    let sp = geometryInput(() => smooth(pts, false), 'Give the wave a non-zero width.');
    if (bottom !== undefined) {
      const end = sp.segs.at(-1)!;
      const right: Vec2 = [x + width, bottom], left: Vec2 = [x, bottom];
      sp = { start: sp.start, segs: [...sp.segs, line([end[4], end[5]], right), line(right, left), line(left, sp.start)], closed: true };
    }
    const source = { kind: 'wave', x, y, width, amplitude, wavelength, phase, ...(bottom === undefined ? {} : { bottom }) };
    return { id: addPath(ctx, input, { prefix: 'wave', subpaths: [sp], source }) };
  },
});

/** What roughening one path needs, measured before any geometry is built. */
type RoughPlan = {
  readonly node: PathNode;
  readonly inverse: Mat6;
  readonly world: readonly Subpath[];
  readonly measures: readonly SubpathMeasure[];
  /** Points to sample per subpath; 0 leaves a subpath (too short to have a direction) as it is. */
  readonly counts: readonly number[];
  /** Segments the roughened path will have. */
  readonly segments: number;
};

function planRough(ctx: OpContext, node: PathNode, detail: number): RoughPlan {
  const inverse = invert(worldTransform(ctx.doc, node.id));
  if (!inverse) {
    throw new EngineError('invalid_structure', `"${node.id}" sits in a group squashed flat (scale 0)`, 'Give that group a non-zero scale before roughening.');
  }
  const world = worldSubpaths(ctx.doc, node);
  const measures = world.map((sp) => measure(sp));
  const counts = measures.map((m, i) => (m.length > MIN_LENGTH ? Math.max(world[i]!.closed ? 3 : 2, Math.round(m.length / detail)) : 0));
  const segments = counts.reduce((total, n, i) => total + (n === 0 ? node.subpaths[i]!.segs.length : world[i]!.closed ? n : n - 1), 0);
  return { node, inverse, world, measures, counts, segments };
}

/** The roughened copy of a path's geometry, in the path's own coordinates. */
function roughPath({ node, inverse, world, measures, counts }: RoughPlan, amount: number, detail: number, seed: number): Subpath[] {
  const noise = noise2D(rngFor(seed, node.id, 'roughen'));
  return world.map((sp, i) => {
    const n = counts[i]!;
    if (n === 0) return node.subpaths[i]!;
    const m = measures[i]!;
    const pts = Array.from({ length: n }, (_, k): Vec2 => {
      const s = (m.length * k) / (sp.closed ? n : n - 1);
      const { point, tangent } = m.at(s);
      const push = amount * noise(s / (4 * detail), i * 7.31);
      return [point[0] - tangent[1] * push, point[1] + tangent[0] * push];
    });
    return applyToSubpaths(inverse, [geometryInput(() => smooth(pts, sp.closed), 'Use a smaller detail or amount.')])[0]!;
  });
}

export const roughen = defineOp({
  name: 'roughen',
  domain: 'generators',
  description:
    'Hand-drawn wobble: pushes the outline of every path in ids (and inside groups) sideways by up to `amount`, with smooth noise sampled every `detail` along the outline and refitted as a smooth curve. ' +
    'The same seed (default: the document seed) and ids always give the same result. Text is skipped.',
  schema: z.strictObject({ ids: z.array(z.string()).min(1).max(200), amount: Length, detail: Length.optional(), seed: z.number().int().optional() }),
  examples: [
    [
      { op: 'rect', id: 'card', x: 200, y: 150, width: 400, height: 300, style: { fill: '#f4a261' } },
      { op: 'roughen', ids: ['card'], amount: 4, detail: 12, seed: 3 },
    ],
  ],
  handler(input, ctx) {
    const amount = positive('roughen', 'amount', ctx.len(input.amount, 'min'));
    const detail = positive('roughen', 'detail', ctx.len(input.detail ?? 6, 'min'));
    const seed = input.seed ?? ctx.doc.seed;
    const plans: RoughPlan[] = [];
    let texts = 0;
    for (const id of new Set(resolveIds(ctx, input.ids).flatMap((root) => subtreeIds(ctx.doc, root)))) {
      const node = ctx.node(id);
      if (node.type === 'text') texts++;
      else if (node.type === 'path') plans.push(planRough(ctx, node, detail));
    }
    // Everything one op processes must fit one path's limit, as with booleans.
    const segments = plans.reduce((total, p) => total + p.segments, 0);
    if (segments > ctx.limits.maxSegmentsPerPath) {
      throw new EngineError(
        'limit_exceeded',
        `roughening ${plans.length} path(s) would make ${segments} segments; the limit is ${ctx.limits.maxSegmentsPerPath}`,
        `Use a larger detail (now ${detail}) so fewer points are sampled along the outlines, or rough fewer paths per op.`,
      );
    }
    const changed = new Map(plans.map((p) => [p.node.id, roughPath(p, amount, detail, seed)] as const));
    ctx.update((d) => {
      for (const [id, subpaths] of changed) (d.nodes[id] as { subpaths: unknown }).subpaths = castDraft(subpaths);
    });
    if (texts > 0) ctx.warn('text_skipped', `${texts} text node(s) were left as they are: text has no outline to roughen`);
    if (changed.size === 0) ctx.warn('no_paths', 'the ids hold no paths, so nothing was roughened');
    return { ids: [...changed.keys()] };
  },
});
