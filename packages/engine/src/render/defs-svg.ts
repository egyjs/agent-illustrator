/* eslint-disable @typescript-eslint/no-unused-vars -- stub; the implementing task deletes this line */
import type { Doc, MaskFade } from '../scene/model.ts';
import type { Fmt } from './svg.ts';

/** The SVG id of a node's mask; node ids never start with "__". */
export const maskSvgId = (id: string): string => `__mask_${id}`;

/** STUB (filled by the M5 paint-defs task): `<defs>` with every gradient and filter def a node style references; '' when none. */
export function defsMarkup(_doc: Doc, _n: Fmt): string {
  return '';
}

/** STUB (filled by the M5 paint-defs task): the `<mask>` element for a node's opacity fade. */
export function maskMarkup(_id: string, _mask: MaskFade, _n: Fmt): string {
  return '';
}
