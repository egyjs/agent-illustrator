import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { errorText } from './model.ts';
import { PATHS } from './paths.ts';

/** The server's name in a client's MCP config. Claude Code prefixes the tool names with `mcp__<name>__`. */
export const SERVER_NAME = 'agent-illustrator';
const TOOL_PREFIX = `mcp__${SERVER_NAME}__`;

/** The CLIs there is a runner for; another one is a new `ClientRunner` and a name here. */
export type ClientName = 'claude-code';
export type ClientInput = {
  prompt: string;
  /** Give the model the agent-illustrator server (and nothing else); without it the model gets no tools at all. */
  mcp: boolean;
  /** The CLI's own model name or alias; default the CLI's default. */
  model?: string;
  /** Working directory of the CLI, an empty folder. */
  cwd: string;
  /** Environment of the MCP server process (not of the CLI). */
  env: Record<string, string>;
  timeoutMs: number;
};
export type ToolCallRecord = { name: string; args: unknown; ok: boolean; error?: string };
export type ClientUsage = { inputTokens?: number; outputTokens?: number; costUsd?: number };
export type ClientResult = {
  /** Null when the CLI did not start or was killed. */
  exitCode: number | null;
  ms: number;
  finalText: string;
  /** Every tool the model used, the server's with the bare tool name ("apply_ops"). Anything else shows under its own name, so a leak of built-in tools is visible. */
  toolCalls: ToolCallRecord[];
  usage?: ClientUsage;
  /** Model round trips (Claude Code's `num_turns`). */
  turns: number;
  /** Why the run failed (did not start, timed out, exited non-zero, reported an error); absent on a clean run. */
  error?: string;
  /** The CLI's JSON events, image data replaced by a marker. Lines that were not JSON show as `{ type: 'non_json_line' }`. */
  rawEvents: unknown[];
};
export interface ClientRunner {
  readonly name: ClientName;
  run(input: ClientInput): Promise<ClientResult>;
}

/** A program to run: its name or path, or a program with leading arguments, say `[process.execPath, 'fake-cli.ts']`. */
export type Bin = string | readonly [string, ...string[]];
export type ClientOptions = { bin?: Bin };

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const defined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
const sum = (values: unknown[]): number | undefined => {
  const numbers = values.flatMap((v) => num(v) ?? []);
  return numbers.length > 0 ? numbers.reduce((a, b) => a + b, 0) : undefined;
};

const MAX_ERROR = 300;
const clip = (text: string): string => text.trim().slice(0, MAX_ERROR);

/** The text of a tool result's `content`: a string, or blocks of which the text ones count. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.flatMap((b) => str(obj(b)?.text) ?? []).join('\n') : '';
}

/** `value` with the payload of every image (base64 under a `data` key) replaced by a marker, so transcripts stay readable. */
function omitImages(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitImages);
  const o = obj(value);
  if (!o) return value;
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === 'data' && typeof v === 'string' && v.length > 1000 ? `[image omitted, ${v.length} chars]` : omitImages(v)]));
}

/** Every line of the CLI's output as an event; a line that is not JSON (a banner, a warning) is kept as a marker. */
const parseLines = (text: string): unknown[] =>
  text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      try {
        return omitImages(JSON.parse(line));
      } catch {
        return { type: 'non_json_line', line: line.slice(0, 500) };
      }
    });

type Launcher = { command: string; args: string[] };

/**
 * The program and leading arguments for `bin`. Windows cannot spawn a `.cmd` shim without a shell, and a shell would parse the prompt,
 * so a shim on PATH is resolved to what npm's shim runs: `node <script>`.
 */
