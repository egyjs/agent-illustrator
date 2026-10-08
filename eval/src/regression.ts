import { readdirSync, readFileSync } from 'node:fs';
import { createDocument, createRegistry, executeBatch, rasterize } from '@agent-illustrator/engine';
import { z } from 'zod';
import { FONTS, PATHS } from './paths.ts';

/** Fixtures stay small so the whole suite renders in a second or two. */
const FixtureSchema = z.strictObject({
  canvas: z.strictObject({
    width: z.number().positive().max(400),
    height: z.number().positive().max(300),
    background: z.string().optional(),
    seed: z.number().int().optional(),
  }),
  ops: z.array(z.unknown()).max(40),
});

export type Rendered = { readonly width: number; readonly height: number; readonly png: Uint8Array; readonly pixels: Uint8Array };

/** Names of the fixtures in `PATHS.fixtures`, sorted. */
export const fixtureNames = (): string[] =>
  readdirSync(PATHS.fixtures)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();

export const fixturePath = (name: string): string => `${PATHS.fixtures}${name}.json`;
export const baselinePath = (name: string): string => `${PATHS.baselines}${name}.png`;

/** Builds the fixture's document with the bundled fonts and rasterizes it at scale 1. Throws on the first failing op. */
export function renderFixture(path: string): Rendered {
  const fixture = FixtureSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  const batch = executeBatch(createRegistry(), createDocument(fixture.canvas), fixture.ops, { fonts: FONTS });
  if (!batch.ok) {
    const failed = batch.results.findIndex((r) => r.status === 'error');
    const r = batch.results[failed];
    if (r?.status !== 'error') throw new Error(`${path}: batch failed without an op error`);
    throw new Error(`${path}: op ${failed + 1} (${r.op}) failed: ${r.error.message}; ${r.error.hint}`);
  }
  return rasterize(batch.doc, { fonts: FONTS });
}
