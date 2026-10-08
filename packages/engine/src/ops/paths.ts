import { castDraft } from 'immer';
import { z } from 'zod';
import { EngineError } from '../errors.ts';
import { parsePathData } from '../geometry/pathdata.ts';
import { fit, polyline, roundCorners, smooth } from '../geometry/paths.ts';
import { addPath, common, geometryInput, point, PointInput, resolveIds } from './common.ts';
import { defineOp, Length } from './registry.ts';

export const pathFromPoints = defineOp({
  name: 'path_from_points',
  domain: 'paths',
  description:
    'Path through points [x, y]: mode "polyline" (straight lines), "smooth" (a curve through every point) or "fit" (a few curves near the points, within tolerance px).',
  schema: z.strictObject({
    ...common,
    points: z.array(PointInput).min(2).max(5000),
    mode: z.enum(['polyline', 'smooth', 'fit']).optional(),
    closed: z.boolean().optional(),
    tolerance: z.number().positive().optional(),
  }),
  examples: [
    [{ op: 'path_from_points', id: 'hills', points: [[0, 420], [200, 330], [420, 390], [640, 300], [800, 380]], mode: 'smooth', style: { fill: 'none', stroke: '#2a9d8f', strokeWidth: 4 } }],
  ],
  handler(input, ctx) {
    const pts = input.points.map((p) => point(ctx, p));
    const closed = input.closed ?? false;
    const mode = input.mode ?? 'polyline';
    const sp = geometryInput(
      () => (mode === 'polyline' ? polyline(pts, closed) : mode === 'smooth' ? smooth(pts, closed) : fit(pts, closed, input.tolerance ?? 1)),
      'Give at least two different points.',
    );
    if (sp.segs.length === 0) {
      throw new EngineError('invalid_input', 'all points are the same point', 'Give at least two different points.');
    }
    return { id: addPath(ctx, input, { prefix: 'path', subpaths: [sp], source: { kind: 'path_from_points', mode, closed, points: pts.length } }) };
  },
});

export const pathCommands = defineOp({
  name: 'path_commands',
  domain: 'paths',
  description: 'Path from SVG path data `d` (M, L, H, V, C, S, Q, T, A, Z, absolute or relative). Quadratics and arcs become cubics. fillRule "evenodd" makes inner loops holes.',
  schema: z.strictObject({ ...common, d: z.string().min(1).max(200_000), fillRule: z.enum(['nonzero', 'evenodd']).optional() }),
  examples: [[{ op: 'path_commands', id: 'leaf', d: 'M400 200 Q480 260 400 380 Q320 260 400 200 Z', style: { fill: '#52b788' } }]],
  handler(input, ctx) {
    const subpaths = geometryInput(() => parsePathData(input.d), 'Use SVG path syntax, e.g. "M10 10 L90 10 Q50 60 10 10 Z".');
    if (subpaths.length === 0) {
      throw new EngineError('invalid_input', 'path data draws nothing (only moves)', 'Add drawing commands after M, e.g. "M10 10 L90 10".');
    }
    return { id: addPath(ctx, input, { prefix: 'path', subpaths, source: { kind: 'path_commands' }, ...(input.fillRule ? { fillRule: input.fillRule } : {}) }) };
  },
});

export const roundCornersOp = defineOp({
  name: 'round_corners',
  domain: 'paths',
  description: "Rounds the sharp corners between straight edges of paths with a fillet radius in the path's own units, clamped to half of each edge.",
  schema: z.strictObject({ ids: z.array(z.string()).min(1).max(1000), radius: Length }),
  examples: [
    [
      { op: 'path_from_points', id: 'tri', points: [[300, 400], [400, 220], [500, 400]], closed: true, style: { fill: '#e76f51' } },
      { op: 'round_corners', ids: ['tri'], radius: 20 },
    ],
  ],
  handler(input, ctx) {
    const r = ctx.len(input.radius, 'min');
    if (!(r > 0)) throw new EngineError('invalid_input', `radius must be > 0, got ${r}`, 'Give a positive radius in px.');
    const ids = resolveIds(ctx, input.ids);
    let clamped = 0, skipped = 0;
    for (const id of ids) {
      const node = ctx.node(id);
      if (node.type !== 'path') throw new EngineError('invalid_structure', `"${id}" is a group`, 'Round the paths inside the group by their ids.');
      const subpaths = node.subpaths.map((sp) => {
        const out = roundCorners(sp, r);
        clamped += out.clamped;
        skipped += out.skipped;
        return out.subpath;
      });
      ctx.update((d) => {
        (d.nodes[id] as { subpaths: unknown }).subpaths = castDraft(subpaths);
      });
    }
    if (clamped > 0) ctx.warn('radius_clamped', `${clamped} corner(s) got a smaller radius: the edges are too short for ${r}`);
    if (skipped > 0) ctx.warn('corners_skipped', `${skipped} corner(s) next to a curve were left sharp`);
    return ids.length === 1 ? { id: ids[0]! } : { ids };
  },
});