export function resolveLauncher(bin: Bin, platform: NodeJS.Platform = process.platform, pathEnv: string = process.env.PATH ?? ''): Launcher {
  if (typeof bin !== 'string') return { command: bin[0], args: bin.slice(1) };
  if (platform !== 'win32') return { command: bin, args: [] };
  const dirs = /[\\/]/.test(bin) ? [''] : pathEnv.split(';').filter(Boolean);
  const names = /\.(exe|cmd)$/i.test(bin) ? [bin] : [`${bin}.exe`, `${bin}.cmd`];
  for (const name of names) {
    for (const dir of dirs) {
      const file = dir ? join(dir, name) : name;
      if (!existsSync(file)) continue;
      if (!/\.cmd$/i.test(file)) return { command: file, args: [] };
      const script = /"%~?dp0%?\\([^"]+\.js)"/i.exec(readFileSync(file, 'utf8'))?.[1];
      return script ? { command: process.execPath, args: [join(dirname(file), ...script.split('\\'))] } : { command: file, args: [] };
    }
  }
  return { command: bin, args: [] };
}

/** Stops the CLI and what it started (the MCP server); on Windows `kill` would leave the children behind. */
function killTree(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid !== undefined) {
    if (spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true }).status === 0) return;
  }
  child.kill('SIGKILL');
}

type Execution = { exitCode: number | null; ms: number; events: unknown[]; stderr: string; failure?: string };

