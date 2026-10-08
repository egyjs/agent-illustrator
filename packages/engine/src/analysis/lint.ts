import { formatHex, oklch, parse, rgb, toGamut, wcagLuminance } from 'culori';
import RBush from 'rbush';
import { booleanOp, type Shape } from '../geometry/boolean.ts';
import { signedArea } from '../geometry/flatten.ts';
import type { Box } from '../geometry/types.ts';
import { rasterize, type RasterFonts } from '../render/raster.ts';
import { contrastRatio, resolvePaint } from '../scene/color.ts';
import type { Doc, GroupNode, PathNode, SceneNode, TextNode } from '../scene/model.ts';
import { getNode, subtreeIds, worldBounds, worldSubpaths, worldTransform } from '../scene/query.ts';
import type { Indexed } from './spatial-index.ts';

export const LINT_CHECKS = ['off_canvas', 'degenerate', 'tiny', 'near_miss', 'text_overlap', 'overlap', 'contrast'] as const;
export type LintCheck = (typeof LINT_CHECKS)[number];
/** Illustrations overlap on purpose, so `overlap` only runs when asked for. */
export const DEFAULT_CHECKS: readonly LintCheck[] = LINT_CHECKS.filter((c) => c !== 'overlap');
/** The checks that are cheap and need no rendering: what `apply_ops` runs on the nodes it touched. */
export const INCREMENTAL_CHECKS: readonly LintCheck[] = ['off_canvas', 'degenerate', 'tiny', 'near_miss', 'text_overlap'];

export type LintIssue = {
  readonly code: string;
  readonly severity: 'warning' | 'info';
  readonly ids: string[];
  readonly message: string;
  readonly hint: string;
  /** A ready op call that resolves the issue. */
  readonly fix?: { readonly op: string; readonly [key: string]: unknown };
};

export type LintOptions = {
  /** Default: every check except `overlap`. */
  readonly checks?: readonly LintCheck[];
  /** Only these nodes (and everything below them) are checked, and only pairs that include one of them. */
  readonly ids?: readonly string[];
  /** Fonts for the renders behind the contrast check. */
  readonly fonts?: RasterFonts;
  /** How far apart two edges may be to count as a near miss; default 2. */
  readonly tolerance?: number;
  /** Shapes whose larger side is under this are reported as tiny; default 2. */
  readonly tinySize?: number;
  /** Default 50. */
  readonly maxIssues?: number;
};

/** `truncated` is true when issues were cut at maxIssues or a check stopped at its own cap. */
export type LintResult = { readonly issues: LintIssue[]; readonly truncated: boolean; readonly checked: LintCheck[] };

const EPS = 1e-6;
/** Edge values this close (px) count as aligned. */
const ALIGNED = 0.5;
/** Two boxes are compared for near misses only when they are within this share of the canvas's shorter side of each other. */
const NEAR_SHARE = 0.1;
const MAX_NEAR_MISSES = 10;
const MAX_SIBLINGS = 300;
const MAX_OVERLAP_PAIRS = 200;
const MAX_CONTRAST_TEXTS = 50;
/** The contrast check gives up after this long, in total. */
const CONTRAST_BUDGET_MS = 2000;
/** A backdrop pixel counts when it is at least this opaque (of 255). */
const OPAQUE = 128;
/** With no canvas background, texts over less opaque backdrop than this share are skipped: there is nothing to measure against. */
const MIN_BACKDROP = 0.1;
/** Contrast samples render at most this many pixels; larger boxes render scaled down. */
const MAX_SAMPLE_PIXELS = 250_000;
/** A partly off-canvas shape this big is a background or a bleed, not a slip. */
const BLEED_SHARE = 0.9;

type Scope = {
  readonly doc: Doc;
  /** Every node, depth-first, back → front. */
  readonly order: readonly SceneNode[];
  readonly inScope: (id: string) => boolean;
  readonly box: (id: string) => Box | null;
  readonly tolerance: number;
  readonly tinySize: number;
  readonly fonts: RasterFonts | undefined;
  /** A check calls this when it stops early at its own cap. */
  readonly cut: () => void;
};

type Leaf = PathNode | TextNode;
const leaves = (s: Scope): Leaf[] => s.order.filter((n): n is Leaf => n.type !== 'group' && s.inScope(n.id));

