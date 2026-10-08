import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { Client } from '@modelcontextprotocol/client';
import { z } from 'zod';
import { connectServer } from './mcp.ts';
import { errorText, OpenAICompatibleModel, toToolSpec, type AssistantMessage, type ChatMessage, type ChatModel, type ImagePart, type ToolCall, type Usage } from './model.ts';
import { PATHS } from './paths.ts';
import { briefPrompt, runRaw } from './raw-svg.ts';

const USAGE = 'usage: node eval/src/run.ts --model <id> [--briefs a,b] [--mode tools|raw|both] [--max-turns 40] [--no-vision] [--run-id <id>]';

export const BriefSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  category: z.string().min(1),
  brief: z.string().min(10),
  canvas: z.strictObject({ width: z.number().positive(), height: z.number().positive() }),
});
export type Brief = z.infer<typeof BriefSchema>;

export const loadBriefs = (file = join(PATHS.briefs, 'briefs.json')): Brief[] => z.array(BriefSchema).parse(JSON.parse(readFileSync(file, 'utf8')));

export type Metrics = {
  turns: number;
  toolCalls: number;
  toolErrors: number;
  opsApplied: number;
  promptTokens: number;
  completionTokens: number;
  ms: number;
  /** Tools mode: the model ended with a reply, not a tool call or the turn limit, and a document exists. Raw mode: the reply held an SVG that rendered. */
  finished: boolean;
  error?: string;
};
/** `metrics.json` of one brief. */
export type BriefMetrics = { brief: string; category: string; prompt: string; tools?: Metrics; raw?: Metrics };
export type Mode = 'tools' | 'raw' | 'both';
export type RunOptions = {
  /** Directory for this brief's files. */
  outDir: string;
  mode?: Mode;
  maxTurns?: number;
  /** Send the render PNGs back to the model. */
  vision?: boolean;
};

const newMetrics = (): Metrics => ({ turns: 0, toolCalls: 0, toolErrors: 0, opsApplied: 0, promptTokens: 0, completionTokens: 0, ms: 0, finished: false });

function addUsage(m: Metrics, usage?: Usage): void {
  m.promptTokens += usage?.promptTokens ?? 0;
  m.completionTokens += usage?.completionTokens ?? 0;
}

type Image = { data: string; mimeType: string };
type ToolOutcome = { text: string; images: Image[]; error: boolean };

const toolError = (code: string, message: string, hint: string): ToolOutcome => ({ text: JSON.stringify({ error: { code, message, hint } }), images: [], error: true });

/** `text` as a JSON object, or undefined for anything else (an SVG, an array, malformed JSON). */
const jsonOf = (text: string): Record<string, unknown> | undefined => {
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  try {
    const res = await client.callTool({ name, arguments: args });
    return {
      text: res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n'),
      images: res.content.flatMap((b) => (b.type === 'image' ? [{ data: b.data, mimeType: b.mimeType }] : [])),
      error: res.isError === true,
    };
  } catch (e) {
    return toolError('call_failed', errorText(e), 'Check the tool name and that the arguments match its schema.');
  }
}

type Captured = { svg?: string; png?: Uint8Array; error?: string };

/** Exports and renders the document the model last worked on, whether or not it did so itself. */
async function capture(client: Client, docId: string): Promise<Captured> {
  const exported = await callTool(client, 'export_svg', { doc_id: docId });
  const rendered = await callTool(client, 'render', { doc_id: docId });
  const png = rendered.images[0];
  const failed = [exported, rendered].find((o) => o.error);
  return {
    ...(exported.error ? {} : { svg: exported.text }),
    ...(png && !rendered.error ? { png: Buffer.from(png.data, 'base64') } : {}),
    ...(failed ? { error: `final capture failed: ${failed.text.slice(0, 200)}` } : {}),
  };
}

