import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { Resvg } from '@resvg/resvg-js';
import * as z from 'zod';
import { LOOSE_OPS, UNION_OPS } from './schema-probe.ts';

const INSTRUCTIONS =
  'Spike server for agent-illustrator M0. Call render_probe to receive a PNG; ' +
  'ops_union_probe and ops_loose_probe compare tool-schema styles.';

function circlePng(color: string): Buffer {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">' +
    `<rect width="128" height="128" fill="#ffffff"/><circle cx="64" cy="64" r="48" fill="${color}"/></svg>`;
  return new Resvg(svg).render().asPng();
}

function createServer(): McpServer {
  const server = new McpServer({ name: 'agent-illustrator-spike', version: '0.0.0' }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'render_probe',
    {
      title: 'Render probe',
      description: 'Returns a PNG of a filled circle plus a short text note.',
      inputSchema: z.object({ color: z.string().default('#e4572e').describe('CSS color of the circle') }),
    },
    async ({ color }) => ({
      content: [
        { type: 'text', text: `Rendered a ${color} circle (128x128 PNG).` },
        { type: 'image', data: circlePng(color).toString('base64'), mimeType: 'image/png' },
      ],
    }),
  );

  server.registerTool(
    'ops_union_probe',
    {
      description: 'Schema probe: the ops array advertises a 50-variant discriminated union.',
      inputSchema: z.object({ ops: z.array(UNION_OPS) }),
    },
    async ({ ops }) => ({ content: [{ type: 'text', text: `ok: ${ops.length} ops` }] }),
  );

  server.registerTool(
    'ops_loose_probe',
    {
      description: 'Schema probe: the ops array advertises only { op: enum }; each op is validated on the server.',
      inputSchema: z.object({ ops: z.array(LOOSE_OPS) }),
    },
    async ({ ops }) => {
      const parsed = z.array(UNION_OPS).safeParse(ops);
      if (!parsed.success) {
        return { isError: true, content: [{ type: 'text', text: z.prettifyError(parsed.error) }] };
      }
      return { content: [{ type: 'text', text: `ok: ${parsed.data.length} ops` }] };
    },
  );

  server.registerPrompt(
    'illustrate_probe',
    { description: 'Draft shape of the /illustrate prompt.', argsSchema: z.object({ brief: z.string() }) },
    ({ brief }) => ({
      messages: [{ role: 'user', content: { type: 'text', text: `Illustrate this brief with the agent-illustrator tools: ${brief}` } }],
    }),
  );

  return server;
}

await serveStdio(createServer);