/** Issue codes from the most to the least important; within a severity, issues come in this order. */
const CODE_ORDER: readonly string[] = ['off_canvas', 'degenerate', 'no_ink', 'text_overlap', 'low_contrast', 'near_miss', 'partly_off_canvas', 'tiny', 'overlap', 'empty_group'];

const round2 = (v: number) => Math.round(v * 100) / 100;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function issue(code: string, severity: LintIssue['severity'], ids: string[], message: string, hint: string, fix?: LintIssue['fix']): LintIssue {
  return fix ? { code, severity, ids, message, hint, fix } : { code, severity, ids, message, hint };
}
const deleteFix = (id: string) => ({ op: 'delete', ids: [id] });

/**
 * Checks a scene for the mistakes agents make (FR-10): shapes off the canvas, collapsed or tiny
 * shapes, almost-aligned siblings, colliding text and unreadable text. Warnings come first, then
 * infos, each in the order of CODE_ORDER and then by ids, so equal scenes give equal output and a
 * cut at maxIssues drops the least important issues.
 */
export function lint(doc: Doc, options: LintOptions = {}): LintResult {
  const { tolerance = 2, tinySize = 2, maxIssues = 50 } = options;
  const wanted = options.checks ?? DEFAULT_CHECKS;
  const checked = LINT_CHECKS.filter((c) => wanted.includes(c));
  const scoped = options.ids === undefined ? null : new Set(options.ids.flatMap((id) => subtreeIds(doc, id)));
  const boxes = new Map<string, Box | null>();
  let partial = false;
  const scope: Scope = {
    doc,
    order: inOrder(doc),
    inScope: (id) => scoped === null || scoped.has(id),
    box: (id) => {
      if (!boxes.has(id)) boxes.set(id, worldBounds(doc, id));
      return boxes.get(id)!;
    },
    tolerance,
    tinySize,
    fonts: options.fonts,
    cut: () => {
      partial = true;
    },
  };
  const found = checked.flatMap((c) => CHECKS[c](scope));
  const rank = (i: LintIssue) => (i.severity === 'warning' ? 0 : 1);
  const priority = (i: LintIssue) => CODE_ORDER.indexOf(i.code);
  found.sort((a, b) => rank(a) - rank(b) || priority(a) - priority(b) || cmp(a.ids.join(','), b.ids.join(',')));
  return { issues: found.slice(0, maxIssues), truncated: partial || found.length > maxIssues, checked };
}

function inOrder(doc: Doc): SceneNode[] {
  const out: SceneNode[] = [];
  const visit = (ids: readonly string[]): void => {
    for (const id of ids) {
      const node = doc.nodes[id]!;
      out.push(node);
      if (node.type === 'group') visit(node.children);
    }
  };
  visit(doc.root);
  return out;
}

const CHECKS: Record<LintCheck, (s: Scope) => LintIssue[]> = {
  off_canvas: offCanvas,
  degenerate,
  tiny,
  near_miss: nearMiss,
  text_overlap: textOverlap,
  overlap,
  contrast,
};

/** Whether lo..hi misses 0..size. A box that only touches the edge from outside draws nothing, unless it is a line on that edge. */
const outside = (lo: number, hi: number, size: number): boolean => hi < 0 || lo > size || (lo < hi && (hi <= 0 || lo >= size));

function offCanvas(s: Scope): LintIssue[] {
  const { width: w, height: h } = s.doc.canvas;
  const out: LintIssue[] = [];
  for (const { id } of leaves(s)) {
    const b = s.box(id);
    if (!b) continue;
    const [x0, y0, x1, y1] = [b.x, b.y, b.x + b.width, b.y + b.height].map(round2) as [number, number, number, number];
    const where = `its box spans x ${x0} to ${x1}, y ${y0} to ${y1}`;
    if (outside(x0, x1, w) || outside(y0, y1, h)) {
      out.push(
        issue('off_canvas', 'warning', [id], `"${id}" lies outside the ${w}×${h} canvas (${where})`, 'Move it onto the canvas with place, or delete it if it is a leftover.', {
          op: 'place',
          ids: [id],
          relative_to: 'canvas',
          anchor: 'center',
        }),
      );
    } else if ((x0 < 0 || y0 < 0 || x1 > w || y1 > h) && b.width < BLEED_SHARE * w && b.height < BLEED_SHARE * h) {
      out.push(
        issue('partly_off_canvas', 'info', [id], `"${id}" crosses the canvas edge (${where})`, 'Fine for a deliberate bleed. Otherwise move it inside with place, or align it to "canvas".'),
      );
    }
  }
  return out;
}

