import { castDraft } from 'immer';
import { z } from 'zod';
import { EngineError } from '../errors.ts';
import { cubicLength } from '../geometry/bezier.ts';
import type { Subpath } from '../geometry/types.ts';
import { measureInk } from '../render/text-metrics.ts';
import { FONT_FAMILY_PATTERN, type TextNode } from '../scene/model.ts';
import { worldSubpaths } from '../scene/query.ts';
import { removeSubtree } from '../scene/store.ts';
import { common, insertNew } from './common.ts';
import { defineOp, Length, type OpContext } from './registry.ts';

const MAX_SIZE = 10_000;
const WEIGHTS = { normal: 400, bold: 700 } as const;

// XML 1.0 forbids control characters and lone surrogates; the renderer refuses to parse them.
// eslint-disable-next-line no-control-regex -- matching them is the point
const UNPRINTABLE = /[\u{0}-\u{8}\u{B}\u{C}\u{E}-\u{1F}\u{FFFE}\u{FFFF}]|\p{Cs}/u;
const Content = z
  .string()
  .min(1)
  .max(2000)
  .refine((s) => /\S/.test(s), 'content needs at least one visible character')
  .refine((s) => !UNPRINTABLE.test(s), 'content has control characters or unpaired surrogates; remove them (a line break is "\\n")');
const Line = Content.refine((s) => !s.includes('\n'), 'text on a path is one line: remove the line breaks');

const FontFields = {
  size: Length.optional(),
  font: z.string().regex(FONT_FAMILY_PATTERN, 'a font family name: letters, digits, spaces, "_" or "-", at most 64 characters').optional(),
  weight: z.union([z.enum(['normal', 'bold']), z.number().int().min(100).max(900)]).optional(),
  letter_spacing: z.number().min(-1000).max(1000).optional(),
  anchor: z.enum(['start', 'middle', 'end']).optional(),
  direction: z.enum(['ltr', 'rtl', 'auto']).optional(),
};
type FontInput = z.output<z.ZodObject<typeof FontFields>>;

const RTL_LETTER = /[\u{590}-\u{8FF}\u{FB1D}-\u{FDFF}\u{FE70}-\u{FEFF}]/u;

/** Right-to-left when the first letter belongs to a right-to-left script (Hebrew, Arabic, …). */
function detectDirection(content: string): 'ltr' | 'rtl' {
  for (const ch of content) if (/\p{L}/u.test(ch)) return RTL_LETTER.test(ch) ? 'rtl' : 'ltr';
  return 'ltr';
}

const resolveDirection = (requested: 'ltr' | 'rtl' | 'auto', content: string): 'ltr' | 'rtl' => (requested === 'auto' ? detectDirection(content) : requested);

/** The font and anchor of a text node: what `input` gives, else what `prev` has, else the defaults. */
function look(ctx: OpContext, op: string, input: FontInput, prev?: TextNode): Pick<TextNode, 'font' | 'anchor'> {
  const size = input.size === undefined ? (prev?.font.size ?? 24) : ctx.len(input.size, 'min');
  if (!(size > 0 && size <= MAX_SIZE)) {
    throw new EngineError('invalid_input', `${op} size must be in (0, ${MAX_SIZE}], got ${size}`, 'Use a font size in canvas units such as 24, or a percent of the shorter canvas side such as "5%".');
  }
  const weight = typeof input.weight === 'string' ? WEIGHTS[input.weight] : input.weight;
  return {
    font: {
      family: input.font ?? prev?.font.family ?? ctx.fonts?.defaultFamily ?? 'sans-serif',
      size,
      weight: weight ?? prev?.font.weight ?? 400,
      letterSpacing: input.letter_spacing ?? prev?.font.letterSpacing ?? 0,
    },
    anchor: input.anchor ?? prev?.anchor ?? 'start',
  };
}

/** The node with its ink box measured; warns when the text draws nothing. */
function measured(ctx: OpContext, node: TextNode): TextNode {
  const ink = measureInk(node, ctx.fonts);
  if (!ink) ctx.warn('no_ink', `"${node.id}" draws no glyphs (does the font have these characters?), so it has no bounds`);
  return { ...node, ink };
}

function subpathLength(sp: Subpath): number {
  let [x, y] = sp.start;
  let total = 0;
  for (const [c1x, c1y, c2x, c2y, ex, ey] of sp.segs) {
    total += cubicLength([x, y, c1x, c1y, c2x, c2y, ex, ey]);
    [x, y] = [ex, ey];
  }
  return total;
}

export const text = defineOp({
  name: 'text',
  domain: 'text',
  description:
    'Text with its first baseline at (x, y); "\\n" starts a new line (no automatic wrapping). anchor says which side of x the text grows from: start (to the right), middle or end. ' +
    'size is canvas units or a percent of the shorter canvas side (default 24). weight is normal, bold or 100..900 (the bundled Tajawal has Regular and Bold). ' +
    'direction auto reads right-to-left scripts such as Arabic as rtl. Color it with style.fill. Text cannot join booleans or be a clip shape.',
  schema: z.strictObject({ ...common, content: Content, x: Length, y: Length, ...FontFields, line_height: z.number().min(0.5).max(4).optional() }),
  examples: [
    [{ op: 'text', id: 'title', content: 'Hello, world', x: '50%', y: 120, size: 48, weight: 'bold', anchor: 'middle', style: { fill: '#264653' } }],
    [{ op: 'text', id: 'note', content: 'Two lines\nof text', x: 40, y: 80, size: 24, line_height: 1.4, style: { fill: '#2a9d8f' } }],
    [{ op: 'text', id: 'greeting', content: 'مرحبا بالعالم', x: '50%', y: 200, size: 40, anchor: 'middle' }],
  ],
  handler(input, ctx) {
    const props = look(ctx, 'text', input);
    const at = { kind: 'point', x: ctx.len(input.x, 'x'), y: ctx.len(input.y, 'y') } as const;
    const direction = resolveDirection(input.direction ?? 'auto', input.content);
    const id = insertNew(ctx, input, 'text', (base) =>
      measured(ctx, { ...base, type: 'text', content: input.content, ...props, direction, lineHeight: input.line_height ?? 1.2, at, ink: null }),
    );
    return { id };
  },
});