/** Runs one tool call from the model: the tool message for the chat, the images to show, and the doc_id a successful call named. */
async function handleCall(client: Client, call: ToolCall, metrics: Metrics, vision: boolean): Promise<{ message: ChatMessage; shots: ImagePart[]; docId?: string }> {
  metrics.toolCalls++;
  const args = jsonOf(call.function.arguments || '{}');
  const out = args
    ? await callTool(client, call.function.name, args)
    : toolError('invalid_input', 'the tool arguments are not a JSON object', 'Send the arguments as one JSON object.');
  let docId: string | undefined;
  if (out.error) {
    metrics.toolErrors++;
  } else {
    const body = jsonOf(out.text);
    if (typeof body?.doc_id === 'string') docId = body.doc_id;
    if (call.function.name === 'apply_ops' && body?.committed === true && Array.isArray(body.results)) metrics.opsApplied += body.results.length;
  }
  const note = out.images.length > 0 && !vision ? '\n(The image is not shown: this run has no vision.)' : '';
  return {
    message: { role: 'tool', tool_call_id: call.id, content: (out.text || '(no text)') + note },
    shots: vision ? out.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mimeType};base64,${i.data}` } })) : [],
    ...(docId === undefined ? {} : { docId }),
  };
}

type ModeResult = { metrics: Metrics; messages: ChatMessage[]; svg?: string; png?: Uint8Array };

/** Tools mode: the server's instructions as system prompt, the brief as the user turn, tool calls until the model stops. */
async function runTools(model: ChatModel, brief: Brief, opts: { outDir: string; maxTurns: number; vision: boolean }): Promise<ModeResult> {
  const started = performance.now();
  const conn = await connectServer({ renderDir: join(opts.outDir, 'renders') });
  const metrics = newMetrics();
  const messages: ChatMessage[] = [
    { role: 'system', content: conn.instructions },
    { role: 'user', content: briefPrompt(brief) },
  ];
  const specs = conn.tools.map(toToolSpec);
  let docId: string | undefined;
  let captured: Captured = {};
  try {
    while (metrics.turns < opts.maxTurns) {
      let reply: AssistantMessage;
      try {
        reply = await model.chat(messages, specs);
      } catch (e) {
        metrics.error = errorText(e);
        break;
      }
      metrics.turns++;
      addUsage(metrics, reply.usage);
      messages.push(reply);
      const calls = reply.tool_calls ?? [];
      if (calls.length === 0) {
        metrics.finished = true;
        break;
      }
      const shots: ImagePart[] = [];
      for (const call of calls) {
        const r = await handleCall(conn.client, call, metrics, opts.vision);
        messages.push(r.message);
        shots.push(...r.shots);
        docId = r.docId ?? docId;
      }
      if (shots.length > 0) messages.push({ role: 'user', content: [{ type: 'text', text: 'Image returned by the tool call above:' }, ...shots] });
    }
    if (docId) {
      captured = await capture(conn.client, docId);
    } else {
      // Nothing to export or render: a reply without a drawing is not a finished run.
      metrics.finished = false;
      metrics.error = metrics.error ? `${metrics.error}; no document created` : 'no document created';
    }
  } finally {
    await conn.close();
  }
  if (captured.error) metrics.error ??= captured.error;
  metrics.ms = Math.round(performance.now() - started);
  return { metrics, messages, ...(captured.svg === undefined ? {} : { svg: captured.svg }), ...(captured.png ? { png: captured.png } : {}) };
}

/** Transcripts stay readable: image data URIs become a marker. */
const slim = (messages: ChatMessage[]): ChatMessage[] =>
  messages.map((m) =>
    m.role === 'user' && typeof m.content !== 'string'
      ? { ...m, content: m.content.map((p) => (p.type === 'image_url' ? { ...p, image_url: { url: `[image omitted, ${p.image_url.url.length} chars]` } } : p)) }
      : m,
  );

const put = (dir: string, name: string, data: string | Uint8Array): void => writeFileSync(join(dir, name), data);

/** Runs one brief in the chosen mode(s) and writes transcript, SVGs, PNGs and metrics into `opts.outDir`. */
export async function runBrief(model: ChatModel, brief: Brief, opts: RunOptions): Promise<BriefMetrics> {
  const { outDir, mode = 'both', maxTurns = 40, vision = true } = opts;
  mkdirSync(outDir, { recursive: true });
  const result: BriefMetrics = { brief: brief.id, category: brief.category, prompt: brief.brief };
  const transcript: Partial<Record<'tools' | 'raw', ChatMessage[]>> = {};
  if (mode !== 'raw') {
    const r = await runTools(model, brief, { outDir, maxTurns, vision });
    result.tools = r.metrics;
    transcript.tools = slim(r.messages);
    if (r.svg !== undefined) put(outDir, 'tools.svg', r.svg);
    if (r.png) put(outDir, 'tools.png', r.png);
  }
  if (mode !== 'tools') {
    const started = performance.now();
    const r = await runRaw(model, brief);
    const metrics = newMetrics();
    metrics.turns = r.messages.filter((m) => m.role === 'assistant').length;
    addUsage(metrics, r.usage);
    metrics.finished = r.png !== undefined;
    if (r.error) metrics.error = r.error;
    metrics.ms = Math.round(performance.now() - started);
    result.raw = metrics;
    transcript.raw = r.messages;
    if (r.svg !== undefined) put(outDir, 'raw.svg', r.svg);
    if (r.png) put(outDir, 'raw.png', r.png);
  }
  put(outDir, 'transcript.json', JSON.stringify(transcript, null, 2));
  put(outDir, 'metrics.json', JSON.stringify(result, null, 2));
  return result;
}

const describe = (label: string, m?: Metrics): string =>
  m ? `${label} ${m.finished ? 'done' : 'unfinished'} (${m.turns} turns, ${m.toolCalls} calls, ${m.toolErrors} errors${m.error ? `; ${m.error.slice(0, 100)}` : ''})` : '';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      model: { type: 'string' },
      briefs: { type: 'string' },
      mode: { type: 'string', default: 'both' },
      'max-turns': { type: 'string', default: '40' },
      'no-vision': { type: 'boolean', default: false },
      'run-id': { type: 'string' },
    },
  });
  const fail: (message: string) => never = (message) => {
    throw new Error(`${message}\n${USAGE}`);
  };
  if (!values.model) fail('--model is required');
  const mode = values.mode as Mode;
  if (!['tools', 'raw', 'both'].includes(mode)) fail(`--mode must be tools, raw or both, got "${values.mode}"`);
  const maxTurns = Number(values['max-turns']);
  if (!Number.isInteger(maxTurns) || maxTurns < 1) fail(`--max-turns must be a positive integer, got "${values['max-turns']}"`);

  const all = loadBriefs();
  const wanted = values.briefs?.split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = wanted?.filter((id) => !all.some((b) => b.id === id)) ?? [];
  if (unknown.length > 0) fail(`unknown brief id(s): ${unknown.join(', ')}. Known: ${all.map((b) => b.id).join(', ')}`);
  const briefs = wanted ? all.filter((b) => wanted.includes(b.id)) : all;

  const model = new OpenAICompatibleModel({ model: values.model });
  const runDir = join(PATHS.runs, values['run-id'] ?? new Date().toISOString().replace(/[-:]/g, '').slice(0, 15));
  const slug = values.model.replace(/[^\w.-]+/g, '-');
  for (const [i, brief] of briefs.entries()) {
    const r = await runBrief(model, brief, { outDir: join(runDir, slug, brief.id), mode, maxTurns, vision: !values['no-vision'] });
    console.log(`[${i + 1}/${briefs.length}] ${brief.id}: ${[describe('tools', r.tools), describe('raw', r.raw)].filter(Boolean).join(' | ')}`);
  }
  console.log(`\nRun: ${runDir}\nReport: node eval/src/report.ts ${runDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(errorText(e));
    process.exitCode = 1;
  });
}
