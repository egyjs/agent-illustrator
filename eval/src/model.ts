import type { Tool } from '@modelcontextprotocol/client';
import { z } from 'zod';

// The OpenAI chat-completions shapes the harness speaks; every OpenAI-compatible endpoint takes them.
export type TextPart = { type: 'text'; text: string };
export type ImagePart = { type: 'image_url'; image_url: { url: string } };
export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type Usage = { promptTokens: number; completionTokens: number };
/** `usage` is for the transcript and metrics only; it is never sent back to the endpoint. */
export type AssistantMessage = { role: 'assistant'; content: string | null; tool_calls?: ToolCall[]; usage?: Usage };
export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | (TextPart | ImagePart)[] }
  | AssistantMessage
  | { role: 'tool'; tool_call_id: string; content: string };
export type ToolSpec = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };

export interface ChatModel {
  chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<AssistantMessage>;
}

/** An MCP tool in the shape the chat-completions `tools` field takes. */
export const toToolSpec = (tool: Pick<Tool, 'name' | 'description' | 'inputSchema'>): ToolSpec => ({
  type: 'function',
  function: { name: tool.name, description: tool.description ?? '', parameters: tool.inputSchema as Record<string, unknown> },
});

const Reply = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullish(),
          tool_calls: z.array(z.object({ id: z.string(), function: z.object({ name: z.string(), arguments: z.string() }) })).nullish(),
        }),
      }),
    )
    .min(1),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() }).nullish(),
});

function parseReply(payload: string): AssistantMessage {
  const r = Reply.safeParse(JSON.parse(payload));
  if (!r.success) throw new Error(`unexpected response shape: ${z.prettifyError(r.error)}`);
  const { message } = r.data.choices[0]!;
  const calls = (message.tool_calls ?? []).map((c): ToolCall => ({ id: c.id, type: 'function', function: c.function }));
  return {
    role: 'assistant',
    content: message.content ?? null,
    ...(calls.length > 0 ? { tool_calls: calls } : {}),
    ...(r.data.usage ? { usage: { promptTokens: r.data.usage.prompt_tokens ?? 0, completionTokens: r.data.usage.completion_tokens ?? 0 } } : {}),
  };
}

const wire = (m: ChatMessage) => (m.role === 'assistant' ? { role: m.role, content: m.content, ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}) } : m);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Keys shorter than this are placeholders (a local server takes any value), so they are not hunted for in text. */
const MIN_SECRET = 8;
/** `text` without the API key and without anything shaped like a secret key ("sk-…"), for error bodies that end up in transcripts and reports. */
export const redact = (text: string, apiKey: string): string =>
  (apiKey.length >= MIN_SECRET ? text.split(apiKey).join('[redacted]') : text).replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-[redacted]');

export type OpenAIOptions = {
  model: string;
  /** Default env `EVAL_BASE_URL`, else OpenRouter. */
  baseUrl?: string;
  /** Default env `EVAL_API_KEY`. */
  apiKey?: string;
  timeoutMs?: number;
  retries?: number;
  /** First retry waits this long, then it doubles. */
  backoffMs?: number;
  fetch?: typeof fetch;
};

/** One OpenAI-compatible `/chat/completions` endpoint. Retries 429, 5xx and network errors. */
export class OpenAICompatibleModel implements ChatModel {
  private readonly url: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly backoffMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: OpenAIOptions) {
    const apiKey = options.apiKey ?? process.env.EVAL_API_KEY;
    if (!apiKey) throw new Error('EVAL_API_KEY is not set: export the key for your endpoint (any value for a local server) and run again.');
    this.apiKey = apiKey;
    this.url = `${(options.baseUrl ?? process.env.EVAL_BASE_URL ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '')}/chat/completions`;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.retries = options.retries ?? 3;
    this.backoffMs = options.backoffMs ?? 2_000;
    this.fetchFn = options.fetch ?? fetch;
  }

  async chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<AssistantMessage> {
    const body = JSON.stringify({ model: this.model, messages: messages.map(wire), ...(tools.length > 0 ? { tools } : {}) });
    let failure = '';
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) await sleep(this.backoffMs * 2 ** (attempt - 1));
      try {
        const res = await this.fetchFn(this.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const payload = await res.text();
        if (res.ok) return parseReply(payload);
        failure = `HTTP ${res.status}: ${redact(payload, this.apiKey).slice(0, 300)}`;
        if (res.status !== 429 && res.status < 500) break;
      } catch (e) {
        failure = redact(errorText(e), this.apiKey);
      }
    }
    throw new Error(`model request to ${this.url} failed: ${failure}`);
  }
}

export type Step = AssistantMessage | ((messages: readonly ChatMessage[]) => AssistantMessage);

/** Replays canned assistant messages, so the harness can be tested without a model. A function step sees the conversation so far. */
export class ScriptedModel implements ChatModel {
  /** The conversation as each call saw it. */
  readonly seen: ChatMessage[][] = [];
  private readonly steps: readonly Step[];
  private next = 0;

  constructor(steps: readonly Step[]) {
    this.steps = steps;
  }

  chat(messages: ChatMessage[]): Promise<AssistantMessage> {
    this.seen.push([...messages]);
    const step = this.steps[this.next++];
    if (step === undefined) return Promise.reject(new Error(`ScriptedModel has no step ${this.next} (${this.steps.length} given)`));
    return Promise.resolve(typeof step === 'function' ? step(messages) : step);
  }
}