export const textOnPath = defineOp({
  name: 'text_on_path',
  domain: 'text',
  description:
    'One line of text that follows the first subpath of a guide path, starting offset along it (a percent of its length, or canvas units; default 0). ' +
    'The guide is removed unless keep is true. The text copies the guide as it is now, so it does not follow later edits. Takes the same font options as text.',
  schema: z.strictObject({ ...common, content: Line, path: z.string(), offset: Length.optional(), ...FontFields, keep: z.boolean().optional() }),
  examples: [
    [
      { op: 'path_commands', id: 'wave', d: 'M60 300 C 240 100, 560 500, 740 300', style: { fill: 'none', stroke: '#8ecae6', strokeWidth: 2 } },
      { op: 'text_on_path', id: 'caption', path: 'wave', content: 'Riding the wave', size: 36, offset: '10%', keep: true, style: { fill: '#264653' } },
    ],
  ],
  handler(input, ctx) {
    const guide = ctx.node(input.path);
    if (guide.type !== 'path') {
      throw new EngineError('invalid_structure', `"${guide.id}" is a ${guide.type}, not a path`, 'Draw the guide with path_commands, path_from_points, line or a shape, and pass its id as path.');
    }
    const drawn = worldSubpaths(ctx.doc, guide).filter((sp) => sp.segs.length > 0);
    const first = drawn[0];
    const length = first === undefined ? 0 : subpathLength(first);
    if (first === undefined || !(length > 0)) {
      throw new EngineError('invalid_structure', `"${guide.id}" has no length to run text along`, 'Use a guide path with at least two different points.');
    }
    if (drawn.length > 1) ctx.warn('subpaths_ignored', `"${guide.id}" has ${drawn.length} subpaths; the text follows the first one`);
    const asked = input.offset === undefined ? 0 : typeof input.offset === 'number' ? input.offset / length : Number.parseFloat(input.offset) / 100;
    const offset = Math.min(1, Math.max(0, asked));
    if (offset !== asked) ctx.warn('offset_clamped', `offset is outside the guide; used ${offset === 0 ? 'its start' : 'its end'}`);
    const props = look(ctx, 'text_on_path', input);
    const direction = resolveDirection(input.direction ?? 'auto', input.content);
    // The guide's canvas coordinates are the new node's own, since insertNew undoes its parent's transform.
    const id = insertNew(ctx, input, 'text', (base) =>
      measured(ctx, { ...base, type: 'text', content: input.content, ...props, direction, lineHeight: 1.2, at: { kind: 'path', subpaths: [first], offset }, ink: null }),
    );
    if (!input.keep) {
      ctx.update((d) => {
        removeSubtree(d, guide.id);
      });
    }
    return { id };
  },
});

export const setText = defineOp({
  name: 'set_text',
  domain: 'text',
  description:
    'Changes a text node: its content, size, font, weight, letter_spacing, anchor, direction or line_height. Fields you leave out keep their value, ' +
    'except that new content with no direction detects the direction again. The text is measured again, so its bounds follow.',
  schema: z.strictObject({ id: z.string(), content: Content.optional(), ...FontFields, line_height: z.number().min(0.5).max(4).optional() }),
  examples: [
    [
      { op: 'text', id: 'label', content: 'Draft', x: 100, y: 100 },
      { op: 'set_text', id: 'label', content: 'Final version', weight: 'bold', size: 36 },
    ],
  ],
  handler(input, ctx) {
    const node = ctx.node(input.id);
    if (node.type !== 'text') {
      throw new EngineError('invalid_structure', `"${node.id}" is a ${node.type}, not text`, 'set_text edits nodes made by the text and text_on_path ops.');
    }
    if (Object.entries(input).every(([key, v]) => key === 'id' || v === undefined)) {
      throw new EngineError('invalid_input', 'set_text was given nothing to change', 'Give at least one of content, size, font, weight, letter_spacing, anchor, direction or line_height.');
    }
    const content = input.content ?? node.content;
    if (node.at.kind === 'path' && content.includes('\n')) {
      throw new EngineError('invalid_input', `"${node.id}" is text on a path, which is one line`, 'Remove the line breaks from content.');
    }
    const requested = input.direction ?? (input.content === undefined ? node.direction : 'auto');
    const next = measured(ctx, {
      ...node,
      content,
      ...look(ctx, 'set_text', input, node),
      direction: resolveDirection(requested, content),
      lineHeight: input.line_height ?? node.lineHeight,
    });
    ctx.update((d) => {
      d.nodes[node.id] = castDraft(next);
    });
    return { id: node.id };
  },
});