function degenerate(s: Scope): LintIssue[] {
  const out: LintIssue[] = [];
  for (const node of s.order) {
    if (!s.inScope(node.id)) continue;
    const { id } = node;
    if (node.type === 'group') {
      if (node.children.length === 0) out.push(issue('empty_group', 'info', [id], `group "${id}" has no children`, 'Delete it, or add children to it.', deleteFix(id)));
    } else if (node.type === 'text') {
      if (node.ink === null) out.push(issue('no_ink', 'warning', [id], `text "${id}" draws no glyphs`, 'The font may lack these characters. Change the text or the font, or delete the node.', deleteFix(id)));
    } else {
      const b = s.box(id);
      const problem = node.subpaths.every((sp) => sp.segs.length === 0) ? 'has no segments' : b && b.width < EPS && b.height < EPS ? 'has no size (its box is a single point)' : null;
      if (problem) out.push(issue('degenerate', 'warning', [id], `path "${id}" ${problem}`, 'It draws nothing. Delete it, or rebuild it with a shape op or path_commands.', deleteFix(id)));
    }
  }
  return out;
}

function tiny(s: Scope): LintIssue[] {
  const out: LintIssue[] = [];
  for (const { id } of leaves(s)) {
    const b = s.box(id);
    const side = b ? Math.max(b.width, b.height) : 0;
    // Boxes under EPS are reported as degenerate already.
    if (side >= EPS && side < s.tinySize) {
      out.push(issue('tiny', 'info', [id], `"${id}" is only ${round2(side)} px across`, `Anything under ${s.tinySize} px is barely visible. Enlarge it, or delete it if it is a leftover.`));
    }
  }
  return out;
}

/** The edge names `align` takes. */
type Edge = 'left' | 'right' | 'top' | 'bottom' | 'center-x' | 'center-y';
/** Edges that sit on the same axis: two boxes already lined up on one of them are aligned on that axis. */
const AXES: readonly (readonly Edge[])[] = [['left', 'right', 'center-x'], ['top', 'bottom', 'center-y']];
const edgeValue = (b: Box, e: Edge): number =>
  e === 'left' ? b.x : e === 'right' ? b.x + b.width : e === 'top' ? b.y : e === 'bottom' ? b.y + b.height : e === 'center-x' ? b.x + b.width / 2 : b.y + b.height / 2;

/**
 * The edge on which two boxes miss each other by the least, within tolerance; null when they line
 * up or are far apart. An edge on or past the canvas edge never counts: shapes that bleed off the
 * canvas differ there on purpose.
 */
function closestMiss(a: Box, b: Box, tolerance: number, canvas: Doc['canvas']): { edge: Edge; gap: number } | null {
  let best: { edge: Edge; gap: number } | null = null;
  for (const [k, axis] of AXES.entries()) {
    const size = k === 0 ? canvas.width : canvas.height;
    const gaps = axis.map((edge) => {
      const [p, q] = [edgeValue(a, edge), edgeValue(b, edge)];
      return { edge, gap: Math.abs(p - q), bleed: p <= 0 || p >= size || q <= 0 || q >= size };
    });
    if (gaps.some((g) => g.gap <= ALIGNED)) continue;
    for (const g of gaps) if (!g.bleed && g.gap <= tolerance && (!best || g.gap < best.gap)) best = g;
  }
  return best;
}

/** The larger of the horizontal and vertical gaps between two boxes; 0 when they touch or overlap. */
const apart = (a: Box, b: Box): number =>
  Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width), Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));

