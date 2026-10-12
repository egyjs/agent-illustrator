import { describe, expect, it, vi } from 'vitest';
import { EngineError } from '../../src/errors.ts';
import type { Box } from '../../src/geometry/types.ts';
import { createRegistry } from '../../src/ops/index.ts';
import { executeBatch, type BatchOptions, type BatchResult, type OpOutcome } from '../../src/ops/registry.ts';
import { trace } from '../../src/ops/trace.ts';
import type { RasterImage } from '../../src/render/image.ts';
import { rasterize } from '../../src/render/raster.ts';
import { toSvg } from '../../src/render/svg.ts';
import { createDocument, type Doc, type GroupNode, type PathNode } from '../../src/scene/model.ts';
import { worldBounds } from '../../src/scene/query.ts';
import { traceMask } from '../../src/trace/vtracer.ts';
import { docOf, expectIntact, groupNode, pathNode, rasterOf, rgba, TEST_IMAGE_COLORS, testImages } from '../fixtures.ts';

vi.mock('../../src/trace/vtracer.ts', async (original) => {
  const m = await original<typeof import('../../src/trace/vtracer.ts')>();
  return { ...m, traceMask: vi.fn(m.traceMask) };
});

const registry = createRegistry();
const blank = (width = 800, height = 600, seed = 1): Doc => createDocument({ width, height, seed });
const using = (img: RasterImage): BatchOptions => ({ images: { get: () => img } });
function run(ops: unknown[], doc: Doc = blank(), options: BatchOptions = using(scene)): BatchResult {
  const r = executeBatch(registry, doc, ops, options);
  expectIntact(r.doc);
  return r;
}
const error = (r: BatchResult) => (r.results.find((o) => o.status === 'error') as { error: { code: string; message: string; hint: string } }).error;
/** The outcome of op `i`, which must have succeeded. */
function done(r: BatchResult, i = 0): Exclude<OpOutcome, { status: 'error' | 'skipped' }> {
  const o = r.results[i]!;
  if (o.status !== 'ok') throw new Error(`op ${i} did not succeed: ${JSON.stringify(o)}`);
  return o;
}
const shares = (r: BatchResult) => (done(r).data as { layers: { id: string; color: string; share: number }[] }).layers;
const layers = (r: BatchResult, id: string) => (r.doc.nodes[id] as GroupNode).children.map((c) => r.doc.nodes[c] as PathNode);
const boxOf = (r: BatchResult, id: string) => worldBounds(r.doc, id);
function near(actual: Box | null, want: Box, tol = 1) {
  expect(actual).not.toBeNull();
  for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(actual![k] - want[k]), `${k} of ${JSON.stringify(actual)}`).toBeLessThanOrEqual(tol);
}
const count = (img: RasterImage, hex: string) => {
  const want = rgba(hex);
  let n = 0;
  for (let i = 0; i < img.pixels.length; i += 4) if (want.every((v, c) => img.pixels[i + c] === v)) n++;
  return n;
};

const [WHITE, RED, BLUE] = ['#ffffff', '#c81e1e', '#1e1ec8'];
/** 200×100: white, a red disc (radius 30) in the right half and a blue square in the left, most pixels first. */
const scene = rasterOf(200, 100, (x, y) => {
  if (x >= 20 && x < 60 && y >= 30 && y < 70) return rgba(BLUE);
  return rgba(Math.hypot(x + 0.5 - 150, y + 0.5 - 50) < 30 ? RED : WHITE);
});
/** 800×400 at (0, 100): where `scene` lands on an 800×600 canvas by default. */
const FIT: Box = { x: 0, y: 100, width: 800, height: 400 };

/** Canvas area a path covers, from rendering it alone in black. */
function area(node: PathNode): number {
  const img = rasterize(docOf([pathNode('solo', [...node.subpaths], { fillRule: node.fillRule, style: { fill: '#000000' } })]));
  let sum = 0;
  for (let i = 0; i < img.pixels.length; i += 4) sum += 255 - img.pixels[i]!;
  return sum / 255;
}

