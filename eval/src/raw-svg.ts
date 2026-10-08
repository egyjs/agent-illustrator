import { Resvg } from '@resvg/resvg-js';
import { errorText, type AssistantMessage, type ChatMessage, type ChatModel, type Usage } from './model.ts';
import { FONTS } from './paths.ts';

export type Canvas = { width: number; height: number };

/** The brief as every mode sees it, so the two are compared on the same words. */
export const briefPrompt = (b: { brief: string; canvas: Canvas }): string => `${b.brief}\n\nCanvas: ${b.canvas.width}×${b.canvas.height} px.`;

const RAW_SYSTEM = 'You write SVG by hand. Reply with one complete SVG document only: no prose, no code fences.';

/** The first complete `<svg>…</svg>` in a reply, nested `<svg>` elements included. */
export function extractSvg(reply: string): string | undefined {
  let start = -1;
  let depth = 0;
  for (const m of reply.matchAll(/<(\/?)svg(?=[\s>/])/gi)) {
    if (!m[1]) {
      if (depth++ === 0) start = m.index;
    } else if (depth > 0 && --depth === 0) {
      return reply.slice(start, reply.indexOf('>', m.index) + 1);
    }
  }
  return undefined;
}

/** Rasterizes an SVG with the bundled fonts, scaled to `width` px so every drawing compares at one size. Throws on invalid SVG. */
export function renderSvg(svg: string, width: number): Uint8Array {
  const font = { fontFiles: [...FONTS.files], loadSystemFonts: false, defaultFontFamily: FONTS.defaultFamily };
  return new Resvg(svg, { background: 'white', font, fitTo: { mode: 'width', value: width } }).render().asPng();
}

export type RawResult = {
  messages: ChatMessage[];
  usage?: Usage;
  svg?: string;
  png?: Uint8Array;
  error?: string;
};

/** The baseline: the same model and brief, no tools, one hand-written SVG. */
export async function runRaw(model: ChatModel, brief: { brief: string; canvas: Canvas }): Promise<RawResult> {
  const { width, height } = brief.canvas;
  const messages: ChatMessage[] = [
    { role: 'system', content: RAW_SYSTEM },
    { role: 'user', content: `${briefPrompt(brief)} Use width="${width}" height="${height}" viewBox="0 0 ${width} ${height}".` },
  ];
  let reply: AssistantMessage;
  try {
    reply = await model.chat(messages, []);
  } catch (e) {
    return { messages, error: errorText(e) };
  }
  messages.push(reply);
  const result: RawResult = { messages, ...(reply.usage ? { usage: reply.usage } : {}) };
  const svg = extractSvg(reply.content ?? '');
  if (svg === undefined) return { ...result, error: 'the reply contains no <svg>…</svg> document' };
  try {
    return { ...result, svg, png: renderSvg(svg, width) };
  } catch (e) {
    return { ...result, svg, error: `the SVG does not render: ${errorText(e)}` };
  }
}
