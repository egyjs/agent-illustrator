import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { connectServer } from '../src/mcp.ts';
import { OpenAICompatibleModel, ScriptedModel, toToolSpec, type AssistantMessage, type ChatMessage, type ToolCall } from '../src/model.ts';
import { PATHS } from '../src/paths.ts';
import { extractSvg, renderSvg, runRaw } from '../src/raw-svg.ts';
import { buildReport, CRITERIA, writeReport } from '../src/report.ts';
import { loadBriefs, runBrief, type Brief, type Metrics } from '../src/run.ts';

const tmp = mkdtempSync(join(tmpdir(), 'ai-eval-test-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

const brief: Brief = { id: 'unit-brief', category: 'test', brief: 'A red square on white.', canvas: { width: 320, height: 240 } };
const isPng = (file: string) => readFileSync(file).subarray(1, 4).toString('ascii') === 'PNG';
const SQUARE = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="red"/></svg>';

const call = (id: string, name: string, args: unknown): ToolCall => ({ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } });
const calls = (...c: ToolCall[]): AssistantMessage => ({ role: 'assistant', content: null, tool_calls: c, usage: { promptTokens: 100, completionTokens: 10 } });
const say = (content: string): AssistantMessage => ({ role: 'assistant', content, usage: { promptTokens: 100, completionTokens: 10 } });

/** The doc_id the server returned to create_document, found in the tool messages so far. */
function docIdIn(messages: readonly ChatMessage[]): string {
  for (const m of messages) {
    if (m.role !== 'tool') continue;
    const id = (JSON.parse(m.content) as { doc_id?: string }).doc_id;
    if (id) return id;
  }
  throw new Error('no doc_id in the conversation yet');
}

describe('briefs', () => {
  const briefs = loadBriefs();

  it('are 20 valid, unique briefs with at least two per category', () => {
    expect(briefs).toHaveLength(20);
    expect(new Set(briefs.map((b) => b.id)).size).toBe(20);
    const perCategory = Object.values(Object.groupBy(briefs, (b) => b.category)).map((g) => g!.length);
    expect(perCategory.length).toBeGreaterThanOrEqual(7);
    expect(Math.min(...perCategory)).toBeGreaterThanOrEqual(2);
  });

  it('give every Arabic brief its text in Arabic script', () => {
    const arabic = briefs.filter((b) => b.category === 'arabic-text');
    expect(arabic.length).toBeGreaterThanOrEqual(2);
    for (const b of arabic) expect(b.brief).toMatch(/\p{Script=Arabic}/u);
  });
});

describe('rubric', () => {
  it('describes every criterion the report scores', () => {
    const rubric = readFileSync(join(PATHS.root, 'eval', 'rubric.md'), 'utf8');
    for (const c of CRITERIA) expect(rubric).toContain(`${c.label} (\`${c.key}\`)`);
  });
});

describe('toToolSpec', () => {
  it('maps an MCP tool to a chat-completions function', () => {
    const inputSchema = { type: 'object' as const, properties: { doc_id: { type: 'string' } }, required: ['doc_id'] };
    expect(toToolSpec({ name: 'render', description: 'Render it.', inputSchema })).toEqual({
      type: 'function',
      function: { name: 'render', description: 'Render it.', parameters: inputSchema },
    });
    expect(toToolSpec({ name: 'x', inputSchema: { type: 'object' } }).function.description).toBe('');
  });
});

describe('OpenAICompatibleModel', () => {
  const ok = { choices: [{ message: { content: 'hi', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'render', arguments: '{}' } }] } }], usage: { prompt_tokens: 10, completion_tokens: 2 } };
  const responder = (...responses: Response[]) => {
    const requests: { url: string; body: { messages: Record<string, unknown>[]; tools?: unknown[] } }[] = [];
    const fetchFn = ((url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(init.body as string) });
      const next = responses.shift();
      return next ? Promise.resolve(next) : Promise.reject(new Error('no response left'));
    }) as unknown as typeof fetch;
    return { requests, fetchFn };
  };
  const make = (fetchFn: typeof fetch) => new OpenAICompatibleModel({ model: 'm', apiKey: 'test-key', baseUrl: 'http://endpoint.test/v1/', backoffMs: 1, fetch: fetchFn });

  it('retries 429 and 5xx, then parses the reply, tool calls and usage', async () => {
    const { requests, fetchFn } = responder(new Response('slow down', { status: 429 }), new Response('oops', { status: 503 }), Response.json(ok));
    const history: ChatMessage[] = [
      { role: 'user', content: 'draw' },
      { role: 'assistant', content: 'ok', usage: { promptTokens: 1, completionTokens: 1 } },
    ];
    const reply = await make(fetchFn).chat(history, [toToolSpec({ name: 'render', inputSchema: { type: 'object' } })]);
    expect(requests).toHaveLength(3);
    expect(requests[0]!.url).toBe('http://endpoint.test/v1/chat/completions');
    expect(requests[0]!.body.tools).toHaveLength(1);
    expect(requests[0]!.body.messages[1]).not.toHaveProperty('usage');
    expect(reply).toEqual({
      role: 'assistant',
      content: 'hi',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'render', arguments: '{}' } }],
      usage: { promptTokens: 10, completionTokens: 2 },
    });
  });

  it('does not retry a client error and reports what the endpoint said', async () => {
    const { requests, fetchFn } = responder(new Response('{"error":"bad key"}', { status: 401 }));
    await expect(make(fetchFn).chat([{ role: 'user', content: 'x' }], [])).rejects.toThrow(/HTTP 401.*bad key/);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.body).not.toHaveProperty('tools');
  });

  it('gives up after the retries and rejects an unexpected payload', async () => {
    const { requests, fetchFn } = responder(...Array.from({ length: 4 }, () => Response.json({ choices: [] })));
    await expect(make(fetchFn).chat([{ role: 'user', content: 'x' }], [])).rejects.toThrow(/unexpected response shape/);
    expect(requests).toHaveLength(4);
  });

  it('needs EVAL_API_KEY', () => {
    vi.stubEnv('EVAL_API_KEY', '');
    expect(() => new OpenAICompatibleModel({ model: 'm' })).toThrow(/EVAL_API_KEY/);
  });
});

