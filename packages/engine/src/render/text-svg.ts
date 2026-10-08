import type { TextNode } from '../scene/model.ts';
import { pathData, type Fmt } from './svg.ts';

/** What `toSvg` needs to write a text node: markup before the element, the text attributes, and the escaped content. */
export type TextMarkup = { readonly prefix: string; readonly attrs: readonly string[]; readonly body: string };

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escapeXml = (s: string): string => s.replace(/[&<>"]/g, (c) => ESCAPES[c]!);

// resvg ignores `direction` for the paragraph base direction (spike F1), so right-to-left lines carry
// an explicit isolate: RIGHT-TO-LEFT ISOLATE … POP DIRECTIONAL ISOLATE. No `direction` attribute is
// written: browsers would swap text-anchor start/end for it and resvg would not.
const RLI = '\u{2067}';
const PDI = '\u{2069}';

/**
 * The SVG pieces of a text node, in its own coordinates. Attributes come in a fixed order and
 * defaults are left out. Point text with line breaks becomes one absolutely placed `<tspan>` per
 * non-empty line, so empty lines keep their space. Path text sits on a `<textPath>` over a copy of
 * the guide in `<defs>`.
 */
export function textMarkup(node: TextNode, n: Fmt): TextMarkup {
  const { font, at } = node;
  const attrs: string[] = [];
  if (at.kind === 'point') attrs.push(`x="${n(at.x)}"`, `y="${n(at.y)}"`);
  attrs.push(`font-family="${escapeXml(font.family)}"`, `font-size="${n(font.size)}"`);
  if (font.weight !== 400) attrs.push(`font-weight="${font.weight}"`);
  if (font.letterSpacing !== 0) attrs.push(`letter-spacing="${n(font.letterSpacing)}"`);
  if (node.anchor !== 'start') attrs.push(`text-anchor="${node.anchor}"`);
  const line = (s: string): string => escapeXml(node.direction === 'rtl' ? `${RLI}${s}${PDI}` : s);

  if (at.kind === 'path') {
    const id = `__tp_${node.id}`;
    return {
      prefix: `<defs><path id="${id}" d="${pathData(at.subpaths.slice(0, 1), n)}"/></defs>`,
      attrs,
      body: `<textPath href="#${id}" startOffset="${n(at.offset * 100)}%">${line(node.content)}</textPath>`,
    };
  }
  if (!node.content.includes('\n')) return { prefix: '', attrs, body: line(node.content) };
  const lines = node.content.split('\n').flatMap((s, i) => (s === '' ? [] : [`<tspan x="${n(at.x)}" y="${n(at.y + i * font.size * node.lineHeight)}">${line(s)}</tspan>`]));
  return { prefix: '', attrs, body: lines.join('') };
}
