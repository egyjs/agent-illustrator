import { StyleSchema } from '@agent-illustrator/engine';
import { fromJsonSchema, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import pkg from '../package.json' with { type: 'json' };
import type { AgentKit } from './agent-kit.ts';
import { describeSceneInput, describeSceneTool, lintInput, lintTool, measureInput, measureTool } from './analysis-tools.ts';
import { guideInput, guideTool, illustrateArgs, illustratePrompt } from './guide-tool.ts';
import { documentIoInput, documentIoTool, historyInput, historyTool } from './history-tools.ts';
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
  type ToolDeps,
  type ToolResult,
} from './tools.ts';

type JsonSchema = Parameters<typeof fromJsonSchema>[0];
type Validator = NonNullable<Parameters<typeof fromJsonSchema>[1]>;

/**
 * Lets every input through the SDK. Clients still see the full schema, but the handlers validate,
 * so mistakes come back as { code, message, hint } (NFR-3), not as the SDK's bare validation text.
 */
const passThrough: Validator = {
  getValidator: () => (input: unknown) => ({ valid: true, data: input as never, errorMessage: undefined }),
};
const advertise = (schema: object) => fromJsonSchema<unknown>(schema as JsonSchema, passThrough);

const docIdOf = (input: unknown) =>
  typeof input === 'object' && input !== null && typeof (input as { doc_id?: unknown }).doc_id === 'string' ? (input as { doc_id: string }).doc_id : undefined;

/** Times a tool call and logs one JSON line per call (NFR-5). */
function logged(deps: ToolDeps, tool: string, input: unknown, run: () => ToolResult): ToolResult {
  const start = performance.now();
  const result = run();
  deps.log.info({ tool, doc_id: docIdOf(input), ms: Math.round(performance.now() - start), outcome: result.isError ? 'error' : 'ok' }, 'tool call');
  return result;
}

export function createServer(deps: ToolDeps, kit: AgentKit): McpServer {
  const server = new McpServer({ name: 'agent-illustrator', version: pkg.version }, { instructions: kit.instructions });

  server.registerTool(
    'create_document',
    {
      title: 'Create document',
      description: 'Create a new drawing canvas. Returns doc_id, which every other tool needs, and the seed used for generators.',
      inputSchema: advertise(z.toJSONSchema(createDocumentInput)),
    },
    async (input) => logged(deps, 'create_document', input, () => createDocumentTool(deps, input)),
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
        `\nstyle fields: ${Object.keys(StyleSchema.shape).join(', ')}. fill and stroke take a CSS color, a token or "none". A committed batch also returns "lint" issues found on the nodes it touched.`,
      inputSchema: advertise(applyOpsInputSchema(deps.registry, deps.config.limits)),
    },
    async (input) => logged(deps, 'apply_ops', input, () => applyOpsTool(deps, input)),
  );

  server.registerTool(
    'render',
    {
      title: 'Render',
      description:
        'Render the document to a PNG you can look at. Overlays: "ids" labels nodes, "bounds" outlines their exact bounds, "grid" draws coordinates. Use region and scale to zoom in.',
      inputSchema: advertise(z.toJSONSchema(renderInput)),
      annotations: { readOnlyHint: true },
    },
    async (input) => logged(deps, 'render', input, () => renderTool(deps, input)),
  );

  server.registerTool(
    'export_svg',
    {
      title: 'Export SVG',
      description: 'Return the finished SVG: colors resolved, coordinates rounded to precision, optimized with SVGO, ids kept unless strip_ids is true.',
      inputSchema: advertise(z.toJSONSchema(exportSvgInput)),
      annotations: { readOnlyHint: true },
    },
    async (input) => logged(deps, 'export_svg', input, () => exportSvgTool(deps, input)),
  );

  server.registerTool(
    'describe_scene',
    {
      title: 'Describe scene',
      description: 'The scene as text: canvas, tokens, and the node tree with bounds and styles. Use it to see what exists without a render.',
      inputSchema: advertise(z.toJSONSchema(describeSceneInput)),
      annotations: { readOnlyHint: true },
    },
    async (input) => logged(deps, 'describe_scene', input, () => describeSceneTool(deps, input)),
  );

  server.registerTool(
    'measure',
    {
      title: 'Measure',
      description: 'Exact bounds, center, area and length of 1-50 nodes; for 2-12 nodes also the gap, overlap and center distance of each pair.',
      inputSchema: advertise(z.toJSONSchema(measureInput)),
      annotations: { readOnlyHint: true },
    },
    async (input) => logged(deps, 'measure', input, () => measureTool(deps, input)),
  );

  server.registerTool(
    'lint',
    {
      title: 'Lint',
      description: 'Find off-canvas, degenerate, tiny, almost-aligned, colliding or low-contrast items. Issues carry a hint and often a ready "fix" op.',
      inputSchema: advertise(z.toJSONSchema(lintInput)),
      annotations: { readOnlyHint: true },
    },
    async (input) => logged(deps, 'lint', input, () => lintTool(deps, input)),
  );

  server.registerTool(
    'history',
    {
      title: 'History',
      description: 'Name a checkpoint, restore one, undo the last change, or list checkpoints.',
      inputSchema: advertise(z.toJSONSchema(historyInput)),
    },
    async (input) => logged(deps, 'history', input, () => historyTool(deps, input)),
  );

  server.registerTool(
    'document_io',
    {
      title: 'Document I/O',
      description: 'Save a document to disk by name (names are lowercased), load a saved one as a new document, or list saved documents.',
      inputSchema: advertise(z.toJSONSchema(documentIoInput)),
    },
    async (input) => logged(deps, 'document_io', input, () => documentIoTool(deps, input)),
  );

  server.registerTool(
    'guide',
    {
      title: 'Guide',
      description:
        'Read the drawing guides: the workflow, topic guides, style presets and the op reference. Call it with no topic for the index, and read the ' +
        'matching topic before using an unfamiliar op ("ops" lists them all, "op:<name>" shows one in full).',
      inputSchema: advertise(z.toJSONSchema(guideInput)),
      annotations: { readOnlyHint: true },
    },
    async (input) => logged(deps, 'guide', input, () => guideTool(deps, kit, input)),
  );

  const { prompt } = kit;
  if (prompt !== undefined) {
    server.registerPrompt(
      'illustrate',
      {
        title: 'Illustrate',
        description: 'Draw an illustration from a brief with the workflow in the guide: plan, block in, detail, critique, export.',
        argsSchema: illustrateArgs,
      },
      (args) => illustratePrompt(kit, prompt, args),
    );
  }

  return server;
}