describe('ops/trace: registration', () => {
  it('is a paths op that warns about rights', () => {
    expect(registry.get('trace')).toBe(trace);
    expect(trace.domain).toBe('paths');
    expect(trace.description).toContain('Trace only images you have the rights to.');
  });

  it('runs its example with the test images', () => {
    const r = run([...trace.examples[0]!], blank(), { images: testImages });
    expect(r.ok).toBe(true);
    expect(done(r)).toMatchObject({ op: 'trace', status: 'ok', id: 'logo', ids: ['logo-1', 'logo-2', 'logo-3'] });
    expect(r.lastCreated).toBe('logo');

    // One path per color, the most common at the bottom, each painted its exact color.
    const group = r.doc.nodes.logo as GroupNode;
    expect(group.children).toEqual(['logo-1', 'logo-2', 'logo-3']);
    expect(r.doc.root).toEqual(['logo']);
    const paths = layers(r, 'logo');
    expect(paths.map((p) => p.style.fill)).toEqual([...TEST_IMAGE_COLORS]);
    expect(paths.map((p) => p.fillRule)).toEqual(['evenodd', 'evenodd', 'evenodd']);
    expect(paths.map((p) => p.parent)).toEqual(['logo', 'logo', 'logo']);
    expect(paths.map((p) => p.meta)).toEqual(TEST_IMAGE_COLORS.map((color) => ({ source: { kind: 'trace_layer', color } })));
  });

  it('reports the layers, their shares and the image sizes', () => {
    const img = testImages.get('logo.png');
    const total = img.width * img.height;
    const r = run([...trace.examples[0]!], blank(), { images: testImages });
    const data = done(r).data as { layers: { share: number }[] };
    expect(data).toEqual({
      layers: TEST_IMAGE_COLORS.map((color, i) => ({ id: `logo-${i + 1}`, color, share: Math.round((count(img, color) / total) * 1000) / 1000 })),
      image: { width: 64, height: 48 },
      traced: { width: 64, height: 48 },
    });
    expect(data.layers[0]!.share).toBeGreaterThan(data.layers[1]!.share);
  });
});

describe('ops/trace: the group', () => {
  it('records how it was made, and keeps the image reference verbatim', () => {
    const r = run([{ op: 'trace', id: 't', image: 'C:/art/scene.png', colors: 3 }]);
    const group = r.doc.nodes.t as GroupNode;
    expect(group.meta?.source).toEqual({ kind: 'trace', image: 'C:/art/scene.png', colors: 3, method: 'abutting', speckle: 4, size: { width: 200, height: 100 } });
    expect(group.meta?.source).not.toHaveProperty('region');
  });

  it('applies the style to the group and only the fill to the layers', () => {
    const r = run([{ op: 'trace', id: 't', image: 's.png', colors: 3, style: { opacity: 0.5 } }]);
    expect(r.doc.nodes.t!.style).toEqual({ opacity: 0.5 });
    expect(layers(r, 't').map((p) => Object.keys(p.style))).toEqual([['fill'], ['fill'], ['fill']]);
  });

  it('numbers its own ids when none is given', () => {
    const r = run([{ op: 'trace', image: 's.png', colors: 2 }, { op: 'trace', image: 's.png', colors: 2 }]);
    expect(r.results.map((_, i) => done(r, i).id)).toEqual(['trace-1', 'trace-2']);
    expect(r.results.map((_, i) => done(r, i).ids)).toEqual([['trace-1-1', 'trace-1-2'], ['trace-2-1', 'trace-2-2']]);
    expect(r.lastCreated).toBe('trace-2');
  });

  it('keeps layer ids valid when the group id is as long as an id can be', () => {
    const id = `g${'x'.repeat(63)}`;
    const r = run([{ op: 'trace', id, image: 's.png', colors: 2 }]);
    expect(r.ok).toBe(true);
    expect((r.doc.nodes[id] as GroupNode).children).toHaveLength(2);
  });
});

