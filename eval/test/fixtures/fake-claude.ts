// Stand-in for `claude -p <prompt> --output-format stream-json`, run as `node fake-claude.ts …`. It echoes its arguments and the MCP config file it was
// given, then prints a canned run chosen by the prompt: "ok" (tool calls, one failing), "error" (an error result, exit 1) or "hang" (never ends).
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const prompt = argv[argv.indexOf('-p') + 1];
const configAt = argv.indexOf('--mcp-config');
const out = (event: unknown): void => void process.stdout.write(`${JSON.stringify(event)}\n`);

out({ type: 'system', subtype: 'init', fake: { argv, cwd: process.cwd(), mcpConfig: configAt < 0 ? null : JSON.parse(readFileSync(argv[configAt + 1]!, 'utf8')) as unknown, apiKeys: [process.env.ANTHROPIC_API_KEY, process.env.ANTHROPIC_AUTH_TOKEN, process.env.OPENAI_API_KEY].filter((k) => k !== undefined) } });

const use = (id: string, name: string, input: unknown) => out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: `mcp__agent-illustrator__${name}`, input }] } });
const answer = (id: string, content: unknown, isError = false) => out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }] } });

if (prompt === 'ok') {
  out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Starting.' }] } });
  use('t1', 'create_document', { width: 320, height: 240 });
  answer('t1', [{ type: 'text', text: '{"doc_id":"doc-1"}' }]);
  process.stdout.write('this line is not JSON\n');
  use('t2', 'apply_ops', { doc_id: 'doc-1', ops: [{ op: 'rect' }, { op: 'ellipse' }] });
  answer('t2', 'bad op: no such shape', true);
  use('t3', 'apply_ops', { doc_id: 'doc-1', ops: [{ op: 'rect' }, { op: 'ellipse' }, { op: 'path' }] });
  answer('t3', [{ type: 'text', text: '{"committed":true}' }]);
  use('t4', 'render', { doc_id: 'doc-1' });
  answer('t4', [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(5000) } }]);
  out({ type: 'rate_limit_event', note: 'an event type the parser has never seen' });
  out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } });
  out({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Done.',
    num_turns: 5,
    total_cost_usd: 0.0123,
    usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50 },
  });
} else if (prompt === 'error') {
  out({ type: 'result', subtype: 'success', is_error: true, result: 'API Error: 529 overloaded', num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 3, output_tokens: 0 } });
  process.stderr.write('claude: request failed\n');
  process.exitCode = 1;
} else if (prompt === 'hang') {
  use('h1', 'create_document', { width: 10, height: 10 });
  setInterval(() => undefined, 1000);
}
