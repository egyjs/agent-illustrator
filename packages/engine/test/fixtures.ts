import { expect } from 'vitest';
import { EngineError } from '../src/errors.ts';
import { IDENTITY } from '../src/geometry/transform.ts';
import type { Subpath } from '../src/geometry/types.ts';
import type { ImageSource } from '../src/ops/registry.ts';
import type { RasterImage } from '../src/render/image.ts';
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
    defs: {},
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

/** A w×h image whose pixel (x, y) is at(x, y) as [r, g, b, a]. */
export function rasterOf(width: number, height: number, at: (x: number, y: number) => readonly number[]): RasterImage {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set(at(x, y), (y * width + x) * 4);
  return { width, height, pixels };
}

/** A hex color as [r, g, b, a]. */
export const rgba = (hex: string, alpha = 255): number[] => [...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)), alpha];
/** Colors of testImages, most pixels first. */
export const TEST_IMAGE_COLORS = ['#f4f1de', '#e07a5f', '#3d405b'] as const;
const testImage = rasterOf(64, 48, (x, y) => {
  if (x >= 4 && x < 12 && y >= 4 && y < 12) return rgba(TEST_IMAGE_COLORS[2]);
  return rgba(Math.hypot(x + 0.5 - 32, y + 0.5 - 24) < 18 ? TEST_IMAGE_COLORS[1] : TEST_IMAGE_COLORS[0]);
});
/** Answers every ref with the same 64×48 image: a cream background, a big terracotta disc and a small navy square. */
export const testImages: ImageSource = { get: () => testImage };
