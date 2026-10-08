// Round trip against the built bundle: proves dist/cli.mjs serves, finds its fonts, renders and exports.
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

type Block = { type: string; text?: string; data?: string };
const cli = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url));
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli], env: { ...process.env, AGENT_ILLUSTRATOR_LOG_LEVEL: 'warn' } as Record<string, string> }));

const first = (r: { content: unknown }) => (r.content as Block[])[0]!.text!;
const fail = (step: string, detail: unknown): never => {
  process.stderr.write(`smoke-mcp: ${step} failed: ${JSON.stringify(detail)}\n`);
  process.exit(1);
};

const created = await client.callTool({ name: 'create_document', arguments: { width: 200, height: 100, background: '#ffffff' } });
const docId = (JSON.parse(first(created)) as { doc_id: string }).doc_id;
const applied = await client.callTool({ name: 'apply_ops', arguments: { doc_id: docId, ops: [{ op: 'ellipse', id: 'dot', cx: 100, cy: 50, rx: 30 }] } });
if (applied.isError) fail('apply_ops', applied.content);
const rendered = await client.callTool({ name: 'render', arguments: { doc_id: docId, overlays: ['ids'] } });
if (!(rendered.content as Block[]).some((b) => b.type === 'image' && b.data)) fail('render', rendered.content);
const svg = first(await client.callTool({ name: 'export_svg', arguments: { doc_id: docId } }));
if (!svg.includes('id="dot"')) fail('export_svg', svg);
await client.close();
process.stderr.write(`smoke-mcp: ok (${docId}, ${svg.length} bytes of SVG)\n`);
