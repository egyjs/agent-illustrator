import { describeScene, lint, LINT_CHECKS, MAX_MEASURE_IDS, measure } from '@agent-illustrator/engine';
import { z } from 'zod';
import { guarded, parse, text, type ToolDeps, type ToolResult } from './tools.ts';

export const describeSceneInput = z.object({
  doc_id: z.string(),
  detail: z.enum(['outline', 'normal', 'full']).optional().describe('outline: ids and boxes; normal (default): adds styles and text; full: adds exact geometry'),
  root: z.string().optional().describe('Describe only this node and everything below it'),
  max_nodes: z.number().int().min(1).max(2000).optional().describe('Most nodes to list, top of the tree first; default 300'),
});

/** The scene as text (FR-10): canvas, tokens, defs and the node tree, so an agent can work without looking at a render. */
export function describeSceneTool(deps: ToolDeps, raw: unknown): ToolResult {
  return guarded(deps, 'describe_scene', () => {
    const input = parse(describeSceneInput, raw, 'describe_scene', { doc_id: 'doc-1a2b3c', detail: 'outline' });
    const { doc } = deps.sessions.get(input.doc_id).store;
    const scene = describeScene(doc, {
      ...(input.detail === undefined ? {} : { detail: input.detail }),
      ...(input.root === undefined ? {} : { root: input.root }),
      ...(input.max_nodes === undefined ? {} : { maxNodes: input.max_nodes }),
    });
    return { content: [text(scene)] };
  });
}

export const measureInput = z.object({
  doc_id: z.string(),
  ids: z.array(z.string()).min(1).max(MAX_MEASURE_IDS).describe('Nodes to measure; with 2 to 12 ids every pair is related too (gap, overlap, distance)'),
});

/** Exact bounds, area, length and pair relations (FR-10), so nobody has to eyeball a render. */
export function measureTool(deps: ToolDeps, raw: unknown): ToolResult {
  return guarded(deps, 'measure', () => {
    const input = parse(measureInput, raw, 'measure', { doc_id: 'doc-1a2b3c', ids: ['roof', 'wall'] });
    return { content: [text(measure(deps.sessions.get(input.doc_id).store.doc, input.ids))] };
  });
}

export const lintInput = z.object({
  doc_id: z.string(),
  checks: z.array(z.enum(LINT_CHECKS)).optional().describe('Which checks to run; default all but "overlap", which is opt-in'),
  ids: z.array(z.string()).min(1).max(1000).optional().describe('Check only these nodes (and what is below them) and the pairs they form'),
  tolerance: z.number().min(0).optional().describe('How far apart two edges may be to count as a near miss, in px; default 2'),
  max_issues: z.number().int().min(1).max(200).optional().describe('Most issues to return; default 50'),
});

/** Mistakes agents make, each with a hint and a ready `fix` op where one exists (FR-10). */
export function lintTool(deps: ToolDeps, raw: unknown): ToolResult {
  return guarded(deps, 'lint', () => {
    const input = parse(lintInput, raw, 'lint', { doc_id: 'doc-1a2b3c', checks: ['off_canvas', 'text_overlap'] });
    const result = lint(deps.sessions.get(input.doc_id).store.doc, {
      fonts: deps.fonts,
      ...(input.checks === undefined ? {} : { checks: input.checks }),
      ...(input.ids === undefined ? {} : { ids: input.ids }),
      ...(input.tolerance === undefined ? {} : { tolerance: input.tolerance }),
      ...(input.max_issues === undefined ? {} : { maxIssues: input.max_issues }),
    });
    return { content: [text(result)] };
  });
}