/** Runs one CLI call to its end: stdin closed, output collected, killed at `timeoutMs`. Never rejects; a failure to start shows as `failure`. */
function execute(launcher: Launcher, args: string[], opts: { cwd: string; timeoutMs: number; dropEnv: readonly string[] }): Promise<Execution> {
  return new Promise((resolve) => {
    const started = performance.now();
    const env = { ...process.env };
    for (const key of opts.dropEnv) delete env[key];
    let stdout = '';
    let stderr = '';
    let failure: string | undefined;
    let settled = false;
    const timers: NodeJS.Timeout[] = [];
    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      resolve({ exitCode, ms: Math.round(performance.now() - started), events: parseLines(stdout), stderr: stderr.slice(-2000), ...(failure ? { failure } : {}) });
    };
    let child: ChildProcess;
    try {
      child = spawn(launcher.command, [...launcher.args, ...args], { cwd: opts.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      failure = `could not start ${launcher.command}: ${errorText(e)}`;
      finish(null);
      return;
    }
    child.stdout?.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr?.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    child.on('error', (e) => {
      failure = `could not start ${launcher.command}: ${errorText(e)}`;
      finish(null);
    });
    child.on('close', (code) => finish(code));
    // Something the CLI started may still hold its pipes open; do not wait for them for long.
    child.on('exit', (code) => timers.push(setTimeout(() => finish(code), 2000).unref()));
    timers.push(
      setTimeout(() => {
        failure = `timed out after ${opts.timeoutMs} ms`;
        killTree(child);
      }, opts.timeoutMs),
    );
  });
}

type Parsed = {
  finalText: string;
  toolCalls: ToolCallRecord[];
  turns: number;
  usage?: ClientUsage;
  /** The CLI said the run failed. */
  error?: string;
  /** The CLI's closing event arrived. */
  complete: boolean;
};

function toResult(run: Execution, parsed: Parsed): ClientResult {
  const error =
    run.failure ??
    parsed.error ??
    (run.exitCode === 0 ? undefined : `exit code ${run.exitCode}: ${run.stderr.trim().slice(-MAX_ERROR)}`) ??
    (parsed.complete ? undefined : 'the CLI ended without a closing event');
  return {
    exitCode: run.exitCode,
    ms: run.ms,
    finalText: parsed.finalText,
    toolCalls: parsed.toolCalls,
    turns: parsed.turns,
    ...(parsed.usage ? { usage: parsed.usage } : {}),
    ...(error ? { error } : {}),
    rawEvents: run.events,
  };
}

/** The MCP config a client reads to start the server: the same stdio command a user's config has. */
export const mcpConfig = (env: Record<string, string>) => ({ mcpServers: { [SERVER_NAME]: { command: process.execPath, args: [PATHS.serverCli], env } } });

// --- Claude Code ---

/** Built-in tools the model must not have; `--tools ""` already removes them, and this list says so a second way. */
const CLAUDE_DENIED = ['Bash', 'PowerShell', 'Read', 'Write', 'Edit', 'NotebookEdit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'Agent'];

/** `claude -p` arguments. The prompt follows `-p` and the options that take lists come last, so they cannot swallow it. `mcpConfigFile` is the server config, when the model gets the server. */
export function claudeArgs(input: Pick<ClientInput, 'prompt' | 'model'>, mcpConfigFile?: string): string[] {
  return [
    '-p',
    input.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--no-session-persistence',
    // Not the user's settings, hooks, CLAUDE.md or skills: they would change what the model sees and how it behaves. (`--safe-mode` also drops `--mcp-config`.)
    '--setting-sources',
    'project',
    '--disable-slash-commands',
    ...(input.model ? ['--model', input.model] : []),
    '--strict-mcp-config',
    '--tools',
    '',
    '--disallowedTools',
    CLAUDE_DENIED.join(','),
    ...(mcpConfigFile ? ['--mcp-config', mcpConfigFile, '--allowedTools', `mcp__${SERVER_NAME}`] : []),
  ];
}

/** The tool calls, final text, usage and cost in the `--output-format stream-json` events of `claude -p`. Tolerant of event types it does not know. */
export function parseClaudeEvents(events: readonly unknown[]): Parsed {
  const toolCalls: ToolCallRecord[] = [];
  const open = new Map<string, ToolCallRecord>();
  let lastText = '';
  let result: Json | undefined;
  const blocks = (event: Json): Json[] => {
    const content = obj(event.message)?.content;
    return Array.isArray(content) ? content.map(obj).filter((b) => b !== undefined) : [];
  };
  for (const raw of events) {
    const event = obj(raw);
    if (event?.type === 'assistant') {
      for (const block of blocks(event)) {
        if (block.type === 'text' && typeof block.text === 'string') lastText = block.text;
        if (block.type !== 'tool_use' || typeof block.name !== 'string') continue;
        const call: ToolCallRecord = { name: block.name.startsWith(TOOL_PREFIX) ? block.name.slice(TOOL_PREFIX.length) : block.name, args: block.input ?? {}, ok: false, error: 'no result' };
        toolCalls.push(call);
        if (typeof block.id === 'string') open.set(block.id, call);
      }
    } else if (event?.type === 'user') {
      for (const block of blocks(event)) {
        const call = block.type === 'tool_result' && typeof block.tool_use_id === 'string' ? open.get(block.tool_use_id) : undefined;
        if (!call) continue;
        call.ok = block.is_error !== true;
        if (call.ok) delete call.error;
        else call.error = clip(textOf(block.content)) || 'tool error';
      }
    } else if (event?.type === 'result') {
      result = event;
    }
  }
  const usage = obj(result?.usage);
  const stats = result
    ? defined({
        inputTokens: sum([usage?.input_tokens, usage?.cache_creation_input_tokens, usage?.cache_read_input_tokens]),
        outputTokens: num(usage?.output_tokens),
        costUsd: num(result.total_cost_usd),
      })
    : undefined;
  return {
    finalText: str(result?.result) ?? lastText,
    toolCalls,
    turns: num(result?.num_turns) ?? toolCalls.length + 1,
    ...(stats ? { usage: stats } : {}),
    ...(result && (result.is_error === true || result.subtype !== 'success')
      ? { error: clip(str(result.result) ?? '') || str(result.subtype) || 'the CLI reported an error' }
      : {}),
    complete: result !== undefined,
  };
}

/** Claude Code through `claude -p` on the user's subscription: the model has the server's tools or none, never the built-in file, shell or web tools. */
export function claudeCodeClient(options: ClientOptions = {}): ClientRunner {
  return {
    name: 'claude-code',
    async run(input) {
      const scratch = mkdtempSync(join(tmpdir(), 'ai-eval-claude-'));
      try {
        let configFile: string | undefined;
        if (input.mcp) {
          configFile = join(scratch, 'mcp.json');
          writeFileSync(configFile, JSON.stringify(mcpConfig(input.env)));
        }
        // An API key in the environment would take priority over the subscription login (OPENAI_API_KEY is for the `api` client, not this one).
        const run = await execute(resolveLauncher(options.bin ?? 'claude'), claudeArgs(input, configFile), { cwd: input.cwd, timeoutMs: input.timeoutMs, dropEnv: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY'] });
        return toResult(run, parseClaudeEvents(run.events));
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    },
  };
}