function nearMiss(s: Scope): LintIssue[] {
  const { width, height } = s.doc.canvas;
  const reach = NEAR_SHARE * Math.min(width, height);
  const out: LintIssue[] = [];
  const lists = [s.doc.root, ...s.order.flatMap((n) => (n.type === 'group' ? [n.children] : []))];
  for (const list of lists) {
    const boxed = list.flatMap((id) => {
      const box = s.box(id);
      return box ? [{ id, box }] : [];
    });
    // Siblings out of scope matter only as neighbours of one in scope.
    const mine = boxed.filter((it) => s.inScope(it.id));
    const near = mine.length === boxed.length ? boxed : boxed.filter((it) => s.inScope(it.id) || mine.some((m) => apart(m.box, it.box) <= reach));
    if (near.length > MAX_SIBLINGS) s.cut();
    const items = near.slice(0, MAX_SIBLINGS);
    for (const [i, a] of items.entries()) {
      for (const b of items.slice(i + 1)) {
        if ((!s.inScope(a.id) && !s.inScope(b.id)) || apart(a.box, b.box) > reach) continue;
        const miss = closestMiss(a.box, b.box, s.tolerance, s.doc.canvas);
        if (!miss) continue;
        if (out.length === MAX_NEAR_MISSES) {
          s.cut();
          return out;
        }
        out.push(
          issue(
            'near_miss',
            'warning',
            [a.id, b.id],
            `"${a.id}" and "${b.id}" almost line up: their ${miss.edge} values differ by ${round2(miss.gap)} px`,
            'If they should line up, apply the fix. If the offset is on purpose, make it clearly larger than the tolerance.',
            { op: 'align', ids: [a.id, b.id], edge: miss.edge },
          ),
        );
      }
    }
  }
  return out;
}

const indexed = (id: string, b: Box): Indexed => ({ id, minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height });