describe('ScriptedModel', () => {
  it('replays steps, lets a function step see the conversation, and rejects when the script runs out', async () => {
    const model = new ScriptedModel([say('one'), (messages) => say(`saw ${messages.length}`)]);
    expect((await model.chat([{ role: 'user', content: 'a' }])).content).toBe('one');
    expect((await model.chat([{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }])).content).toBe('saw 2');
    await expect(model.chat([])).rejects.toThrow(/no step 3/);
    expect(model.seen.map((m) => m.length)).toEqual([1, 2, 0]);
  });
});

describe('raw SVG baseline', () => {
  it('extracts the first complete document from prose and code fences', () => {
    expect(extractSvg(`Sure!\n\`\`\`svg\n${SQUARE}\n\`\`\`\nHope it helps.`)).toBe(SQUARE);
    expect(extractSvg(`${SQUARE}${SQUARE}`)).toBe(SQUARE);
    const nested = '<svg viewBox="0 0 9 9"><svg x="1"><rect/></svg><circle/></svg>';
    expect(extractSvg(`x ${nested} y`)).toBe(nested);
    expect(extractSvg('<SVG width="1"></SVG>')).toBe('<SVG width="1"></SVG>');
    expect(extractSvg('<svg width="1"><rect/>')).toBeUndefined();
    expect(extractSvg('no drawing here')).toBeUndefined();
  });

  it('renders at the requested width', () => {
    const png = Buffer.from(renderSvg(SQUARE, 200));
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([200, 100]);
  });

  it('turns a reply into an SVG and a PNG, and a failure into an error', async () => {
    const good = await runRaw(new ScriptedModel([say(`\`\`\`svg\n${SQUARE}\n\`\`\``)]), brief);
    expect(good.error).toBeUndefined();
    expect(good.svg).toBe(SQUARE);
    expect(Buffer.from(good.png!).subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(good.usage).toEqual({ promptTokens: 100, completionTokens: 10 });
    expect(good.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);

    expect((await runRaw(new ScriptedModel([say('I cannot draw.')]), brief)).error).toMatch(/no <svg>/);
    const unrenderable = await runRaw(new ScriptedModel([say('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect></svg>')]), brief);
    expect(unrenderable).toMatchObject({ error: expect.stringMatching(/does not render/) as string, svg: expect.any(String) as string });
    expect(unrenderable.png).toBeUndefined();
    expect((await runRaw(new ScriptedModel([]), brief)).error).toMatch(/no step 1/);
  });
});

describe.skipIf(!existsSync(PATHS.serverCli))('against the built server', () => {
  /** create_document → apply_ops (+ one malformed call) → render → a closing message; the model never calls export_svg itself. */
  const drawing = () =>
    new ScriptedModel([
      calls(call('c1', 'create_document', { width: 320, height: 240, background: '#ffffff', seed: 1 })),
      (messages) =>
        calls(
          call('c2', 'apply_ops', {
            doc_id: docIdIn(messages),
            ops: [
              { op: 'rect', id: 'sky', x: 0, y: 0, width: '100%', height: '60%', style: { fill: '#9ad1ff' } },
              { op: 'ellipse', id: 'sun', cx: 240, cy: 60, rx: 30, style: { fill: '#ffb703' } },
            ],
          }),
          call('c3', 'apply_ops', '{not json'),
        ),
      (messages) => calls(call('c4', 'render', { doc_id: docIdIn(messages) })),
      say('Done.'),
    ]);

  it('connects, lists the tools and serves the instructions', async () => {
    const conn = await connectServer({ renderDir: join(tmp, 'connect-renders') });
    try {
      expect(conn.instructions).toContain('apply_ops');
      const specs = conn.tools.map(toToolSpec);
      expect(specs.map((s) => s.function.name)).toEqual(expect.arrayContaining(['create_document', 'apply_ops', 'render', 'export_svg']));
      for (const s of specs) expect(s.function.parameters).toHaveProperty('type', 'object');
    } finally {
      await conn.close();
    }
  }, 30_000);

  it('drives one brief through the tools and writes every artifact, exporting and rendering for the model', async () => {
    const outDir = join(tmp, 'tools-run');
    const model = drawing();
    const result = await runBrief(model, brief, { outDir, mode: 'tools' });

    expect(result.tools).toMatchObject({ finished: true, turns: 4, toolCalls: 4, toolErrors: 1, opsApplied: 2, promptTokens: 400, completionTokens: 40 });
    expect(result.raw).toBeUndefined();
    expect(JSON.parse(readFileSync(join(outDir, 'metrics.json'), 'utf8'))).toEqual(result);
    expect(readFileSync(join(outDir, 'tools.svg'), 'utf8')).toMatch(/^<svg[^>]*viewBox="0 0 320 240"[\s\S]*id="sun"/);
    expect(isPng(join(outDir, 'tools.png'))).toBe(true);
    expect(existsSync(join(outDir, 'raw.png'))).toBe(false);
    expect(existsSync(join(outDir, 'renders'))).toBe(true);

    const lastCall = model.seen[3]!;
    expect(lastCall.at(-1)).toMatchObject({ role: 'user', content: [{ type: 'text' }, { type: 'image_url', image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) as string } }] });
    expect(lastCall.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(lastCall.find((m) => m.role === 'tool' && m.tool_call_id === 'c3')).toMatchObject({ content: expect.stringContaining('invalid_input') as string });

    const transcript = readFileSync(join(outDir, 'transcript.json'), 'utf8');
    expect(transcript).toContain('image omitted');
    expect(transcript).not.toContain('data:image/png');
    expect((JSON.parse(transcript) as { tools: ChatMessage[] }).tools[0]).toMatchObject({ role: 'system' });
  }, 30_000);

  it('keeps images from a model without vision and says so in the tool result', async () => {
    const model = drawing();
    await runBrief(model, brief, { outDir: join(tmp, 'novision-run'), mode: 'tools', vision: false });
    const lastCall = model.seen[3]!;
    expect(lastCall.some((m) => m.role === 'user' && typeof m.content !== 'string')).toBe(false);
    expect(lastCall.find((m) => m.role === 'tool' && m.tool_call_id === 'c4')).toMatchObject({ content: expect.stringContaining('no vision') as string });
    expect(isPng(join(tmp, 'novision-run', 'tools.png'))).toBe(true);
  }, 30_000);

  it('runs both modes on one model, and a brief without a document leaves no tools files', async () => {
    const outDir = join(tmp, 'both-run');
    const result = await runBrief(new ScriptedModel([say('Nothing to draw.'), say(SQUARE)]), brief, { outDir, mode: 'both', maxTurns: 5 });
    expect(result.tools).toMatchObject({ finished: true, turns: 1, toolCalls: 0 });
    expect(result.raw).toMatchObject({ finished: true, turns: 1, toolCalls: 0 });
    expect(existsSync(join(outDir, 'tools.svg'))).toBe(false);
    expect(readFileSync(join(outDir, 'raw.svg'), 'utf8')).toBe(SQUARE);
    expect(isPng(join(outDir, 'raw.png'))).toBe(true);
  }, 30_000);

  it('records the turn limit and a model failure instead of throwing', async () => {
    const loop = new ScriptedModel(Array.from({ length: 3 }, (_, i) => calls(call(`l${i}`, 'create_document', { width: 10, height: 10 }))));
    const limited = await runBrief(loop, brief, { outDir: join(tmp, 'limit-run'), mode: 'tools', maxTurns: 2 });
    expect(limited.tools).toMatchObject({ finished: false, turns: 2, toolCalls: 2 });
    expect(isPng(join(tmp, 'limit-run', 'tools.png'))).toBe(true);

    const failed = await runBrief(new ScriptedModel([]), brief, { outDir: join(tmp, 'fail-run'), mode: 'tools' });
    expect(failed.tools).toMatchObject({ finished: false, turns: 0, error: expect.stringMatching(/no step 1/) as string });
  }, 30_000);
});

