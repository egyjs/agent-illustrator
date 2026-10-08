import { formatHex, interpolate, parse, type Color } from 'culori';
import { cosSinDeg } from '../geometry/transform.ts';
import { defSvgId, resolveColor } from '../scene/color.ts';
import type { Def, Doc, FilterDef, GradientStop, MaskFade } from '../scene/model.ts';
import type { Fmt } from './svg.ts';

/** The SVG id of a node's mask; node ids never start with "__". */
export const maskSvgId = (id: string): string => `__mask_${id}`;

const NO_PAINT: Color = { mode: 'rgb', r: 0, g: 0, b: 0, alpha: 0 };

/**
 * The stops a gradient is emitted with: sorted by offset, colors resolved (a stop that no longer
 * resolves is fully transparent black), and midpoints inserted into the widest gap, mixed in OKLab,
 * until there are `min(9, max(5, 2k−1))` of them. That keeps ramps between far-apart colors smooth
 * in renderers that blend in sRGB. The stops the caller gave are kept exactly.
 */
export function gradientStops(
  stops: readonly GradientStop[],
  resolve: (color: string) => string | undefined,
): { offset: number; color: string; opacity: number }[] {
  const list = [...stops]
    .sort((a, b) => a.offset - b.offset)
    .map(({ offset, color }) => ({ offset, color: parse(resolve(color) ?? '') ?? NO_PAINT }));
  const target = Math.min(9, Math.max(5, 2 * list.length - 1));
  while (list.length < target) {
    let at = 0;
    let widest = -1;
    for (let i = 0; i + 1 < list.length; i++) {
      const gap = list[i + 1]!.offset - list[i]!.offset;
      if (gap > widest) {
        widest = gap;
        at = i;
      }
    }
    const [l, r] = [list[at]!, list[at + 1]!];
    list.splice(at + 1, 0, { offset: (l.offset + r.offset) / 2, color: interpolate([l.color, r.color], 'oklab')(0.5) });
  }
  return list.map(({ offset, color }) => ({ offset, color: formatHex(color), opacity: color.alpha ?? 1 }));
}

/** x1 y1 x2 y2 attributes (bounding-box fractions) of a gradient line through the center at `angle` degrees: 0 runs left → right, 90 top → bottom. */
function linearAttrs(angle: number, n: Fmt): string {
  const [c, s] = cosSinDeg(angle);
  return `x1="${n(0.5 - c / 2)}" y1="${n(0.5 - s / 2)}" x2="${n(0.5 + c / 2)}" y2="${n(0.5 + s / 2)}"`;
}

function filterMarkup(doc: Doc, id: string, def: FilterDef, n: Fmt): string {
  const parts: string[] = [];
  if (def.blur !== undefined && def.blur > 0) parts.push(`<feGaussianBlur in="SourceGraphic" stdDeviation="${n(def.blur)}" result="blur"/>`);
  if (def.shadow) {
    const { dx, dy, blur, color } = def.shadow;
    const flood = parse(resolveColor(doc, color) ?? '') ?? NO_PAINT;
    const input = parts.length > 0 ? 'blur' : 'SourceGraphic';
    parts.push(
      `<feDropShadow in="${input}" dx="${n(dx)}" dy="${n(dy)}" stdDeviation="${n(blur)}" flood-color="${formatHex(flood)}" flood-opacity="${n(flood.alpha ?? 1)}"/>`,
    );
  }
  return `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">${parts.join('')}</filter>`;
}

function defMarkup(doc: Doc, name: string, def: Def, n: Fmt): string {
  const id = defSvgId(name);
  if (def.kind === 'filter') return filterMarkup(doc, id, def, n);
  const stops = gradientStops(def.stops, (c) => resolveColor(doc, c))
    .map((s) => `<stop offset="${n(s.offset)}" stop-color="${s.color}"${s.opacity < 1 ? ` stop-opacity="${n(s.opacity)}"` : ''}/>`)
    .join('');
  if (def.kind === 'linear') return `<linearGradient id="${id}" ${linearAttrs(def.angle, n)}>${stops}</linearGradient>`;
  const focal = def.focal ? ` fx="${n(def.focal[0])}" fy="${n(def.focal[1])}"` : '';
  return `<radialGradient id="${id}" cx="${n(def.center[0])}" cy="${n(def.center[1])}" r="${n(def.radius)}"${focal}>${stops}</radialGradient>`;
}

/**
 * `<defs>` with every def a node (or the canvas background) references, sorted by name; '' when
 * none. Unused defs are not emitted.
 */
export function defsMarkup(doc: Doc, n: Fmt): string {
  const used = new Set<string>();
  const want = (name: string | undefined, filter: boolean) => {
    if (name === undefined || !Object.hasOwn(doc.defs, name) || (!filter && Object.hasOwn(doc.tokens, name))) return;
    if ((doc.defs[name]!.kind === 'filter') === filter) used.add(name);
  };
  want(doc.canvas.background, false);
  for (const node of Object.values(doc.nodes)) {
    want(node.style.fill, false);
    want(node.style.stroke, false);
    want(node.style.filter, true);
  }
  if (used.size === 0) return '';
  const names = [...used].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `<defs>${names.map((name) => defMarkup(doc, name, doc.defs[name]!, n)).join('')}</defs>`;
}

/**
 * The `<mask>` for a node's opacity fade. Its gradient is in bounding-box fractions, and the mask
 * reaches 50% past the box on every side so strokes and shadows outside the box are not cut.
 */
export function maskMarkup(id: string, mask: MaskFade, n: Fmt): string {
  const gid = `__maskg_${id}`;
  const stops = `<stop offset="0" stop-color="#ffffff" stop-opacity="${n(mask.from)}"/><stop offset="1" stop-color="#ffffff" stop-opacity="${n(mask.to)}"/>`;
  const gradient =
    mask.type === 'radial'
      ? `<radialGradient id="${gid}" gradientUnits="userSpaceOnUse" cx="0.5" cy="0.5" r="0.5">${stops}</radialGradient>`
      : `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" ${linearAttrs(mask.angle, n)}>${stops}</linearGradient>`;
  return (
    `<mask id="${maskSvgId(id)}" maskContentUnits="objectBoundingBox" x="-50%" y="-50%" width="200%" height="200%">${gradient}` +
    `<rect x="-0.5" y="-0.5" width="2" height="2" fill="url(#${gid})"/></mask>`
  );
}
