import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const renderDir = mkdtempSync(join(tmpdir(), 'ai-e2e-'));
const env = { ...process.env, AGENT_ILLUSTRATOR_RENDER_DIR: renderDir, AGENT_ILLUSTRATOR_LOG_LEVEL: 'warn' } as Record<string, string>;
type Block = { type: string; text?: string; data?: string; mimeType?: string };
const body = (res: { content: unknown }) => JSON.parse((res.content as Block[])[0]!.text!) as Record<string, unknown>;

/**
 * A raw stdio session at info log level: initialize, create a document, render it with every overlay.
 * Resolves with every complete stdout line, so a stray log line or library print is caught.
 */
function rawSession(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...env, AGENT_ILLUSTRATOR_LOG_LEVEL: 'info' } });
    let buf = '';
    const send = (msg: object) => child.stdin.write(`${JSON.stringify(msg)}\n`);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`raw session stalled; stdout so far: ${buf}`));
    }, 20_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buf += chunk;
      const complete = buf.split('\n').slice(0, -1).filter((l) => l.trim() !== '');
      const reply = (id: number) => complete.find((l) => l.includes(`"id":${id},`) || l.includes(`"id":${id}}`));
      if (reply(1) && !complete.some((l) => l.includes('"id":2'))) {
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'create_document', arguments: { width: 100, height: 80 } } });
      }
      const created = reply(2);
      if (created && !buf.includes('"id":3')) {
        const docId = (JSON.parse(JSON.parse(created).result.content[0].text) as { doc_id: string }).doc_id;
        send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'render', arguments: { doc_id: docId, overlays: ['ids', 'bounds', 'grid'] } } });
      }
      if (reply(3)) {
        clearTimeout(timer);
        child.kill();
        resolve(complete);
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw', version: '0' } } });
  });
}

describe('agent-illustrator over stdio', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ name: 'e2e', version: '0.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli], env }));
  }, 30_000);

  afterAll(async () => {
    await client.close();
  });

  it('writes nothing but JSON-RPC messages to stdout, even with info logs and a render', async () => {
    const lines = await rawSession();
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) expect((JSON.parse(line) as { jsonrpc?: string }).jsonrpc).toBe('2.0');
  }, 30_000);

  it('schema-level mistakes come back with code, message and hint', async () => {
    const docId = body(await client.callTool({ name: 'create_document', arguments: { width: 100, height: 100 } })).doc_id as string;
    const expectError = async (args: Record<string, unknown>, code: string) => {
      const res = await client.callTool({ name: 'apply_ops', arguments: args });
      expect(res.isError).toBe(true);
      const error = (body(res).error ?? (body(res).results as { error?: unknown }[]).find((r) => r.error)?.error) as { code: string; hint: string };
      expect(error.code).toBe(code);
      expect(error.hint.length).toBeGreaterThan(5);
    };
    await expectError({ doc_id: docId, ops: [{ op: 'elipse', cx: 1, cy: 1, rx: 1 }] }, 'unknown_op');
    await expectError({ doc_id: docId, ops: 'rect' }, 'invalid_input');
    await expectError({ doc_id: docId, ops: Array.from({ length: 201 }, () => ({ op: 'rect', x: 0, y: 0, width: 1, height: 1 })) }, 'limit_exceeded');
    const render = await client.callTool({ name: 'render', arguments: { doc_id: docId, scale: 100 } });
    expect(body(render)).toMatchObject({ error: { code: 'invalid_input' } });
  }, 30_000);

  it('serves the core contract as instructions and lists four tools with portable schemas', async () => {
    expect(client.getInstructions()).toContain('apply_ops');
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['apply_ops', 'create_document', 'export_svg', 'render']);
    const ops = tools.find((t) => t.name === 'apply_ops')!;
    expect(JSON.stringify(ops.inputSchema)).toContain('"additionalProperties":true');
    expect(ops.description).toContain('rect(');
    for (const tool of tools) expect(JSON.stringify(tool.inputSchema)).not.toMatch(/\$ref|\$defs|"oneOf"|"anyOf"/);
  });

  it('draws, renders and exports a small scene end to end', async () => {
    const created = body(await client.callTool({ name: 'create_document', arguments: { width: 400, height: 300, background: '#ffffff', seed: 1 } }));
    const docId = created.doc_id as string;
    const applied = await client.callTool({
      name: 'apply_ops',
      arguments: {
        doc_id: docId,
        ops: [
          { op: 'rect', id: 'ground', x: 0, y: '70%', width: '100%', height: '30%', style: { fill: '#2a9d8f' } },
          { op: 'ellipse', id: 'sun', cx: 300, cy: 80, rx: 40, style: { fill: '#ffb703' } },
        ],
      },
    });
    expect(applied.isError ?? false).toBe(false);
    expect(body(applied)).toMatchObject({ ok: true, results: [{ id: 'ground' }, { id: 'sun', bounds: { x: 260, y: 40, width: 80, height: 80 } }] });

    const rendered = await client.callTool({ name: 'render', arguments: { doc_id: docId, overlays: ['ids'] } });
    const blocks = rendered.content as Block[];
    const image = blocks.find((b) => b.type === 'image')!;
    expect(image.mimeType).toBe('image/png');
    expect(Buffer.from(image.data!, 'base64').subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(existsSync(body(rendered).file as string)).toBe(true);

    const exported = await client.callTool({ name: 'export_svg', arguments: { doc_id: docId } });
    const svg = (exported.content as Block[])[0]!.text!;
    expect(svg).toMatch(/^<svg[^>]*viewBox="0 0 400 300"/);
    expect(svg).toContain('id="sun"');
  }, 30_000);

  it('a failing batch is an isError result and the server keeps serving', async () => {
    const docId = body(await client.callTool({ name: 'create_document', arguments: { width: 100, height: 100 } })).doc_id as string;
    const bad = await client.callTool({ name: 'apply_ops', arguments: { doc_id: docId, ops: [{ op: 'rect', x: 'left' }] } });
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad.content)).toContain('invalid_input');
    const good = await client.callTool({ name: 'apply_ops', arguments: { doc_id: docId, ops: [{ op: 'rect', x: 0, y: 0, width: 10, height: 10 }] } });
    expect(good.isError ?? false).toBe(false);
  }, 30_000);
});