describe('ops/trace: layers', () => {
  it('stacks: the bottom layer fills the whole image and each layer sits on the ones below', () => {
    const r = run([{ op: 'trace', id: 't', image: 's.png', colors: 3, method: 'stacked' }]);
    const [bottom, middle, top] = layers(r, 't');
    expect(bottom!.style.fill).toBe(WHITE);
    expect(middle!.style.fill).toBe(RED);
    expect(top!.style.fill).toBe(BLUE);
    near(boxOf(r, 't-1'), FIT);
    expect(area(bottom!)).toBeGreaterThan(0.99 * 800 * 400);
    // The blue square: image (20, 30, 40, 40) at scale 4.
    near(boxOf(r, 't-3'), { x: 80, y: 220, width: 160, height: 160 }, 4);
    // The red layer holds the disc and the square on top of which blue is drawn.
    near(boxOf(r, 't-2'), { x: 80, y: 180, width: 640, height: 240 }, 4);
  });

  it('abuts by default: layers do not overlap, and together they cover the image', () => {
    const r = run([{ op: 'trace', id: 't', image: 's.png', colors: 3 }]);
    const [white, red, blue] = layers(r, 't');
    near(boxOf(r, 't-1'), FIT);
    near(boxOf(r, 't-2'), { x: 480, y: 180, width: 240, height: 240 }, 4);
    near(boxOf(r, 't-3'), { x: 80, y: 220, width: 160, height: 160 }, 4);
    const sum = area(white!) + area(red!) + area(blue!);
    expect(Math.abs(sum - 800 * 400)).toBeLessThan(0.01 * 800 * 400);

    const backdrop = rasterize(r.doc, { region: FIT, background: '#00ff00' });
    let gaps = 0;
    for (let i = 0; i < backdrop.pixels.length; i += 4) if (backdrop.pixels[i + 1]! > 100 && backdrop.pixels[i]! < 100) gaps++;
    expect(gaps).toBe(0);
  });

  it('stacks more area than abutting does', () => {
    const stacked = layers(run([{ op: 'trace', id: 't', image: 's.png', colors: 3, method: 'stacked' }]), 't').reduce((n, p) => n + area(p), 0);
    expect(stacked).toBeGreaterThan(1.15 * 800 * 400);
  });

  it('gives fewer layers when the image has fewer colors than asked for', () => {
    const r = run([{ op: 'trace', id: 't', image: 's.png', colors: 10 }]);
    expect(layers(r, 't')).toHaveLength(3);
    const two = run([{ op: 'trace', id: 't', image: 's.png', colors: 2 }]);
    expect(layers(two, 't')).toHaveLength(2);
    expect(layers(two, 't')[0]!.style.fill).toBe(WHITE);
  });

  it('drops a layer that speckle filtering empties', () => {
    const dotted = rasterOf(60, 40, (x, y) => rgba(x >= 30 && x < 32 && y >= 20 && y < 22 ? BLUE : x < 30 ? WHITE : RED));
    const r = run([{ op: 'trace', id: 't', image: 'd.png', colors: 3 }], blank(), using(dotted));
    expect(layers(r, 't').map((p) => p.style.fill)).toEqual([WHITE, RED]);
    expect(shares(r)).toHaveLength(2);
    // With no filtering the 2×2 dot is kept.
    expect(layers(run([{ op: 'trace', id: 't', image: 'd.png', colors: 3, speckle: 0 }], blank(), using(dotted)), 't')).toHaveLength(3);
  });

  it('leaves transparent pixels out and shares only the opaque ones', () => {
    const half = rasterOf(100, 50, (x, y) => (x < 50 ? [0, 0, 0, 0] : rgba(y < 25 ? RED : BLUE)));
    const r = run([{ op: 'trace', id: 't', image: 'h.png', colors: 3, method: 'stacked' }], blank(), using(half));
    // Scale 8: the opaque right half is (400, 100, 400, 400).
    near(boxOf(r, 't-1'), { x: 400, y: 100, width: 400, height: 400 });
    expect(shares(r).map((l) => l.share)).toEqual([0.5, 0.5]);
  });

  it('abuts a black shape on transparent, and a near-black body with a white mark', () => {
    const black = rasterOf(100, 60, (x, y) => (x >= 20 && x < 80 && y >= 10 && y < 50 ? rgba('#000000') : [0, 0, 0, 0]));
    const one = run([{ op: 'trace', id: 't', image: 'b.png', colors: 4 }], blank(), using(black));
    expect(layers(one, 't').map((p) => p.style.fill)).toEqual(['#000000']);

    const mark = rasterOf(100, 60, (x, y) => {
      if (x < 20 || x >= 80 || y < 10 || y >= 50) return [0, 0, 0, 0];
      return rgba(x >= 40 && x < 60 && y >= 25 && y < 35 ? '#ffffff' : '#050505');
    });
    const two = run([{ op: 'trace', id: 't', image: 'm.png', colors: 4 }], blank(), using(mark));
    expect(layers(two, 't').map((p) => p.style.fill)).toEqual(['#050505', '#ffffff']);
  });

  it('is deterministic: the same ops on the same document give the same SVG', () => {
    const shaded = rasterOf(60, 40, (x, y) => [x * 4, y * 6, (x * y) % 256, 255]);
    const once = () => run([{ op: 'trace', id: 't', image: 'p.png', colors: 5 }], blank(800, 600, 7), using(shaded));
    const a = once(), b = once();
    expect(layers(a, 't').length).toBeGreaterThan(1);
    expect(layers(a, 't').length).toBeLessThanOrEqual(5);
    expect(toSvg(a.doc)).toBe(toSvg(b.doc));
    expect(a.results).toEqual(b.results);
  });

  it('picks the same palette for the same image whatever the ids, so a preview matches its commit', () => {
    const shaded = rasterOf(60, 40, (x, y) => [x * 4, y * 6, (x * y) % 256, 255]);
    const fills = (r: BatchResult, id: string) => layers(r, id).map((p) => p.style.fill);
    const named = run([{ op: 'trace', id: 'a', image: 'p.png', colors: 5 }, { op: 'trace', id: 'b', image: 'p.png', colors: 5 }], blank(800, 600, 7), using(shaded));
    expect(fills(named, 'a')).toHaveLength(5);
    expect(fills(named, 'b')).toEqual(fills(named, 'a'));
    const auto = run([{ op: 'trace', image: 'p.png', colors: 5 }, { op: 'trace', image: 'p.png', colors: 5 }], blank(800, 600, 7), using(shaded));
    expect(fills(auto, 'trace-2')).toEqual(fills(auto, 'trace-1'));
    expect(fills(auto, 'trace-1')).toEqual(fills(named, 'a'));
  });

  it('seeds the palette from the document seed', () => {
    const shaded = rasterOf(60, 40, (x, y) => [x * 4, y * 6, (x * y) % 256, 255]);
    const palette = (seed: number) => layers(run([{ op: 'trace', id: 't', image: 'p.png', colors: 5 }], blank(800, 600, seed), using(shaded)), 't').map((p) => p.style.fill);
    expect(new Set([1, 2, 3, 4, 5].map((seed) => palette(seed).join())).size).toBeGreaterThan(1);
  });

  it('traces at max_size when the image is larger', () => {
    const r = run([{ op: 'trace', id: 't', image: 's.png', colors: 3, max_size: 100 }]);
    expect(r.results[0]).toMatchObject({ data: { image: { width: 200, height: 100 }, traced: { width: 100, height: 50 } } });
    expect((r.doc.nodes.t as GroupNode).meta?.source).toMatchObject({ size: { width: 100, height: 50 } });
    near(boxOf(r, 't-1'), FIT);
    near(boxOf(r, 't-3'), { x: 80, y: 220, width: 160, height: 160 }, 8);
  });
});

