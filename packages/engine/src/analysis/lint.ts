import { formatHex, oklch, parse, toGamut, wcagLuminance } from 'culori';
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
/** Edge values this close count as aligned. */
const ALIGNED = 0.01;
const MAX_SIBLINGS = 300;
const MAX_OVERLAP_PAIRS = 200;
const MAX_CONTRAST_TEXTS = 50;
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

const round2 = (v: number) => Math.round(v * 100) / 100;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function issue(code: string, severity: LintIssue['severity'], ids: string[], message: string, hint: string, fix?: LintIssue['fix']): LintIssue {
  return fix ? { code, severity, ids, message, hint, fix } : { code, severity, ids, message, hint };
}
const deleteFix = (id: string) => ({ op: 'delete', ids: [id] });

/**
 * Checks a scene for the mistakes agents make (FR-10): shapes off the canvas, collapsed or tiny
 * shapes, almost-aligned siblings, colliding text and unreadable text. Warnings come first, then
 * infos, each sorted by code and ids, so equal scenes give equal output.
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
  found.sort((a, b) => rank(a) - rank(b) || cmp(a.code, b.code) || cmp(a.ids.join(','), b.ids.join(',')));
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

/** The edge on which two boxes miss each other by the least, within tolerance; null when they line up or are far apart. */
function closestMiss(a: Box, b: Box, tolerance: number): { edge: Edge; gap: number } | null {
  let best: { edge: Edge; gap: number } | null = null;
  for (const axis of AXES) {
    const gaps = axis.map((edge) => ({ edge, gap: Math.abs(edgeValue(a, edge) - edgeValue(b, edge)) }));
    if (gaps.some((g) => g.gap <= ALIGNED)) continue;
    for (const g of gaps) if (g.gap <= tolerance && (!best || g.gap < best.gap)) best = g;
  }
  return best;
}

function nearMiss(s: Scope): LintIssue[] {
  const out: LintIssue[] = [];
  const lists = [s.doc.root, ...s.order.flatMap((n) => (n.type === 'group' ? [n.children] : []))];
  for (const list of lists) {
    const items = list.flatMap((id) => {
      const box = s.box(id);
      return box ? [{ id, box }] : [];
    }).slice(0, MAX_SIBLINGS);
    for (const [i, a] of items.entries()) {
      for (const b of items.slice(i + 1)) {
        if (!s.inScope(a.id) && !s.inScope(b.id)) continue;
        const miss = closestMiss(a.box, b.box, s.tolerance);
        if (!miss) continue;
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

/** Pairs of items whose boxes share positive area, each pair once, in the items' order (R-tree candidates). */
function overlappingPairs(items: readonly Indexed[]): [Indexed, Indexed][] {
  const tree = new RBush<Indexed>().load(items);
  const rank = new Map(items.map((it, i) => [it.id, i]));
  return items.flatMap((a) =>
    tree
      .search(a)
      .filter((b) => rank.get(b.id)! > rank.get(a.id)! && Math.min(a.maxX, b.maxX) > Math.max(a.minX, b.minX) && Math.min(a.maxY, b.maxY) > Math.max(a.minY, b.minY))
      .sort((p, q) => rank.get(p.id)! - rank.get(q.id)!)
      .map((b): [Indexed, Indexed] => [a, b]),
  );
}

/** Pairs of in-scope nodes of one type with overlapping boxes, with at least one of the pair in scope. */
function candidates(s: Scope, type: Leaf['type']): [Indexed, Indexed][] {
  const items = s.order.flatMap((n) => {
    const box = n.type === type ? s.box(n.id) : null;
    return box ? [indexed(n.id, box)] : [];
  });
  return overlappingPairs(items).filter(([a, b]) => s.inScope(a.id) || s.inScope(b.id));
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
  const pairs = candidates(s, 'path');
  if (pairs.length > MAX_OVERLAP_PAIRS) s.cut();
  const out: LintIssue[] = [];
  const shapeOf = (id: string): Shape => {
    const node = s.doc.nodes[id] as PathNode;
    return { subpaths: worldSubpaths(s.doc, node), fillRule: node.fillRule };
  };
  for (const [a, b] of pairs.slice(0, MAX_OVERLAP_PAIRS)) {
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

/** The pixels at the 5th and 95th percentile of WCAG luminance in an RGBA buffer, as '#rrggbb'. */
function luminanceEnds(pixels: Uint8Array): [low: string, high: string] {
  const counts = new Map<number, number>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const rgb = (pixels[i]! << 16) | (pixels[i + 1]! << 8) | pixels[i + 2]!;
    counts.set(rgb, (counts.get(rgb) ?? 0) + 1);
  }
  const ranked = [...counts].map(([rgb, n]) => ({ rgb, n, lum: wcagLuminance(hex(rgb)) })).sort((a, b) => a.lum - b.lum || a.rgb - b.rgb);
  const total = pixels.length / 4;
  const at = (rank: number): string => {
    let seen = 0;
    for (const c of ranked) {
      seen += c.n;
      if (rank < seen) return hex(c.rgb);
    }
    return hex(ranked.at(-1)!.rgb);
  };
  return [at(Math.floor(0.05 * total)), at(Math.min(total - 1, Math.floor(0.95 * total)))];
}

const ratio = (a: string, b: string) => contrastRatio(a, b) ?? 1;
const intoSrgb = toGamut('rgb', 'oklch');

/**
 * A text color that reads on these backdrops: the text color with its OKLCH lightness moved in 0.05
 * steps away from the hardest backdrop until `need` holds on all of them; else black or white.
 */
function readableFill(fg: string, backs: readonly string[], need: number): string {
  const worst = (color: string) => Math.min(...backs.map((bg) => ratio(color, bg)));
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
  return samples.slice(0, MAX_CONTRAST_TEXTS).flatMap((sample) => lowContrast(s, sample) ?? []);
}

/** WCAG 1.4.3: the text color against the 5th and 95th percentile pixels of what lies behind the text. */
function lowContrast(s: Scope, { node, fg, region }: Sample): LintIssue | null {
  const scale = Math.min(1, Math.sqrt(MAX_SAMPLE_PIXELS / (region.width * region.height)));
  const backs = luminanceEnds(rasterize(without(s.doc, node), { region, scale, fonts: s.fonts }).pixels);
  const [a, b, c, d] = worldTransform(s.doc, node.id);
  // The size on the canvas, after any scaling by the node's groups.
  const size = node.font.size * Math.sqrt(Math.abs(a * d - b * c));
  const large = size >= 24 || (size >= 18.66 && node.font.weight >= 700);
  const need = large ? 3 : 4.5;
  const got = Math.min(...backs.map((bg) => ratio(fg, bg)));
  if (got >= need) return null;
  const fill = readableFill(fg, backs, need);
  return issue(
    'low_contrast',
    'warning',
    [node.id],
    `text "${node.id}" has a contrast of ${Math.floor(got * 100) / 100}:1 against what lies behind it; ${need}:1 is needed${large ? ' for large text' : ''}`,
    `Change its fill (the fix uses ${fill}), or put a lighter or darker shape behind it.`,
    { op: 'style', ids: [node.id], style: { fill } },
  );
}