describe('report', () => {
  const metrics = (over: Partial<Metrics> = {}): Metrics => ({
    turns: 4, toolCalls: 6, toolErrors: 1, opsApplied: 12, promptTokens: 1000, completionTokens: 200, ms: 4500, finished: true, ...over,
  });
  const runDir = join(tmp, 'fake-run');
  const put = (rel: string, data: string | Buffer) => {
    mkdirSync(join(runDir, rel, '..'), { recursive: true });
    writeFileSync(join(runDir, rel), data);
  };
  put('model-a/brief-one/metrics.json', JSON.stringify({ brief: 'brief-one', category: 'landscape', prompt: 'A lake & a "hill".', tools: metrics(), raw: metrics({ turns: 1, toolCalls: 0 }) }));
  for (const f of ['tools.png', 'raw.png', 'tools.svg', 'raw.svg', 'transcript.json']) put(`model-a/brief-one/${f}`, 'x');
  put('model-a/brief-two/metrics.json', JSON.stringify({ brief: 'brief-two', category: 'pattern', prompt: 'Dots.', tools: metrics({ finished: false, error: '<b>oops</b> & "x"' }) }));

  it('shows both drawings side by side, escapes text, and links the files', () => {
    const { html } = buildReport(runDir);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<img src="model-a/brief-one/tools.png"');
    expect(html).toContain('<img src="model-a/brief-one/raw.png"');
    expect(html.indexOf('brief-one/tools.png')).toBeLessThan(html.indexOf('brief-one/raw.png'));
    for (const f of ['transcript.json', 'tools.svg', 'raw.svg']) expect(html).toContain(`<a href="model-a/brief-one/${f}">`);
    expect(html).toContain('A lake &amp; a &quot;hill&quot;.');
    expect(html).toContain('&lt;b&gt;oops&lt;/b&gt; &amp; &quot;x&quot;');
    expect(html).not.toContain('<b>oops');
    expect(html).toContain('no image');
    expect(html).toContain('4.5');
    for (const c of CRITERIA) expect(html).toContain(c.label);
  });

  it('offers a score sheet with one empty entry per mode that ran', () => {
    const { template } = buildReport(runDir);
    const blank = { fidelity: null, composition: null, color: null, technical: null, text: null };
    expect(template.run).toBe('fake-run');
    expect(template.scores).toEqual({
      'model-a/brief-one': { tools: blank, raw: blank },
      'model-a/brief-two': { tools: blank },
    });
  });

  it('writes index.html and scores.template.json, and refuses a directory without runs', () => {
    const [html, sheet] = writeReport(runDir);
    expect(readFileSync(html!, 'utf8')).toContain('Run fake-run');
    expect(JSON.parse(readFileSync(sheet!, 'utf8'))).toEqual(buildReport(runDir).template);
    const empty = join(tmp, 'empty-run');
    mkdirSync(empty);
    expect(() => buildReport(empty)).toThrow(/no runs under/);
  });
});
