import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/ops/index.ts';
import { executeBatch } from '../../src/ops/registry.ts';
import { createDocument, type TextNode } from '../../src/scene/model.ts';

const registry = createRegistry();
const font = (f: string) => fileURLToPath(new URL(`../../assets/fonts/${f}`, import.meta.url));
const fonts = { files: [font('Tajawal-Regular.ttf'), font('Tajawal-Bold.ttf')], defaultFamily: 'Tajawal' };
const run = (ops: unknown[]) => executeBatch(registry, createDocument({ width: 400, height: 300 }), ops, { fonts });

// The slips below are the most common tool errors in the v1 eval transcripts (eval/runs/v1-final).
describe('ops: input normalization before validation', () => {
  it('maps SVG and CSS style names to the style fields they mean', () => {
    const r = run([
      { op: 'line', id: 'a', x1: 10, y1: 10, x2: 100, y2: 10, style: { stroke: '#000', 'stroke-width': 3, strokeLinecap: 'round', 'stroke-linejoin': 'bevel' } },
      { op: 'path_commands', id: 'b', d: 'M10 50 L100 50', style: { stroke: '#000', strokeDasharray: '4 2', strokeLinejoin: 'round', 'fill-opacity': 0.5 } },
      { op: 'style', ids: ['a'], style: { 'mix-blend-mode': 'multiply', strokeMiterlimit: 4 } },
    ]);
    expect(r.ok).toBe(true);
    expect(r.doc.nodes.a!.style).toEqual({ stroke: '#000', strokeWidth: 3, strokeCap: 'round', strokeJoin: 'bevel', blend: 'multiply', miterLimit: 4 });
    expect(r.doc.nodes.b!.style).toEqual({ stroke: '#000', strokeDash: [4, 2], strokeJoin: 'round', fillOpacity: 0.5 });
  });

  it('keeps the canonical key when an alias is given too, and still rejects unknown keys', () => {
    const r = run([{ op: 'rect', id: 'r', x: 0, y: 0, width: 10, height: 10, style: { strokeWidth: 2, 'stroke-width': 9 } }]);
    expect(r.doc.nodes.r!.style).toEqual({ strokeWidth: 2 });
    expect(run([{ op: 'rect', x: 0, y: 0, width: 10, height: 10, style: { glow: 1 } }]).results[0]).toMatchObject({ status: 'error', error: { code: 'invalid_input' } });
  });

  it('takes the first family of a CSS font list', () => {
    const r = run([{ op: 'text', id: 't', content: 'Fair', x: 20, y: 60, font: '"Tajawal", Arial, sans-serif' }]);
    expect(r.ok).toBe(true);
    expect((r.doc.nodes.t as TextNode).font.family).toBe('Tajawal');
  });
});
