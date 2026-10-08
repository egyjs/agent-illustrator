/* eslint-disable @typescript-eslint/no-unused-vars -- stub; the implementing task deletes this line */
import type { TextNode } from '../scene/model.ts';
import type { Fmt } from './svg.ts';

/** What `toSvg` needs to write a text node: markup before the element, the text attributes, and the escaped content. */
export type TextMarkup = { readonly prefix: string; readonly attrs: readonly string[]; readonly body: string };

/** STUB (filled by the M8 text task). */
export function textMarkup(_node: TextNode, _n: Fmt): TextMarkup {
  throw new Error('text rendering is not implemented yet');
}