describe('ops/trace: placement', () => {
  const bottom = (place: Record<string, unknown>) => boxOf(run([{ op: 'trace', id: 't', image: 's.png', colors: 3, ...place }]), 't-1');

  it.each<[string, Record<string, unknown>, Box]>([
    ['fits the canvas by default', {}, FIT],
    ['derives the height from a width and centers', { width: 400 }, { x: 200, y: 200, width: 400, height: 200 }],
    ['derives the width from a height and centers', { height: 300 }, { x: 100, y: 150, width: 600, height: 300 }],
    ['stretches to an explicit box', { x: 10, y: 20, width: 100, height: 100 }, { x: 10, y: 20, width: 100, height: 100 }],
    ['centers on the axis that has no position', { x: 10 }, { x: 10, y: 100, width: 800, height: 400 }],
    ['reads percents of the canvas', { x: '25%', y: '10%', width: '50%' }, { x: 200, y: 60, width: 400, height: 200 }],
    ['reads a percent height', { height: '50%' }, { x: 100, y: 150, width: 600, height: 300 }],
    ['allows a box that runs off the canvas', { x: -100, y: -50, width: 1000, height: 700 }, { x: -100, y: -50, width: 1000, height: 700 }],
  ])('%s', (_name, place, want) => {
    near(bottom(place), want);
  });

  it('fits a tall image by its height', () => {
    const tall = rasterOf(100, 200, (x) => rgba(x < 50 ? RED : BLUE));
    const r = run([{ op: 'trace', id: 't', image: 't.png', colors: 2, method: 'stacked' }], blank(), using(tall));
    near(boxOf(r, 't-1'), { x: 250, y: 0, width: 300, height: 600 });
  });

  it('refuses a width or height that is not positive', () => {
    for (const place of [{ width: 0 }, { height: -20 }, { width: '-10%' }]) {
      const doc = blank();
      const r = run([{ op: 'trace', image: 's.png', ...place }], doc);
      expect(error(r)).toMatchObject({ code: 'invalid_input', message: expect.stringMatching(/trace (width|height) must be > 0/) });
      expect(r.doc).toBe(doc);
    }
  });
});

