import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CHECKS, INCREMENTAL_CHECKS, LINT_CHECKS, lint, type LintCheck, type LintIssue, type LintOptions, type LintResult } from '../../src/analysis/lint.ts';
import { polyline } from '../../src/geometry/paths.ts';
import { IDENTITY } from '../../src/geometry/transform.ts';
import { createRegistry } from '../../src/ops/index.ts';
import { executeBatch } from '../../src/ops/registry.ts';
import type { RasterFonts } from '../../src/render/raster.ts';
import { createDocument, type Doc, type TextNode } from '../../src/scene/model.ts';
import { docOf, expectCode, groupNode, pathNode } from '../fixtures.ts';

const font = (file: string) => fileURLToPath(new URL(`../../assets/fonts/${file}`, import.meta.url));
const FONTS: RasterFonts = { files: [font('Tajawal-Regular.ttf'), font('Tajawal-Bold.ttf')], defaultFamily: 'Tajawal' };
const registry = createRegistry();

/** A 400×300 white canvas with the result of these op calls. */
function scene(ops: unknown[], background = '#ffffff'): Doc {
  const r = executeBatch(registry, createDocument({ width: 400, height: 300, background }), ops, { fonts: FONTS });
  expect(r.ok).toBe(true);
  return r.doc;
}
const rect = (id: string, x: number, y: number, width: number, height: number, fill = '#2a9d8f') => ({ op: 'rect', id, x, y, width, height, style: { fill } });
const circle = (id: string, cx: number, cy: number, rx: number) => ({ op: 'ellipse', id, cx, cy, rx, style: { fill: '#e76f51' } });
const box = (id: string, x: number, y: number, w: number, h: number) => pathNode(id, [polyline([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true)]);
const label = (id: string, x: number, y: number, fill: string, size = 20, extra: object = {}) => ({ op: 'text', id, content: 'Overlap', x, y, size, style: { fill }, ...extra });

/** A 400×300 canvas with no background. */
function bare(ops: unknown[]): Doc {
  const r = executeBatch(registry, createDocument({ width: 400, height: 300 }), ops, { fonts: FONTS });
  expect(r.ok).toBe(true);
  return r.doc;
}

const check = (doc: Doc, checks: LintCheck[], options: LintOptions = {}): LintResult => lint(doc, { fonts: FONTS, ...options, checks });
const codes = (r: LintResult) => r.issues.map((i) => `${i.code}:${i.ids.join('+')}`);
function applied(doc: Doc, issue: LintIssue): Doc {
  expect(issue.fix).toBeDefined();
  const r = executeBatch(registry, doc, [issue.fix], { fonts: FONTS });
  expect(r.ok).toBe(true);
  return r.doc;
}
const textNode = (id: string, extra: Partial<TextNode> = {}): TextNode => ({
  id,
  type: 'text',
  parent: null,
  transform: IDENTITY,
  style: {},
  content: 'x',
  font: { family: 'Tajawal', size: 24, weight: 400, letterSpacing: 0 },
  anchor: 'start',
  direction: 'ltr',
  lineHeight: 1.2,
  at: { kind: 'point', x: 10, y: 30 },
  ink: null,
  ...extra,
});

describe('analysis/lint', () => {
  it('lists the checks, the defaults and the incremental set', () => {
    expect(LINT_CHECKS).toEqual(['off_canvas', 'degenerate', 'tiny', 'near_miss', 'text_overlap', 'overlap', 'contrast']);
    expect(DEFAULT_CHECKS).toEqual(LINT_CHECKS.filter((c) => c !== 'overlap'));
    expect(INCREMENTAL_CHECKS).toEqual(['off_canvas', 'degenerate', 'tiny', 'near_miss', 'text_overlap']);
  });

  it('finds nothing in a clean scene', () => {
    const doc = scene([
      rect('bg', 0, 0, 400, 300, '#f4f1de'),
      rect('card', 50, 50, 120, 80),
      circle('sun', 300, 90, 40),
      label('title', 60, 220, '#1d1d1d', 32, { weight: 'bold' }),
    ]);
    expect(lint(doc, { fonts: FONTS })).toEqual({ issues: [], truncated: false, checked: [...DEFAULT_CHECKS] });
  });

  describe('off_canvas', () => {
    const doc = scene([rect('gone', 500, 50, 40, 40), rect('edge', 380, 100, 40, 40), rect('bleed', -10, -10, 420, 320), rect('inside', 100, 100, 40, 40)]);

    it('warns for a shape wholly off the canvas and informs for one that crosses an edge', () => {
      const r = check(doc, ['off_canvas']);
      expect(codes(r)).toEqual(['off_canvas:gone', 'partly_off_canvas:edge']);
      expect(r.issues.map((i) => i.severity)).toEqual(['warning', 'info']);
    });

    it('lets a background or bleed that spans most of the canvas cross the edge', () => {
      expect(codes(check(doc, ['off_canvas'])).join()).not.toContain('bleed');
    });

    it('offers a place call that brings the shape back', () => {
      const [gone] = check(doc, ['off_canvas']).issues;
      expect(gone!.fix).toEqual({ op: 'place', ids: ['gone'], relative_to: 'canvas', anchor: 'center' });
      expect(codes(check(applied(doc, gone!), ['off_canvas']))).toEqual(['partly_off_canvas:edge']);
    });

    it('counts a shape that only touches the canvas edge from outside as off, but not a line on the edge', () => {
      expect(codes(check(scene([rect('flush', -40, 50, 40, 40)]), ['off_canvas']))).toEqual(['off_canvas:flush']);
      const edge = scene([{ op: 'line', id: 'frame', x1: 0, y1: 0, x2: 0, y2: 300, style: { stroke: '#000000', strokeWidth: 4 } }]);
      expect(check(edge, ['off_canvas']).issues).toEqual([]);
    });
  });

  describe('degenerate', () => {
    const ok = pathNode('ok', [polyline([[10, 10], [60, 10], [60, 40], [10, 40]], true)]);
    const doc = docOf([
      ok,
      pathNode('bare', [{ start: [10, 10], segs: [], closed: false }]),
      pathNode('dot', [{ start: [50, 50], segs: [[50, 50, 50, 50, 50, 50]], closed: false }]),
      groupNode('hollow', []),
      textNode('blank'),
    ]);

    it('reports paths without segments or size, empty groups and text that draws nothing', () => {
      const r = check(doc, ['degenerate']);
      expect(codes(r)).toEqual(['degenerate:bare', 'degenerate:dot', 'no_ink:blank', 'empty_group:hollow']);
      expect(r.issues.map((i) => i.severity)).toEqual(['warning', 'warning', 'warning', 'info']);
    });

    it('offers a delete for each', () => {
      let next = doc;
      for (const issue of check(doc, ['degenerate']).issues) {
        expect(issue.fix).toEqual({ op: 'delete', ids: issue.ids });
        next = applied(next, issue);
      }
      expect(Object.keys(next.nodes)).toEqual(['ok']);
    });

    it('does not call a straight line degenerate', () => {
      const line = pathNode('line', [polyline([[10, 10], [200, 10]], false)]);
      expect(check(docOf([line]), ['degenerate', 'tiny']).issues).toEqual([]);
    });
  });

  describe('tiny', () => {
    it('informs for shapes whose larger side is under the limit', () => {
      const doc = scene([rect('speck', 100, 100, 1.5, 1), rect('edge', 200, 100, 2, 2), rect('big', 100, 200, 40, 40)]);
      expect(codes(check(doc, ['tiny']))).toEqual(['tiny:speck']);
      expect(codes(check(doc, ['tiny'], { tinySize: 3 }))).toEqual(['tiny:edge', 'tiny:speck']);
    });
  });

  describe('near_miss', () => {
    const pair = (bx: number, by = 160, bw = 50) => scene([rect('a', 100, 100, 50, 50), rect('b', bx, by, bw, 50)]);

    it('reports siblings whose edges miss by a little and offers an align', () => {
      const doc = pair(101.5);
      const r = check(doc, ['near_miss']);
      expect(codes(r)).toEqual(['near_miss:a+b']);
      expect(r.issues[0]!.severity).toBe('warning');
      expect(r.issues[0]!.fix).toEqual({ op: 'align', ids: ['a', 'b'], edge: 'left' });
      expect(check(applied(doc, r.issues[0]!), ['near_miss']).issues).toEqual([]);
    });

    it('picks the edge that misses by the least', () => {
      // left misses by 1.8, center-x by 1.75, right by 1.7.
      expect(check(pair(101.8, 160, 49.9), ['near_miss']).issues[0]!.fix).toEqual({ op: 'align', ids: ['a', 'b'], edge: 'right' });
    });

    it('leaves aligned pairs and far-apart pairs alone', () => {
      expect(check(pair(100), ['near_miss']).issues).toEqual([]);
      expect(check(pair(105), ['near_miss']).issues).toEqual([]);
      expect(codes(check(pair(105), ['near_miss'], { tolerance: 6 }))).toEqual(['near_miss:a+b']);
    });

    it('does not flag a pair that is already aligned on an axis, however its other edges fall', () => {
      expect(check(pair(100, 160, 51), ['near_miss']).issues).toEqual([]);
      expect(check(pair(99.5, 160, 51), ['near_miss']).issues).toEqual([]); // centered on each other
    });

    it('compares only siblings', () => {
      const doc = scene([rect('a', 100, 100, 50, 50), rect('b', 101.5, 160, 50, 50), rect('c', 300, 100, 50, 50), { op: 'group', id: 'ga', ids: ['a'] }, { op: 'group', id: 'gb', ids: ['b'] }]);
      expect(codes(check(doc, ['near_miss']))).toEqual(['near_miss:ga+gb']);
    });

    it('counts a difference of half a pixel as aligned', () => {
      expect(check(pair(100.4), ['near_miss']).issues).toEqual([]);
      expect(codes(check(pair(100.6), ['near_miss']))).toEqual(['near_miss:a+b']);
    });

    it('compares only boxes within a tenth of the shorter canvas side of each other', () => {
      // The canvas is 400×300: 30 px. The boxes are 10 px apart, then 50 px.
      expect(codes(check(pair(101.5, 160), ['near_miss']))).toEqual(['near_miss:a+b']);
      expect(check(pair(101.5, 200), ['near_miss']).issues).toEqual([]);
    });

    it('ignores edges on or past the canvas edge: a sky and a ground that overshoot it', () => {
      const bleeds = scene([rect('sky', 0, 0, 400, 300), rect('ground', 0, 200, 400, 101)]);
      expect(check(bleeds, ['near_miss']).issues).toEqual([]);
      // The same overshoot short of the edge is a near miss.
      expect(codes(check(scene([rect('sky', 0, 0, 400, 250), rect('ground', 0, 200, 400, 51)]), ['near_miss']))).toEqual(['near_miss:sky+ground']);
    });

    it('reports at most ten near misses and says so', () => {
      const wide = executeBatch(
        registry,
        createDocument({ width: 4000, height: 600, background: '#ffffff' }),
        Array.from({ length: 12 }, (_, k) => [rect(`a${k}`, 300 * k, 100, 50, 50), rect(`b${k}`, 300 * k + 1.5, 160, 50, 50)]).flat(),
      ).doc;
      const r = check(wide, ['near_miss'], { maxIssues: 100 });
      expect(r.issues).toHaveLength(10);
      expect(r.truncated).toBe(true);
      expect(check(wide, ['near_miss'], { maxIssues: 100, ids: ['a0'] }).truncated).toBe(false);
    });

    it('looks at the in-scope siblings and their neighbours first, whatever the number of siblings', () => {
      const filler = Array.from({ length: 330 }, (_, k) => box(`f${k}`, 5 + (k % 30) * 3.7, 5 + Math.floor(k / 30) * 3.7, 2, 2));
      const doc = docOf([box('twin', 200, 100, 50, 50), ...filler, box('last', 201.5, 160, 50, 50)]);
      const scoped = check(doc, ['near_miss'], { ids: ['last'] });
      expect(codes(scoped)).toEqual(['near_miss:twin+last']);
      expect(scoped.truncated).toBe(false);
      // Everything at once is more than the check compares, and it says so.
      expect(check(doc, ['near_miss']).truncated).toBe(true);
    });
  });

  describe('text_overlap', () => {
    it('warns when two text boxes share area', () => {
      const doc = scene([label('one', 50, 100, '#111111'), label('two', 60, 105, '#111111'), label('far', 50, 250, '#111111')]);
      const r = check(doc, ['text_overlap']);
      expect(codes(r)).toEqual(['text_overlap:one+two']);
      expect(r.issues[0]!.severity).toBe('warning');
    });

    it('stops at 200 pairs among 600 stacked texts, quickly', () => {
      const ink = { x: 10, y: 10, width: 80, height: 20 };
      const doc = docOf(Array.from({ length: 600 }, (_, k) => textNode(`t${k}`, { ink })));
      const t0 = performance.now();
      const r = check(doc, ['text_overlap'], { maxIssues: 1000 });
      expect(performance.now() - t0).toBeLessThan(1000);
      expect(r.issues).toHaveLength(200);
      expect(r.truncated).toBe(true);
    });

    it('leaves separate lines alone', () => {
      expect(check(scene([label('one', 50, 100, '#111111'), label('two', 50, 150, '#111111')]), ['text_overlap']).issues).toEqual([]);
    });
  });

  describe('overlap', () => {
    it('is off by default and informs when shapes cover each other', () => {
      const doc = scene([circle('a', 100, 100, 50), circle('b', 130, 100, 50)]);
      expect(lint(doc, { fonts: FONTS }).issues.map((i) => i.code)).not.toContain('overlap');
      const r = check(doc, ['overlap']);
      expect(codes(r)).toEqual(['overlap:a+b']);
      expect(r.issues[0]!.severity).toBe('info');
    });

    it('confirms with the exact shapes: boxes that meet at a corner are not an overlap', () => {
      // The circles' boxes share [135, 150]², but the circles are 63.6 apart and their radii add up to 60.
      expect(check(scene([circle('a', 100, 100, 50), circle('b', 145, 145, 10)]), ['overlap']).issues).toEqual([]);
    });

    it('ignores overlaps under 1% of the smaller shape', () => {
      expect(check(scene([circle('a', 100, 100, 50), circle('b', 198, 100, 50)]), ['overlap']).issues).toEqual([]);
    });

    it('stops collecting pairs at 200 among many stacked shapes, quickly', () => {
      const t0 = performance.now();
      const r = check(docOf(Array.from({ length: 400 }, (_, k) => box(`r${k}`, 100 + (k % 7), 100, 50, 50))), ['overlap'], { maxIssues: 1000 });
      expect(performance.now() - t0).toBeLessThan(5000);
      expect(r.issues.length).toBeLessThanOrEqual(200);
      expect(r.truncated).toBe(true);
    });

    it('stops at 200 candidate pairs and says so', () => {
      const doc = scene(Array.from({ length: 21 }, (_, k) => rect(`r${k}`, 100 + k, 100, 50, 50)));
      const r = check(doc, ['overlap'], { maxIssues: 500 });
      expect(r.issues.length).toBeLessThanOrEqual(200);
      expect(r.truncated).toBe(true);
    });
  });

  describe('contrast', () => {
    const panel = rect('panel', 0, 0, 400, 300, '#888888');

    it('warns for gray text on a gray panel, and the fix makes it pass', () => {
      const doc = scene([panel, label('note', 50, 150, '#777777')]);
      const r = check(doc, ['contrast']);
      expect(codes(r)).toEqual(['low_contrast:note']);
      expect(r.issues[0]!.message).toMatch(/contrast of 1\.\d+:1.*4\.5:1 is needed/);
      expect(r.issues[0]!.fix).toMatchObject({ op: 'style', ids: ['note'], style: { fill: expect.stringMatching(/^#[0-9a-f]{6}$/) } });
      expect(check(applied(doc, r.issues[0]!), ['contrast']).issues).toEqual([]);
    });

    it('passes black on white', () => {
      expect(check(scene([label('note', 50, 150, '#000000')]), ['contrast']).issues).toEqual([]);
    });

    it('moves the color away from the backdrop, light on dark and dark on light', () => {
      const onDark = scene([rect('panel', 0, 0, 400, 300, '#222222'), label('note', 50, 150, '#333333')]);
      const [dark] = check(onDark, ['contrast']).issues;
      expect((dark!.fix!.style as { fill: string }).fill).toMatch(/^#[89a-f]/);
      const onLight = scene([label('note', 50, 150, '#aaaaaa')]);
      const [light] = check(onLight, ['contrast']).issues;
      expect((light!.fix!.style as { fill: string }).fill).toMatch(/^#[0-6]/);
    });

    it('holds large text to 3:1 and small text to 4.5:1', () => {
      // #8a8a8a on white is about 3.4:1.
      expect(codes(check(scene([label('big', 50, 100, '#8a8a8a', 40), label('small', 50, 200, '#8a8a8a', 16)]), ['contrast']))).toEqual(['low_contrast:small']);
      expect(codes(check(scene([label('bold', 50, 100, '#8a8a8a', 19, { weight: 'bold' }), label('plain', 50, 200, '#8a8a8a', 19)]), ['contrast']))).toEqual(['low_contrast:plain']);
    });

    it('resolves tokens and inherits a fill from a group', () => {
      const base = scene([panel, label('note', 50, 150, '#777777')]);
      const tokened = { ...base, tokens: { ink: '#777777' }, nodes: { ...base.nodes, note: { ...base.nodes.note!, style: { fill: 'ink' } } } };
      expect(codes(check(tokened, ['contrast']))).toEqual(['low_contrast:note']);
      const inherited = scene([panel, { op: 'text', id: 'note', content: 'Overlap', x: 50, y: 150, size: 20 }, { op: 'group', id: 'g', ids: ['note'] }, { op: 'style', ids: ['g'], style: { fill: '#777777' } }]);
      expect(codes(check(inherited, ['contrast']))).toEqual(['low_contrast:note']);
    });

    it('skips gradient fills and text off the canvas', () => {
      const base = scene([panel, label('note', 50, 150, '#777777'), label('away', 900, 150, '#777777')]);
      const graded = { ...base, defs: { fade: { kind: 'linear' as const, angle: 0, stops: [{ offset: 0, color: '#777777' }, { offset: 1, color: '#7a7a7a' }] } }, nodes: { ...base.nodes, note: { ...base.nodes.note!, style: { fill: 'fade' } } } };
      expect(check(graded, ['contrast']).issues).toEqual([]);
    });

    it('measures against what lies behind the text, not the text itself', () => {
      // The black text sits on a white halo over the gray panel. Were its own ink in the sample, black pixels would fail it.
      const doc = scene([panel, rect('halo', 40, 125, 200, 40, '#ffffff'), label('note', 50, 150, '#000000')]);
      expect(check(doc, ['contrast']).issues).toEqual([]);
    });

    it('measures only opaque backdrop: a text over nothing is skipped, and beside a panel it is held to the panel', () => {
      expect(check(bare([label('note', 50, 150, '#bbbbbb')]), ['contrast'])).toEqual({ issues: [], truncated: false, checked: ['contrast'] });
      // Light text, mostly over a dark panel, partly over empty canvas: white paper behind it would fail it.
      expect(check(bare([rect('panel', 0, 0, 100, 300, '#222222'), label('note', 50, 150, '#eeeeee')]), ['contrast']).issues).toEqual([]);
      // A canvas background does count.
      expect(codes(check(scene([label('note', 50, 150, '#bbbbbb')]), ['contrast']))).toEqual(['low_contrast:note']);
    });

    it('judges the color as it shows: through its opacity, and its fix must pass or is left out', () => {
      const text = (id: string, style: object, y = 150) => ({ op: 'text', id, content: 'Overlap', x: 50, y, size: 20, style });
      // Black at 20% is light gray on white: no color reaches 4.5:1 at that opacity.
      const faint = check(scene([text('faint', { fill: '#000000', opacity: 0.2 })]), ['contrast']);
      expect(codes(faint)).toEqual(['low_contrast:faint']);
      expect(faint.issues[0]!.fix).toBeUndefined();
      expect(faint.issues[0]!.hint).toContain('opacity');
      // At 80% a darker fill does pass, and the fix says which.
      const dim = scene([text('dim', { fill: '#888888', opacity: 0.8 })]);
      const [issue] = check(dim, ['contrast']).issues;
      expect(issue!.code).toBe('low_contrast');
      expect(check(applied(dim, issue!), ['contrast']).issues).toEqual([]);
      // Opacity from a group counts too, and so does the color's own alpha.
      const grouped = scene([text('kid', { fill: '#000000' }), { op: 'group', id: 'g', ids: ['kid'] }, { op: 'style', ids: ['g'], style: { opacity: 0.2 } }]);
      expect(codes(check(grouped, ['contrast']))).toEqual(['low_contrast:kid']);
      expect(codes(check(scene([text('see', { fill: 'rgba(0,0,0,0.2)' })]), ['contrast']))).toEqual(['low_contrast:see']);
    });

    it('gives up after two seconds in total and says so', () => {
      const doc = scene([panel, label('a', 50, 100, '#777777'), label('b', 50, 200, '#777777')]);
      const now = vi.spyOn(performance, 'now');
      now.mockReturnValueOnce(0).mockReturnValue(10_000);
      try {
        const r = check(doc, ['contrast']);
        expect(r.issues).toEqual([]);
        expect(r.truncated).toBe(true);
      } finally {
        now.mockRestore();
      }
    });

    it('samples texts beside shapes with filters, masks and opacity that lie far from them', () => {
      const doc = scene([
        rect('card', 10, 10, 40, 30),
        { op: 'filter', id: 'lift', shadow: { dy: 8, blur: 12 }, ids: ['card'] },
        rect('faded', 10, 100, 40, 30),
        { op: 'mask', id: 'faded', fade: { angle: 0, from: 1, to: 0 } },
        rect('dim', 10, 200, 40, 30),
        { op: 'style', ids: ['dim'], style: { opacity: 0.5 } },
        label('note', 250, 150, '#cccccc'),
      ]);
      expect(codes(check(doc, ['contrast']))).toEqual(['low_contrast:note']);
    });
  });

  describe('options', () => {
    const doc = scene([rect('one', 500, 50, 40, 40), rect('two', 600, 50, 40, 40), rect('p', 100, 100, 50, 50), rect('q', 101.5, 160, 50, 50), rect('r', 300, 100, 50, 50), rect('s', 301.5, 160, 50, 50)]);

    it('restricts per-node checks and pair checks to the given ids', () => {
      expect(codes(check(doc, ['off_canvas'], { ids: ['one'] }))).toEqual(['off_canvas:one']);
      expect(codes(check(doc, ['near_miss'], { ids: ['p'] }))).toEqual(['near_miss:p+q']);
      expect(codes(check(doc, ['near_miss'], { ids: ['p', 's'] }))).toEqual(['near_miss:p+q', 'near_miss:r+s']);
    });

    it('checks everything below a given group', () => {
      const grouped = scene([rect('inner', 500, 50, 40, 40), { op: 'group', id: 'box', ids: ['inner'] }, rect('other', 600, 50, 40, 40)]);
      expect(codes(check(grouped, ['off_canvas'], { ids: ['box'] }))).toEqual(['off_canvas:inner']);
    });

    it('fails on an unknown id with a hint', () => {
      expect(expectCode(() => lint(doc, { ids: ['onee'] }), 'unknown_id').hint).toContain('one');
    });

    it('runs the requested checks in their fixed order and reports which', () => {
      expect(check(doc, ['tiny', 'off_canvas']).checked).toEqual(['off_canvas', 'tiny']);
      expect(check(doc, []).checked).toEqual([]);
    });

    it('cuts at maxIssues and says so', () => {
      const full = check(doc, ['off_canvas']);
      expect(full.truncated).toBe(false);
      const cut = check(doc, ['off_canvas'], { maxIssues: 1 });
      expect(codes(cut)).toEqual(['off_canvas:one']);
      expect(cut.truncated).toBe(true);
    });

    it('lists warnings before infos, then by check priority, then ids, and cuts from the end', () => {
      const doc = scene([
        rect('gone', 500, 50, 40, 40),
        rect('a', 100, 200, 50, 50),
        rect('b', 101.5, 250, 50, 50),
        label('one', 50, 100, '#111111'),
        label('two', 60, 105, '#111111'),
        rect('edge', 380, 100, 20, 40),
        rect('speck', 300, 20, 1, 1),
      ]);
      const checks: LintCheck[] = ['tiny', 'near_miss', 'off_canvas', 'text_overlap'];
      expect(codes(check(doc, checks))).toEqual(['off_canvas:gone', 'text_overlap:one+two', 'near_miss:a+b', 'tiny:speck']);
      const cut = check(doc, checks, { maxIssues: 2 });
      expect(codes(cut)).toEqual(['off_canvas:gone', 'text_overlap:one+two']);
      expect(cut.truncated).toBe(true);
    });

    it('lists warnings before infos, then by code and ids', () => {
      const mixed = scene([rect('z', 500, 50, 40, 40), rect('a', 380, 100, 40, 40), rect('b', 0, 0, 1, 1)]);
      expect(codes(check(mixed, ['off_canvas', 'tiny']))).toEqual(['off_canvas:z', 'partly_off_canvas:a', 'tiny:b']);
    });
  });

  it('is deterministic whatever order the node map was built in', () => {
    const doc = scene([rect('bg', 0, 0, 400, 300, '#888888'), label('note', 50, 150, '#777777'), rect('gone', 500, 50, 40, 40), rect('p', 100, 100, 50, 50), rect('q', 101.5, 160, 50, 50)]);
    const reversed: Doc = { ...doc, nodes: Object.fromEntries(Object.entries(doc.nodes).reverse()) };
    const first = lint(doc, { fonts: FONTS });
    expect(first.issues.length).toBeGreaterThan(2);
    expect(lint(doc, { fonts: FONTS })).toEqual(first);
    expect(lint(reversed, { fonts: FONTS })).toEqual(first);
  });
});
