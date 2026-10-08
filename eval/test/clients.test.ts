import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDocument, createRegistry, executeBatch } from '@agent-illustrator/engine';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { claudeArgs, claudeCodeClient, mcpConfig, parseClaudeEvents, resolveLauncher, type ClientInput, type ClientResult, type ClientRunner } from '../src/clients.ts';
import { FONTS, PATHS } from '../src/paths.ts';
import { runBriefCli, type Brief } from '../src/run.ts';

const tmp = mkdtempSync(join(tmpdir(), 'ai-eval-clients-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

/** A fake CLI: node running the canned script in `fixtures/`. */
const fakeClaude = [process.execPath, fileURLToPath(new URL('./fixtures/fake-claude.ts', import.meta.url))] as const;
const input = (prompt: string, over: Partial<ClientInput> = {}): ClientInput => ({
  prompt,
  mcp: true,
  cwd: tmp,
  env: { AGENT_ILLUSTRATOR_DOCS_DIR: join(tmp, 'docs'), AGENT_ILLUSTRATOR_LOG_LEVEL: 'warn' },
  timeoutMs: 30_000,
  ...over,
});
const valueAfter = (args: string[], flag: string): string => args[args.indexOf(flag) + 1]!;
/** What the fake CLI prints first: its arguments, working directory, the MCP config it was given and some of its environment. */
const started = (events: unknown[]) => (events[0] as { fake: { argv: string[]; cwd: string; mcpConfig: unknown; apiKeys: string[] } }).fake;

describe('Claude Code client', () => {
  it('builds the `claude -p` arguments: prompt first, list options last, built-in tools denied, the server allowed', () => {
    const args = claudeArgs({ prompt: 'draw a cat', model: 'haiku' }, '/tmp/mcp.json');
    expect(args.slice(0, 2)).toEqual(['-p', 'draw a cat']);
    expect(valueAfter(args, '--output-format')).toBe('stream-json');
    expect(args).toContain('--verbose');
    expect(args).toContain('--strict-mcp-config');
    expect(valueAfter(args, '--setting-sources')).toBe('project'); // not the user's hooks, CLAUDE.md or plugins
    expect(args).toContain('--disable-slash-commands');
    expect(args).not.toContain('--safe-mode'); // it would drop the server config as well
    expect(valueAfter(args, '--model')).toBe('haiku');
    expect(valueAfter(args, '--tools')).toBe('');
    expect(valueAfter(args, '--disallowedTools').split(',')).toEqual(expect.arrayContaining(['Bash', 'PowerShell', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch']));
    expect(valueAfter(args, '--mcp-config')).toBe('/tmp/mcp.json');
    expect(args.slice(-2)).toEqual(['--allowedTools', 'mcp__agent-illustrator']);

    const raw = claudeArgs({ prompt: 'x' });
    expect(raw).toContain('--strict-mcp-config');
    expect(raw).toContain('--disallowedTools');
    for (const flag of ['--mcp-config', '--allowedTools', '--model']) expect(raw).not.toContain(flag);
  });

  it('runs the CLI in the given folder, hands it the server config, and parses tool calls, text, usage and cost', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-0123456789');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'token-test-0123456789');
    vi.stubEnv('OPENAI_API_KEY', 'sk-test-0123456789');
    const given = input('ok');
    const result = await claudeCodeClient({ bin: fakeClaude }).run(given);

    const start = started(result.rawEvents);
    expect(start.mcpConfig).toEqual({ mcpServers: { 'agent-illustrator': { command: process.execPath, args: [PATHS.serverCli], env: given.env } } });
    expect(start.mcpConfig).toEqual(mcpConfig(given.env));
    expect(existsSync(valueAfter(start.argv, '--mcp-config'))).toBe(false); // the temp config is gone
    expect(realpathSync(start.cwd)).toBe(realpathSync(tmp));
    expect(start.apiKeys).toEqual([]); // the subscription login must not be shadowed by an API key

    expect(result).toMatchObject({ exitCode: 0, finalText: 'Done.', turns: 5, usage: { inputTokens: 1110, outputTokens: 50, costUsd: 0.0123 } });
    expect(result.error).toBeUndefined();
    const ops = [{ op: 'rect' }, { op: 'ellipse' }];
    expect(result.toolCalls).toEqual([
      { name: 'create_document', args: { width: 320, height: 240 }, ok: true },
      { name: 'apply_ops', args: { doc_id: 'doc-1', ops }, ok: false, error: 'bad op: no such shape' },
      { name: 'apply_ops', args: { doc_id: 'doc-1', ops: [...ops, { op: 'path' }] }, ok: true },
      { name: 'render', args: { doc_id: 'doc-1' }, ok: true },
    ]);
    const events = JSON.stringify(result.rawEvents);
    expect(events).toContain('[image omitted, 5000 chars]');
    expect(events).not.toContain('AAAAAAAAAA');
    expect(result.rawEvents).toContainEqual({ type: 'non_json_line', line: 'this line is not JSON' });
    expect(result.rawEvents).toContainEqual(expect.objectContaining({ type: 'rate_limit_event' }));
  }, 30_000);

  it('gives a run without the server no MCP config', async () => {
    const result = await claudeCodeClient({ bin: fakeClaude }).run(input('ok', { mcp: false }));
    const start = started(result.rawEvents);
    expect(start.mcpConfig).toBeNull();
    expect(start.argv).not.toContain('--allowedTools');
    expect(start.argv).toContain('--strict-mcp-config');
  }, 30_000);

  it('reports an error result with the exit code', async () => {
    const result = await claudeCodeClient({ bin: fakeClaude }).run(input('error'));
    expect(result).toMatchObject({ exitCode: 1, error: 'API Error: 529 overloaded', toolCalls: [] });
  }, 30_000);

  it('kills a CLI that runs past the timeout and keeps what it had printed', async () => {
    const t0 = performance.now();
    const result = await claudeCodeClient({ bin: fakeClaude }).run(input('hang', { timeoutMs: 2000 }));
    expect(result.error).toBe('timed out after 2000 ms');
    expect(result.toolCalls).toEqual([{ name: 'create_document', args: { width: 10, height: 10 }, ok: false, error: 'no result' }]);
    expect(performance.now() - t0).toBeLessThan(15_000);
  }, 30_000);

  it('reports a CLI that cannot start', async () => {
    const result = await claudeCodeClient({ bin: ['no-such-program-for-eval-tests'] }).run(input('ok'));
    expect(result.exitCode).toBeNull();
    expect(result.error).toMatch(/could not start no-such-program-for-eval-tests/);
  }, 30_000);

  it('tells a failed run, a run without a closing event and an unknown event apart', () => {
    expect(parseClaudeEvents([{ type: 'result', subtype: 'error_max_turns', is_error: false, num_turns: 9 }])).toMatchObject({ error: 'error_max_turns', turns: 9, complete: true });
    expect(parseClaudeEvents([{ type: 'system', subtype: 'init' }, 'a string', null, { type: 'something_new' }])).toMatchObject({ finalText: '', toolCalls: [], complete: false });
    expect(parseClaudeEvents([{ type: 'assistant', message: { content: [{ type: 'text', text: 'last words' }] } }]).finalText).toBe('last words');
  });
});

describe('resolveLauncher', () => {
  // What npm writes for a global package: the shim runs `node <script> %*`.
  const shim = (script: string) => `@ECHO off\r\nGOTO start\r\n:start\r\nSETLOCAL\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${script}" %*\r\n`;

  it('runs an npm .cmd shim as node and its script, because a shell would parse the prompt', () => {
    const dir = join(tmp, 'shims');
    mkdirSync(dir);
    writeFileSync(join(dir, 'tool.cmd'), shim('node_modules\\tool\\bin\\tool.js'));
    writeFileSync(join(dir, 'native.exe'), '');
    writeFileSync(join(dir, 'native.cmd'), shim('node_modules\\native\\bin\\native.js'));
    expect(resolveLauncher('tool', 'win32', dir)).toEqual({ command: process.execPath, args: [join(dir, 'node_modules', 'tool', 'bin', 'tool.js')] });
    expect(resolveLauncher('native', 'win32', dir)).toEqual({ command: join(dir, 'native.exe'), args: [] }); // an .exe wins
    expect(resolveLauncher('missing', 'win32', dir)).toEqual({ command: 'missing', args: [] });
  });

  it('leaves other systems and explicit commands alone', () => {
    expect(resolveLauncher('claude', 'linux', 'x')).toEqual({ command: 'claude', args: [] });
    expect(resolveLauncher([process.execPath, 'fake.ts', '--flag'])).toEqual({ command: process.execPath, args: ['fake.ts', '--flag'] });
  });
});

describe.skipIf(!existsSync(PATHS.serverCli))('runBriefCli', () => {
  const brief: Brief = { id: 'unit-brief', category: 'test', brief: 'A blue sky over a white field.', canvas: { width: 320, height: 240 } };
  const SQUARE = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="red"/></svg>';
  const PNG = (file: string) => readFileSync(file).subarray(1, 4).toString('ascii') === 'PNG';

  /** The document a model would have saved through document_io, as the server writes it. */
  const savedDocument = (): string => {
    const batch = executeBatch(createRegistry(), createDocument({ width: 320, height: 240, background: '#ffffff' }), [{ op: 'rect', id: 'sky', x: 0, y: 0, width: '100%', height: '60%', style: { fill: '#9ad1ff' } }], { fonts: FONTS });
    if (!batch.ok) throw new Error('the fixture ops failed');
    return JSON.stringify(batch.doc);
  };
  const reply = (over: Partial<ClientResult> = {}): ClientResult => ({ exitCode: 0, ms: 1234, finalText: 'Done.', toolCalls: [], turns: 3, rawEvents: [{ type: 'event' }], ...over });
  /** A client that does what `make` says and remembers what it was asked. `docs` is what it writes to final.json, as the server would under AGENT_ILLUSTRATOR_DOCS_DIR. */
  const stub = (make: () => Partial<ClientResult>, docs?: string): ClientRunner & { seen: ClientInput[]; cwdExisted: boolean[] } => {
    const seen: ClientInput[] = [];
    const cwdExisted: boolean[] = [];
    return {
      name: 'claude-code',
      seen,
      cwdExisted,
      run: (given) => {
        seen.push(given);
        cwdExisted.push(existsSync(given.cwd));
        if (docs !== undefined && given.mcp) {
          const dir = given.env.AGENT_ILLUSTRATOR_DOCS_DIR!;
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, 'final.json'), docs);
        }
        return Promise.resolve(reply(make()));
      },
    };
  };
  const calls = [
    { name: 'create_document', args: { width: 320 }, ok: true },
    { name: 'apply_ops', args: { doc_id: 'd', ops: [{ op: 'rect' }, { op: 'ellipse' }] }, ok: true },
    { name: 'apply_ops', args: { doc_id: 'd', ops: [{ op: 'path' }] }, ok: false, error: 'bad' },
    { name: 'render', args: { doc_id: 'd' }, ok: true },
  ];

  it('loads the saved document, renders it, and records the metrics, files and server environment', async () => {
    const outDir = join(tmp, 'cli-tools');
    const client = stub(() => ({ toolCalls: calls, usage: { inputTokens: 1000, outputTokens: 50, costUsd: 0.5 } }), savedDocument());
    const result = await runBriefCli(client, brief, { outDir, mode: 'tools', model: 'haiku' });

    expect(result).toMatchObject({ client: 'claude-code', model: 'haiku', brief: 'unit-brief' });
    expect(result.raw).toBeUndefined();
    expect(result.tools).toEqual({ turns: 3, toolCalls: 4, toolErrors: 1, opsApplied: 2, promptTokens: 1000, completionTokens: 50, costUsd: 0.5, ms: 1234, finished: true });
    expect(JSON.parse(readFileSync(join(outDir, 'metrics.json'), 'utf8'))).toEqual(result);
    expect(readFileSync(join(outDir, 'tools.svg'), 'utf8')).toMatch(/^<svg[^>]*viewBox="0 0 320 240"[\s\S]*id="sky"/);
    expect(PNG(join(outDir, 'tools.png'))).toBe(true);
    expect(JSON.parse(readFileSync(join(outDir, 'transcript.json'), 'utf8'))).toEqual({ tools: [{ type: 'event' }] });
    expect(existsSync(join(outDir, 'docs', 'final.json'))).toBe(true);

    const [given] = client.seen;
    expect(given).toMatchObject({ mcp: true, model: 'haiku', timeoutMs: 600_000 });
    expect(given!.prompt).toContain('A blue sky over a white field.');
    expect(given!.prompt).toMatch(/Use only the agent-illustrator tools.*document_io.*"save".*"final"/);
    expect(given!.env).toMatchObject({ AGENT_ILLUSTRATOR_DOCS_DIR: join(outDir, 'docs'), AGENT_ILLUSTRATOR_RENDER_DIR: join(outDir, 'renders'), AGENT_ILLUSTRATOR_LOG_LEVEL: 'warn' });
    expect(client.cwdExisted).toEqual([true]); // a fresh folder, removed afterwards
    expect(existsSync(given!.cwd)).toBe(false);
  }, 30_000);

  it('says so when nothing was saved, when the saved file is bad, and when the CLI failed (the drawing is still rendered)', async () => {
    const none = await runBriefCli(stub(() => ({})), brief, { outDir: join(tmp, 'cli-none'), mode: 'tools' });
    expect(none.tools).toMatchObject({ finished: false, error: 'no document saved' });
    expect(existsSync(join(tmp, 'cli-none', 'tools.svg'))).toBe(false);

    const bad = await runBriefCli(stub(() => ({}), '{"nope":1}'), brief, { outDir: join(tmp, 'cli-bad'), mode: 'tools' });
    expect(bad.tools).toMatchObject({ finished: false, error: expect.stringMatching(/^the saved document does not load: /) as string });

    const late = await runBriefCli(stub(() => ({ exitCode: null, error: 'timed out after 5 ms' }), savedDocument()), brief, { outDir: join(tmp, 'cli-late'), mode: 'tools', timeoutMs: 5 });
    expect(late.tools).toMatchObject({ finished: false, error: 'timed out after 5 ms' });
    expect(PNG(join(tmp, 'cli-late', 'tools.png'))).toBe(true);
  }, 30_000);

  it('does not pass off a document from an earlier run in the same folder', async () => {
    const outDir = join(tmp, 'cli-rerun');
    await runBriefCli(stub(() => ({}), savedDocument()), brief, { outDir, mode: 'tools' });
    const again = await runBriefCli(stub(() => ({})), brief, { outDir, mode: 'tools' });
    expect(again.tools).toMatchObject({ finished: false, error: 'no document saved' });
  }, 30_000);

  it('runs raw mode without the server and renders the SVG in the reply', async () => {
    const outDir = join(tmp, 'cli-raw');
    const client = stub(() => ({ finalText: `Here:\n\`\`\`svg\n${SQUARE}\n\`\`\``, usage: { inputTokens: 10, outputTokens: 5 } }));
    const result = await runBriefCli(client, brief, { outDir, mode: 'raw' });
    expect(result.tools).toBeUndefined();
    expect(result.raw).toMatchObject({ finished: true, turns: 3, toolCalls: 0, promptTokens: 10, completionTokens: 5 });
    expect(readFileSync(join(outDir, 'raw.svg'), 'utf8')).toBe(SQUARE);
    expect(PNG(join(outDir, 'raw.png'))).toBe(true);
    expect(existsSync(join(outDir, 'docs'))).toBe(false);
    const [given] = client.seen;
    expect(given).toMatchObject({ mcp: false, env: {} });
    expect(given!.prompt).toContain('Reply with one complete SVG document only');
    expect(given!.prompt).toContain('viewBox="0 0 320 240"');

    const prose = await runBriefCli(stub(() => ({ finalText: 'I cannot draw.' })), brief, { outDir: join(tmp, 'cli-raw-prose'), mode: 'raw' });
    expect(prose.raw).toMatchObject({ finished: false, error: expect.stringMatching(/no <svg>/) as string });
    const failed = await runBriefCli(stub(() => ({ error: 'exit code 1: boom', finalText: SQUARE })), brief, { outDir: join(tmp, 'cli-raw-fail'), mode: 'raw' });
    expect(failed.raw).toMatchObject({ finished: false, error: 'exit code 1: boom' });
  }, 30_000);

  it('runs both modes and keeps both transcripts', async () => {
    const outDir = join(tmp, 'cli-both');
    const result = await runBriefCli(stub(() => ({ finalText: SQUARE }), savedDocument()), brief, { outDir });
    expect(result.tools?.finished).toBe(true);
    expect(result.raw?.finished).toBe(true);
    expect(Object.keys(JSON.parse(readFileSync(join(outDir, 'transcript.json'), 'utf8')) as object)).toEqual(['tools', 'raw']);
  }, 30_000);
});
