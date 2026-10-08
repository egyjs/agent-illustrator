import { expect } from 'vitest';
import { EngineError } from '../src/errors.ts';
import { IDENTITY } from '../src/geometry/transform.ts';
import type { Subpath } from '../src/geometry/types.ts';
import { integrityProblem, type Doc, type GroupNode, type PathNode, type SceneNode } from '../src/scene/model.ts';

export function pathNode(id: string, subpaths: Subpath[], extra: Partial<PathNode> = {}): PathNode {
  return { id, type: 'path', parent: null, transform: IDENTITY, style: {}, fillRule: 'nonzero', subpaths, ...extra };
}

export function groupNode(id: string, children: string[], extra: Partial<GroupNode> = {}): GroupNode {
  return { id, type: 'group', parent: null, transform: IDENTITY, style: {}, children, ...extra };
}

/** An 800×600 document holding these nodes; `root` defaults to every node without a parent, in order. */
export function docOf(nodes: SceneNode[], root?: string[]): Doc {
  return {
    schema: 1,
    seed: 1,
    canvas: { width: 800, height: 600 },
    tokens: {},
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    root: root ?? nodes.filter((n) => n.parent === null).map((n) => n.id),
  };
}

export function expectIntact(doc: Doc): void {
  expect(integrityProblem(doc)).toBeNull();
}

/** Runs fn and expects an EngineError with this code. */
export function expectCode(fn: () => unknown, code: string): EngineError {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(EngineError);
  expect((caught as EngineError).code).toBe(code);
  return caught as EngineError;
}
