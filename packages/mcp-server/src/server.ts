import { fromJsonSchema, McpServer } from '@modelcontextprotocol/server';
import pkg from '../package.json' with { type: 'json' };
import {
  applyOpsInputSchema,
  applyOpsTool,
  createDocumentInput,
  createDocumentTool,
  exportSvgInput,
  exportSvgTool,
  opSignatures,
  renderInput,
  renderTool,
  type ApplyOpsInput,
  type ToolDeps,
  type ToolResult,
} from './tools.ts';

/** Times a tool call and logs one JSON line per call (NFR-5). */
function logged(deps: ToolDeps, tool: string, docId: string | undefined, run: () => ToolResult): ToolResult {
  const start = performance.now();
  const result = run();
  deps.log.info({ tool, doc_id: docId, ms: Math.round(performance.now() - start), outcome: result.isError ? 'error' : 'ok' }, 'tool call');
  return result;
}

export function createServer(deps: ToolDeps, instructions: string): McpServer {
  const server = new McpServer({ name: 'agent-illustrator', version: pkg.version }, { instructions });

  server.registerTool(
    'create_document',
    {
      title: 'Create document',
      description: 'Create a new drawing canvas. Returns doc_id, which every other tool needs, and the seed used for generators.',
      inputSchema: createDocumentInput,
    },
    async (input) => logged(deps, 'create_document', undefined, () => createDocumentTool(deps, input)),
  );

  server.registerTool(
    'apply_ops',
    {
      title: 'Apply ops',
      description:
        'Apply a batch of drawing ops to a document, all or nothing. Each op is {"op": name, ...fields}. Numbers are canvas px; strings ' +
        'like "50%" are relative to the canvas. Give nodes short semantic ids; "$last" is the most recent node. Returns each op\'s ' +
        'status, id and exact bounds, or errors with a hint.\nOps:\n' +
        opSignatures(deps.registry) +
        '\nstyle fields: fill, stroke (CSS colors or "none"), strokeWidth, strokeCap, strokeJoin, strokeDash, miterLimit, opacity, fillOpacity, strokeOpacity.',
      inputSchema: fromJsonSchema<ApplyOpsInput>(applyOpsInputSchema(deps.registry, deps.config.limits)),
    },
    async (input) => logged(deps, 'apply_ops', input.doc_id, () => applyOpsTool(deps, input)),
  );

  server.registerTool(
    'render',
    {
      title: 'Render',
      description:
        'Render the document to a PNG you can look at. Overlays: "ids" labels nodes, "bounds" outlines their exact bounds, "grid" draws coordinates. Use region and scale to zoom in.',
      inputSchema: renderInput,
      annotations: { readOnlyHint: true },
    },
    async (input) => logged(deps, 'render', input.doc_id, () => renderTool(deps, input)),
  );

  server.registerTool(
    'export_svg',
    {
      title: 'Export SVG',
      description: 'Return the finished SVG: colors resolved, coordinates rounded to precision, optimized with SVGO, ids kept unless strip_ids is true.',
      inputSchema: exportSvgInput,
      annotations: { readOnlyHint: true },
    },
    async (input) => logged(deps, 'export_svg', input.doc_id, () => exportSvgTool(deps, input)),
  );

  return server;
}