describe('ops/trace: region', () => {
  const doc = blank(200, 100);
  const right = { x: 100, y: 0, width: 100, height: 100 };

  it('lands where that area of the image sits in a full trace', () => {
    const full = run([{ op: 'trace', id: 'full', image: 's.png', colors: 3, method: 'abutting' }], doc);
    const part = run([{ op: 'trace', id: 'part', image: 's.png', colors: 3, method: 'abutting', region: right }], doc);
    near(boxOf(full, 'full-2'), { x: 120, y: 20, width: 60, height: 60 });
    near(boxOf(part, 'part-1'), right);
    near(boxOf(part, 'part-2'), boxOf(full, 'full-2')!);
    expect(layers(part, 'part')).toHaveLength(2);
    expect(part.results[0]).toMatchObject({ data: { image: { width: 200, height: 100 }, traced: { width: 100, height: 100 } } });
    expect((part.doc.nodes.part as GroupNode).meta?.source).toMatchObject({ kind: 'trace', region: right, size: { width: 100, height: 100 } });
  });

  it('still lines up when the region is shrunk to max_size', () => {
    const part = run([{ op: 'trace', id: 'part', image: 's.png', colors: 3, method: 'abutting', region: right, max_size: 64 }], doc);
    expect(part.results[0]).toMatchObject({ data: { traced: { width: 64, height: 64 } } });
    near(boxOf(part, 'part-1'), right);
    near(boxOf(part, 'part-2'), { x: 120, y: 20, width: 60, height: 60 }, 2);
  });

  it('places a region of the image together with the placement of the whole image', () => {
    const r = run([{ op: 'trace', id: 'part', image: 's.png', colors: 3, region: right }]);
    near(boxOf(r, 'part-1'), { x: 400, y: 100, width: 400, height: 400 });
  });

  it.each<[string, Record<string, number>]>([
    ['past the right edge', { x: 150, y: 0, width: 100, height: 50 }],
    ['past the bottom edge', { x: 0, y: 60, width: 10, height: 50 }],
    ['as large as nothing fits', { x: 0, y: 0, width: 201, height: 100 }],
  ])('refuses a region %s, and says how big the image is', (_name, region) => {
    const before = blank();
    const r = run([{ op: 'trace', image: 's.png', region }], before);
    expect(error(r).code).toBe('invalid_input');
    expect(`${error(r).message} ${error(r).hint}`).toContain('200×100');
    expect(r.doc).toBe(before);
  });
});

describe('ops/trace: parent', () => {
  it('keeps the placement in canvas units inside a transformed group', () => {
    const frame = docOf([groupNode('frame', [], { transform: [0.5, 0, 0, 0.5, 100, 40] })]);
    const r = run([{ op: 'trace', id: 't', parent: 'frame', image: 's.png', colors: 3 }], frame);
    expect(r.doc.nodes.t!.parent).toBe('frame');
    near(boxOf(r, 't'), FIT);
    near(boxOf(r, 't-1'), FIT);
    near(boxOf(r, 't-3'), { x: 80, y: 220, width: 160, height: 160 }, 4);
  });

  it('refuses a parent that is not a group', () => {
    const r = run([{ op: 'rect', id: 'box', x: 0, y: 0, width: 5, height: 5 }, { op: 'trace', parent: 'box', image: 's.png' }]);
    expect(error(r).code).toBe('invalid_structure');
  });
});

