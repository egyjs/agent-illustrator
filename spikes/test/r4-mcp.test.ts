import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const serverPath = fileURLToPath(new URL('../src/mcp-probe-server.ts', import.meta.url));

type Block = { type: string; text?: string; data?: string; mimeType?: string };

/** Sends a raw initialize request and resolves with every complete stdout line up to the response. */
function rawInitialize(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`no initialize response; stdout so far: ${buf}`));
    }, 15_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buf += chunk;
      const complete = buf.split('\n').slice(0, -1).filter((l) => l.trim() !== '');
      if (complete.some((l) => l.includes('"id":1'))) {
        clearTimeout(timer);
        child.kill();
        resolve(complete);
      }
    });
    const init = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw-probe', version: '0.0.0' } },
    };
    child.stdin.write(`${JSON.stringify(init)}\n`);
  });
}

describe('R3/R4: MCP SDK v2 stdio server', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ name: 'spike-test', version: '0.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath] }));
  }, 20_000);

  afterAll(async () => {
    await client.close();
  });

  it('writes nothing but JSON-RPC lines to stdout', async () => {
    const lines = await rawInitialize();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  }, 20_000);

  it('exposes server instructions', () => {
    expect(client.getInstructions()).toContain('render_probe');
  });

  it('returns a PNG image content block next to a text block', async () => {
    const res = await client.callTool({ name: 'render_probe', arguments: { color: '#3366ff' } });
    const blocks = res.content as unknown as Block[];
    const image = blocks.find((b) => b.type === 'image');
    expect(blocks.some((b) => b.type === 'text')).toBe(true);
    expect(image?.mimeType).toBe('image/png');
    expect(Buffer.from(image!.data!, 'base64').subarray(1, 4).toString('ascii')).toBe('PNG');
  });

  it('serves a prompt with arguments', async () => {
    const prompt = await client.getPrompt({ name: 'illustrate_probe', arguments: { brief: 'desert sunset' } });
    expect(JSON.stringify(prompt.messages)).toContain('desert sunset');
  });

  it('S1: the loose ops schema is far smaller than the union and no tool schema uses $ref', async () => {
    const { tools } = await client.listTools();
    const bytes = (name: string) => JSON.stringify(tools.find((t) => t.name === name)?.inputSchema).length;
    const union = bytes('ops_union_probe');
    const loose = bytes('ops_loose_probe');
    console.info(`[R4] inputSchema bytes: union=${union} loose=${loose}`);
    expect(loose).toBeLessThan(1000);
    expect(union).toBeGreaterThan(loose * 10);
    for (const tool of tools) expect(JSON.stringify(tool.inputSchema)).not.toMatch(/\$ref|\$defs/);
  });

  it('S1: the loose schema still rejects a malformed op on the server with a readable error', async () => {
    const res = await client.callTool({ name: 'ops_loose_probe', arguments: { ops: [{ op: 'op_1', id: 'a' }] } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('.at'); // zod path of the missing field, e.g. [0].at
  });

  it('S1: an unknown op name is rejected by the advertised enum', async () => {
    const res = await client.callTool({ name: 'ops_loose_probe', arguments: { ops: [{ op: 'nope' }] } });
    expect(res.isError).toBe(true);
  });

  it('S1: valid ops pass the loose schema and server-side validation', async () => {
    const res = await client.callTool({
      name: 'ops_loose_probe',
      arguments: { ops: [{ op: 'op_7', id: 'sun', at: { x: 10, y: 20 } }] },
    });
    expect(res.isError ?? false).toBe(false);
    expect(JSON.stringify(res.content)).toContain('ok: 1 ops');
  });
});
