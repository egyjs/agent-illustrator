import { z } from 'zod';
import { EngineError } from '../errors.ts';
import { applyToSubpaths, compose, scale, translate } from '../geometry/transform.ts';
import type { Box } from '../geometry/types.ts';
import { rngFor } from '../random/rng.ts';
import type { RasterImage } from '../render/image.ts';
import { quantize, stackedMask } from '../trace/quantize.ts';
import { crop, downscale } from '../trace/resample.ts';
import { traceMask, traceRegions } from '../trace/vtracer.ts';
import { addPath, common, insertNew, positive, segmentCount } from './common.ts';
import { defineOp, Length, type OpContext } from './registry.ts';

const pixels = (min: number) => z.number().int().min(min);

/**
 * Where the whole image lands on the canvas: the box given by `width` and `height`; one of them with
 * the other following the image's aspect; or neither, which fits the image inside the canvas. `x`
 * and `y` default to centering the box.
 */
function placement(ctx: OpContext, img: RasterImage, input: { x?: Length; y?: Length; width?: Length; height?: Length }): Box {
  const canvas = ctx.doc.canvas;
  const w = input.width === undefined ? undefined : positive('trace', 'width', ctx.len(input.width, 'x'));
  const h = input.height === undefined ? undefined : positive('trace', 'height', ctx.len(input.height, 'y'));
  let size: [number, number];
  if (w !== undefined && h !== undefined) size = [w, h];
  else if (w !== undefined) size = [w, (w * img.height) / img.width];
  else if (h !== undefined) size = [(h * img.width) / img.height, h];
  else {
    const fit = Math.min(canvas.width / img.width, canvas.height / img.height);
    size = [img.width * fit, img.height * fit];
  }
  const [width, height] = size;
  return {
    x: input.x === undefined ? (canvas.width - width) / 2 : ctx.len(input.x, 'x'),
    y: input.y === undefined ? (canvas.height - height) / 2 : ctx.len(input.y, 'y'),
    width,
    height,
  };
}

export const trace = defineOp({
  name: 'trace',
  domain: 'paths',
  description:
    'Vectorize a reference image (PNG or JPEG): reduce it to `colors` colors, then trace each color into one editable path (evenodd) inside a new group, the most common color at the bottom. ' +
    'method "abutting" (default) gives exact regions that share their edges, leaving no gaps (a faint antialiasing line can still show along them on a light background); "stacked" lets each color extend under the colors above it, so recoloring or deleting a top layer shows the one below. ' +
    'region traces part of the image, in its pixels; x, y, width, height place the whole image (default: fit the canvas), so traces of several regions line up. Trace only images you have the rights to.',
  schema: z.strictObject({
    ...common,
    image: z.string().min(1).max(4096),
    region: z.strictObject({ x: pixels(0), y: pixels(0), width: pixels(1), height: pixels(1) }).optional(),
    colors: z.number().int().min(2).max(32).optional(),
    method: z.enum(['stacked', 'abutting']).optional(),
    speckle: z.number().int().min(0).max(64).optional(),
    max_size: z.number().int().min(64).max(2048).optional(),
    x: Length.optional(),
    y: Length.optional(),
    width: Length.optional(),
    height: Length.optional(),
  }),
  examples: [[{ op: 'trace', id: 'logo', image: 'logo.png', colors: 4 }]],
  handler(input, ctx) {
    const img = ctx.image(input.image);
    const region = input.region ?? { x: 0, y: 0, width: img.width, height: img.height };
    if (region.x + region.width > img.width || region.y + region.height > img.height) {
      throw new EngineError(
        'invalid_input',
        `region ${region.width}×${region.height} at (${region.x}, ${region.y}) reaches outside the ${img.width}×${img.height} image`,
        `The region is in image pixels: x + width must be at most ${img.width} and y + height at most ${img.height}.`,
      );
    }
    const box = placement(ctx, img, input);
    const colors = input.colors ?? 8;
    const method = input.method ?? 'abutting';
    const speckle = input.speckle ?? 4;
    const small = downscale(input.region ? crop(img, region) : img, input.max_size ?? 1024);

    const group = insertNew(ctx, input, 'trace', (base) => ({
      ...base,
      type: 'group',
      children: [],
      meta: { source: { kind: 'trace', image: input.image, ...(input.region && { region }), colors, method, speckle, size: { width: small.width, height: small.height } } },
    }));
    const q = quantize(small.pixels, colors, rngFor(ctx.doc.seed, input.image, 'trace'));
    // Abutting traces every region in one call; stacked traces one layer at a time, so it can stop at the first one over the limit.
    const regions = method === 'abutting' ? traceRegions(q.index, q.palette, small.width, small.height, { speckle }) : undefined;
    const mask = new Uint8Array(q.index.length);

    // Traced pixel → source pixel (through the region) → canvas (through the placement of the whole image).
    const toCanvas = compose(
      translate(box.x, box.y),
      scale(box.width / img.width, box.height / img.height),
      translate(region.x, region.y),
      scale(region.width / small.width, region.height / small.height),
    );
    const total = q.counts.reduce((a, b) => a + b, 0);
    const stem = group.slice(0, 58); // leaves room for "-<n>" inside the 64-character id limit
    const made: { id: string; color: string; share: number }[] = [];
    for (const [k, color] of q.palette.entries()) {
      const subpaths = regions?.[k] ?? traceMask(stackedMask(q.index, k, mask), small.width, small.height, { speckle });
      if (subpaths.length === 0) continue;
      const segs = segmentCount(subpaths);
      if (segs > ctx.limits.maxSegmentsPerPath) {
        throw new EngineError(
          'limit_exceeded',
          `${segs} segments in the ${color} layer; the limit is ${ctx.limits.maxSegmentsPerPath}`,
          'Lower colors or max_size, raise speckle, or trace a smaller region.',
        );
      }
      const id = addPath(
        ctx,
        { id: `${stem}-${k + 1}`, parent: group, style: { fill: color } },
        { prefix: group, subpaths: applyToSubpaths(toCanvas, subpaths), source: { kind: 'trace_layer', color }, fillRule: 'evenodd' },
      );
      made.push({ id, color, share: Math.round((q.counts[k]! / total) * 1000) / 1000 });
    }
    if (made.length === 0) {
      throw new EngineError('invalid_input', 'nothing left to trace after speckle filtering', 'Lower speckle or raise max_size.');
    }
    ctx.last = group;
    return {
      id: group,
      ids: made.map((l) => l.id),
      data: { layers: made, image: { width: img.width, height: img.height }, traced: { width: small.width, height: small.height } },
    };
  },
});