describe('ops/trace: errors', () => {
  it('stops at the segment limit, naming the layer', () => {
    const before = blank();
    const r = run([{ op: 'trace', id: 't', image: 's.png', colors: 3 }], before, { ...using(scene), limits: { maxSegmentsPerPath: 3 } });
    expect(error(r)).toMatchObject({
      code: 'limit_exceeded',
      message: expect.stringMatching(/^\d+ segments in the #[0-9a-f]{6} layer; the limit is 3$/),
      hint: 'Lower colors or max_size, raise speckle, or trace a smaller region.',
    });
    expect(r.committed).toBe(false);
    expect(r.doc).toBe(before);
  });

  it('stops stacking at the first layer over the limit', () => {
    vi.mocked(traceMask).mockClear();
    const r = run([{ op: 'trace', id: 't', image: 's.png', colors: 3, method: 'stacked' }], blank(), { ...using(scene), limits: { maxSegmentsPerPath: 3 } });
    expect(error(r).code).toBe('limit_exceeded');
    expect(traceMask).toHaveBeenCalledTimes(1);
  });

  it('refuses a batch that has no image source', () => {
    const r = run([{ op: 'trace', image: 's.png' }], blank(), {});
    expect(error(r)).toMatchObject({ code: 'invalid_input', message: expect.stringContaining('image source') });
  });

  it('passes the errors of the image source through', () => {
    const source: BatchOptions = {
      images: {
        get() {
          throw new EngineError('limit_exceeded', 'the file is 40 MB; the limit is 25 MB', 'Scale it down first.');
        },
      },
    };
    const r = run([{ op: 'trace', image: 'huge.png' }], blank(), source);
    expect(error(r)).toEqual({ code: 'limit_exceeded', message: 'the file is 40 MB; the limit is 25 MB', hint: 'Scale it down first.' });
  });

  it('refuses a fully transparent image', () => {
    const before = blank();
    const r = run([{ op: 'trace', image: 'clear.png' }], before, using(rasterOf(10, 10, () => [0, 0, 0, 0])));
    expect(error(r).code).toBe('invalid_input');
    expect(r.doc).toBe(before);
  });

  it('refuses a stacked image that speckle filtering wipes out', () => {
    const before = blank();
    const r = run([{ op: 'trace', image: 'tiny.png', method: 'stacked', speckle: 64 }], before, using(rasterOf(3, 3, () => rgba(RED))));
    expect(error(r)).toMatchObject({ code: 'invalid_input', message: 'nothing left to trace after speckle filtering', hint: 'Lower speckle or raise max_size.' });
    expect(r.doc).toBe(before);
  });

  it.each<[string, Record<string, unknown>]>([
    ['one color', { colors: 1 }],
    ['more than 32 colors', { colors: 33 }],
    ['a fraction of a color', { colors: 2.5 }],
    ['an unknown method', { method: 'layered' }],
    ['a speckle above 64', { speckle: 65 }],
    ['a negative speckle', { speckle: -1 }],
    ['a max_size below 64', { max_size: 63 }],
    ['a max_size above 2048', { max_size: 2049 }],
    ['an empty image', { image: '' }],
    ['an unknown field', { palette: ['#ffffff'] }],
    ['a fractional region', { region: { x: 0.5, y: 0, width: 10, height: 10 } }],
    ['a negative region origin', { region: { x: -1, y: 0, width: 10, height: 10 } }],
    ['an empty region', { region: { x: 0, y: 0, width: 0, height: 10 } }],
  ])('rejects %s', (_name, bad) => {
    const before = blank();
    const r = run([{ op: 'trace', image: 's.png', ...bad }], before);
    expect(error(r).code).toBe('invalid_input');
    expect(r.doc).toBe(before);
  });
});
