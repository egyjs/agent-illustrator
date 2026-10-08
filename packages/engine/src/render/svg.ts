import { isStraight } from '../geometry/bezier.ts';
import { IDENTITY } from '../geometry/transform.ts';
import type { Mat6, Subpath } from '../geometry/types.ts';
import { defSvgId, resolvePaint } from '../scene/color.ts';
import type { Doc, Style } from '../scene/model.ts';
import { defsMarkup, maskMarkup, maskSvgId } from './defs-svg.ts';
import { textMarkup } from './text-svg.ts';

export type SvgOptions = { readonly precision?: number };

/** Formats a number for SVG output at a fixed precision. */
export type Fmt = (v: number) => string;

export function formatter(precision: number): Fmt {
  return (v) => {
    const r = Number(v.toFixed(precision));
    return Object.is(r, -0) ? '0' : String(r);
  };
}

/**
 * Scene → SVG string. Tokens resolve to colors, and the output depends only on the document, so
 * equal documents give equal strings (NFR-4). `precision` is the number of decimals for
 * coordinates (default 3); matrix scale and rotation terms keep 3 more.
 */
export function toSvg(doc: Doc, options: SvgOptions = {}): string {
  const precision = options.precision ?? 3;
  const n = formatter(precision);
  const fine = formatter(precision + 3);
  const { width, height, background } = doc.canvas;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${n(height)}" viewBox="0 0 ${n(width)} ${n(height)}">`];
  parts.push(defsMarkup(doc, n));
  const bg = background === undefined ? undefined : resolvePaint(doc, background);
  if (bg !== undefined && bg !== 'none') parts.push(`<rect width="${n(width)}" height="${n(height)}" fill="${bg}"/>`);
  for (const id of doc.root) parts.push(element(doc, id, n, fine));
  parts.push('</svg>');
  return parts.join('');
}

function element(doc: Doc, id: string, n: Fmt, fine: Fmt): string {
  const node = doc.nodes[id]!;
  const attrs = [`id="${node.id}"`];
  const text = node.type === 'text' ? textMarkup(node, n) : undefined;
  if (node.type === 'path') {
    attrs.push(`d="${pathData(node.subpaths, n)}"`);
    if (node.fillRule === 'evenodd') attrs.push('fill-rule="evenodd"');
  }
  if (text) attrs.push(...text.attrs);
  if (!isIdentity(node.transform)) {
    const [a, b, c, d, e, f] = node.transform;
    attrs.push(`transform="matrix(${[a, b, c, d].map(fine).join(' ')} ${n(e)} ${n(f)})"`);
  }
  let prefix = '';
  if (node.clip) {
    const rule = node.clip.fillRule === 'evenodd' ? ' clip-rule="evenodd"' : '';
    prefix = `<clipPath id="__clip_${node.id}"><path d="${pathData(node.clip.subpaths, n)}"${rule}/></clipPath>`;
    attrs.push(`clip-path="url(#__clip_${node.id})"`);
  }
  if (node.mask) {
    prefix += maskMarkup(node.id, node.mask, n);
    attrs.push(`mask="url(#${maskSvgId(node.id)})"`);
  }
  attrs.push(...styleAttrs(doc, node.style, n));
  if (node.type === 'path') return `${prefix}<path ${attrs.join(' ')}/>`;
  if (node.type === 'text') return `${prefix}${text!.prefix}<text ${attrs.join(' ')}>${text!.body}</text>`;
  const children = node.children.map((child) => element(doc, child, n, fine)).join('');
  return children === '' ? `${prefix}<g ${attrs.join(' ')}/>` : `${prefix}<g ${attrs.join(' ')}>${children}</g>`;
}

const isIdentity = (m: Mat6) => m === IDENTITY || m.every((v, i) => v === IDENTITY[i]);

/** M/L/C/Z path data. Straight segments print as L; a straight closing segment is left to Z. */
export function pathData(subpaths: readonly Subpath[], n: Fmt): string {
  const out: string[] = [];
  for (const sp of subpaths) {
    if (sp.segs.length === 0) continue;
    out.push(`M${n(sp.start[0])} ${n(sp.start[1])}`);
    let [px, py] = sp.start;
    sp.segs.forEach(([c1x, c1y, c2x, c2y, x, y], i) => {
      const straight = isStraight([px, py, c1x, c1y, c2x, c2y, x, y]);
      const closing = sp.closed && i === sp.segs.length - 1 && x === sp.start[0] && y === sp.start[1];
      if (!(straight && closing)) out.push(straight ? `L${n(x)} ${n(y)}` : `C${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(x)} ${n(y)}`);
      px = x;
      py = y;
    });
    if (sp.closed) out.push('Z');
  }
  return out.join(' ');
}

/**
 * Presentation attributes in a fixed order. A paint that no longer resolves (say, a deleted token)
 * draws nothing: fill becomes "none" rather than SVG's default black, and stroke is left out.
 */
function styleAttrs(doc: Doc, s: Style, n: Fmt): string[] {
  const out: string[] = [];
  const paint = (name: string, value: string | undefined) => {
    if (value === undefined) return;
    const color = resolvePaint(doc, value);
    if (color !== undefined) out.push(`${name}="${color}"`);
    else if (name === 'fill') out.push('fill="none"');
  };
  paint('fill', s.fill);
  if (s.fillOpacity !== undefined) out.push(`fill-opacity="${n(s.fillOpacity)}"`);
  paint('stroke', s.stroke);
  if (s.strokeWidth !== undefined) out.push(`stroke-width="${n(s.strokeWidth)}"`);
  if (s.strokeCap !== undefined) out.push(`stroke-linecap="${s.strokeCap}"`);
  if (s.strokeJoin !== undefined) out.push(`stroke-linejoin="${s.strokeJoin}"`);
  if (s.strokeDash !== undefined && s.strokeDash.length > 0) out.push(`stroke-dasharray="${s.strokeDash.map(n).join(' ')}"`);
  if (s.miterLimit !== undefined) out.push(`stroke-miterlimit="${n(s.miterLimit)}"`);
  if (s.strokeOpacity !== undefined) out.push(`stroke-opacity="${n(s.strokeOpacity)}"`);
  if (s.opacity !== undefined) out.push(`opacity="${n(s.opacity)}"`);
  const filter = s.filter === undefined || !Object.hasOwn(doc.defs, s.filter) ? undefined : doc.defs[s.filter];
  if (filter?.kind === 'filter') out.push(`filter="url(#${defSvgId(s.filter!)})"`);
  if (s.blend !== undefined && s.blend !== 'normal') out.push(`style="mix-blend-mode:${s.blend}"`);
  return out;
}