/** The first `limit` pairs of items whose boxes share positive area that `wanted` accepts, each pair once, in the items' order (R-tree candidates). */
function overlappingPairs(items: readonly Indexed[], limit: number, wanted: (a: Indexed, b: Indexed) => boolean): [Indexed, Indexed][] {
  const tree = new RBush<Indexed>().load(items);
  const rank = new Map(items.map((it, i) => [it.id, i]));
  const out: [Indexed, Indexed][] = [];
  for (const a of items) {
    const hits = tree
      .search(a)
      .filter((b) => rank.get(b.id)! > rank.get(a.id)! && Math.min(a.maxX, b.maxX) > Math.max(a.minX, b.minX) && Math.min(a.maxY, b.maxY) > Math.max(a.minY, b.minY))
      .sort((p, q) => rank.get(p.id)! - rank.get(q.id)!);
    for (const b of hits) {
      if (!wanted(a, b)) continue;
      out.push([a, b]);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * Pairs of nodes of one type with overlapping boxes, with at least one of the pair in scope. At most
 * MAX_OVERLAP_PAIRS come back, and the check is marked cut when there were more, so a pile of
 * stacked nodes costs bounded time and memory.
 */
function candidates(s: Scope, type: Leaf['type']): [Indexed, Indexed][] {
  const items = s.order.flatMap((n) => {
    const box = n.type === type ? s.box(n.id) : null;
    return box ? [indexed(n.id, box)] : [];
  });
  const pairs = overlappingPairs(items, MAX_OVERLAP_PAIRS + 1, (a, b) => s.inScope(a.id) || s.inScope(b.id));
  if (pairs.length > MAX_OVERLAP_PAIRS) {
    s.cut();
    pairs.pop();
  }
  return pairs;
}

function textOverlap(s: Scope): LintIssue[] {
  return candidates(s, 'text').map(([a, b]) => {
    const w = round2(Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
    const h = round2(Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
    return issue(
      'text_overlap',
      'warning',
      [a.id, b.id],
      `text "${a.id}" and "${b.id}" overlap by ${w}×${h} px`,
      'Move one with place (relative_to the other, anchor "top", target_anchor "bottom"), or shorten the text.',
    );
  });
}

function overlap(s: Scope): LintIssue[] {
  const out: LintIssue[] = [];
  const shapeOf = (id: string): Shape => {
    const node = s.doc.nodes[id] as PathNode;
    return { subpaths: worldSubpaths(s.doc, node), fillRule: node.fillRule };
  };
  for (const [a, b] of candidates(s, 'path')) {
    const [sa, sb] = [shapeOf(a.id), shapeOf(b.id)];
    const smaller = Math.min(Math.abs(signedArea(sa.subpaths)), Math.abs(signedArea(sb.subpaths)));
    // A line or an empty path has no fill to overlap.
    if (!(smaller > EPS)) continue;
    const common = Math.abs(signedArea(booleanOp('intersect', sa, sb).subpaths));
    if (common > 0.01 * smaller) {
      out.push(
        issue(
          'overlap',
          'info',
          [a.id, b.id],
          `"${a.id}" and "${b.id}" overlap by ${Math.round((100 * common) / smaller)}% of the smaller shape`,
          'Layered shapes are often on purpose. If not, move one away with place.',
        ),
      );
    }
  }
  return out;
}

/** The color a text node draws with: its own fill or the nearest ancestor's, black by default. Undefined for none, gradients and paints that do not resolve. */
function solidFill(doc: Doc, node: TextNode): string | undefined {
  let at: SceneNode | undefined = node;
  while (at && at.style.fill === undefined) at = at.parent === null ? undefined : getNode(doc, at.parent);
  const color = resolvePaint(doc, at?.style.fill ?? 'black');
  return color === undefined || color === 'none' || color.startsWith('url(') ? undefined : color;
}

/** The part of the canvas around a box: the box grown by 1 px and clamped. Null when the box is wholly off the canvas. */
function surround({ width, height }: Doc['canvas'], b: Box): Box | null {
  const x0 = Math.max(0, b.x - 1), y0 = Math.max(0, b.y - 1);
  const x1 = Math.min(width, b.x + b.width + 1), y1 = Math.min(height, b.y + b.height + 1);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/** The document without one node, for rendering what lies behind it. */
function without(doc: Doc, node: SceneNode): Doc {
  const nodes = { ...doc.nodes };
  delete nodes[node.id];
  const drop = (list: readonly string[]) => list.filter((id) => id !== node.id);
  if (node.parent === null) return { ...doc, nodes, root: drop(doc.root) };
  const parent = nodes[node.parent] as GroupNode;
  nodes[parent.id] = { ...parent, children: drop(parent.children) };
  return { ...doc, nodes };
}

const hex = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`;

/**
 * What lies behind a text, from the premultiplied RGBA pixels of a render on a transparent
 * backdrop: the share of pixels that are opaque (at least OPAQUE of 255), and among those the colors
 * at the 5th and 95th percentile of WCAG luminance, as '#rrggbb'. Null when no pixel is opaque.
 */
function backdrop(pixels: Uint8Array): { share: number; ends: [low: string, high: string] } | null {
  const counts = new Map<number, number>();
  let opaque = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const alpha = pixels[i + 3]!;
    if (alpha < OPAQUE) continue;
    const straight = (c: number) => Math.min(255, Math.round((c * 255) / alpha));
    const rgb = (straight(pixels[i]!) << 16) | (straight(pixels[i + 1]!) << 8) | straight(pixels[i + 2]!);
    counts.set(rgb, (counts.get(rgb) ?? 0) + 1);
    opaque++;
  }
  if (opaque === 0) return null;
  const ranked = [...counts].map(([rgb, n]) => ({ rgb, n, lum: wcagLuminance(hex(rgb)) })).sort((a, b) => a.lum - b.lum || a.rgb - b.rgb);
  const at = (rank: number): string => {
    let seen = 0;
    for (const c of ranked) {
      seen += c.n;
      if (rank < seen) return hex(c.rgb);
    }
    return hex(ranked.at(-1)!.rgb);
  };
  return { share: opaque / (pixels.length / 4), ends: [at(Math.floor(0.05 * opaque)), at(Math.min(opaque - 1, Math.floor(0.95 * opaque)))] };
}

const ratio = (a: string, b: string) => contrastRatio(a, b) ?? 1;
const intoSrgb = toGamut('rgb', 'oklch');

/** `color` drawn at this opacity over `back`, as '#rrggbb'. */
function over(color: string, opacity: number, back: string): string {
  const [f, b] = [rgb(parse(color)!), rgb(parse(back)!)];
  const mix = (p: number, q: number) => p * opacity + q * (1 - opacity);
  return formatHex({ mode: 'rgb', r: mix(f.r, b.r), g: mix(f.g, b.g), b: mix(f.b, b.b) });
}

/** The contrast of text in `color` at this opacity against the worst of these backdrops. */
const worstRatio = (color: string, opacity: number, backs: readonly string[]): number => Math.min(...backs.map((bg) => ratio(over(color, opacity, bg), bg)));

/**
 * A text color that reads on these backdrops at this opacity: the text color with its OKLCH
 * lightness moved in 0.05 steps away from the hardest backdrop until `need` holds on all of them;
 * else black or white, whichever is better. The result may still fall short, for faint text.
 */
function readableFill(fg: string, opacity: number, backs: readonly string[], need: number): string {
  const worst = (color: string) => worstRatio(color, opacity, backs);
  const hardest = backs.reduce((a, b) => (ratio(fg, b) < ratio(fg, a) ? b : a));
  const step = wcagLuminance(fg) >= wcagLuminance(hardest) ? 0.05 : -0.05;
  const lch = oklch(parse(fg)!);
  for (let k = 1; k <= 20; k++) {
    const l = lch.l + step * k;
    if (l < 0 || l > 1) break;
    const next = formatHex(intoSrgb({ mode: 'oklch', l, c: lch.c, h: lch.h ?? 0 }));
    if (worst(next) >= need) return next;
  }
  return worst('#000000') >= worst('#ffffff') ? '#000000' : '#ffffff';
}

/** How opaque a text draws, apart from its color's own alpha: its opacity and its ancestors', and the nearest fill-opacity. */
function textOpacity(doc: Doc, node: TextNode): number {
  let opacity = 1;
  let fillSet = false;
  for (let at: SceneNode | undefined = node; at; at = at.parent === null ? undefined : getNode(doc, at.parent)) {
    opacity *= at.style.opacity ?? 1;
    if (!fillSet && at.style.fillOpacity !== undefined) {
      opacity *= at.style.fillOpacity;
      fillSet = true;
    }
  }
  return opacity;
}

/** Whether the canvas has a background that paints. */
function painted({ background }: Doc['canvas'], doc: Doc): boolean {
  const color = background === undefined ? undefined : resolvePaint(doc, background);
  return color !== undefined && color !== 'none';
}

/** A text node to check: its solid color and the part of the canvas around it. */
type Sample = { readonly node: TextNode; readonly fg: string; readonly region: Box };

function contrast(s: Scope): LintIssue[] {
  const samples = leaves(s).flatMap((node): Sample[] => {
    const fg = node.type === 'text' ? solidFill(s.doc, node) : undefined;
    const box = fg === undefined ? null : s.box(node.id);
    const region = box && surround(s.doc.canvas, box);
    return node.type === 'text' && fg !== undefined && region ? [{ node, fg, region }] : [];
  });
  if (samples.length > MAX_CONTRAST_TEXTS) s.cut();
  const started = performance.now();
  const out: LintIssue[] = [];
  for (const sample of samples.slice(0, MAX_CONTRAST_TEXTS)) {
    if (performance.now() - started > CONTRAST_BUDGET_MS) {
      s.cut();
      break;
    }
    const found = lowContrast(s, sample);
    if (found) out.push(found);
  }
  return out;
}

/**
 * WCAG 1.4.3: the text color, as it shows at its opacity, against the 5th and 95th percentile
 * pixels of what lies behind the text. Only opaque backdrop counts: with no canvas background, a
 * text over mostly empty canvas has nothing to be measured against and is skipped. The fix is
 * offered only when it passes.
 */
function lowContrast(s: Scope, { node, fg, region }: Sample): LintIssue | null {
  const scale = Math.min(1, Math.sqrt(MAX_SAMPLE_PIXELS / (region.width * region.height)));
  const back = backdrop(rasterize(without(s.doc, node), { region, scale, fonts: s.fonts, background: 'transparent' }).pixels);
  if (back === null || (back.share < MIN_BACKDROP && !painted(s.doc.canvas, s.doc))) return null;
  const [a, b, c, d] = worldTransform(s.doc, node.id);
  // The size on the canvas, after any scaling by the node's groups.
  const size = node.font.size * Math.sqrt(Math.abs(a * d - b * c));
  const large = size >= 24 || (size >= 18.66 && node.font.weight >= 700);
  const need = large ? 3 : 4.5;
  const opacity = textOpacity(s.doc, node);
  const got = worstRatio(fg, opacity * (parse(fg)?.alpha ?? 1), back.ends);
  if (got >= need) return null;
  const fill = readableFill(fg, opacity, back.ends, need);
  const works = worstRatio(fill, opacity, back.ends) >= need;
  return issue(
    'low_contrast',
    'warning',
    [node.id],
    `text "${node.id}" has a contrast of ${Math.floor(got * 100) / 100}:1 against what lies behind it; ${need}:1 is needed${large ? ' for large text' : ''}`,
    works
      ? `Change its fill (the fix uses ${fill}), or put a lighter or darker shape behind it.`
      : 'Change its fill, raise its opacity, or put a lighter or darker shape behind it. No fill color alone is enough at its current opacity.',
    works ? { op: 'style', ids: [node.id], style: { fill } } : undefined,
  );
}
