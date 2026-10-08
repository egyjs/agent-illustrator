import { describe, expect, it } from 'vitest';
import { alea, between, noise2D, rngFor } from '../../src/random/rng.ts';

const take = (rng: () => number, n: number) => Array.from({ length: n }, rng);

describe('random/rng', () => {
  it('the same seeds give the same sequence, different seeds a different one', () => {
    expect(take(alea(1, 'a'), 20)).toEqual(take(alea(1, 'a'), 20));
    expect(take(alea(1, 'a'), 5)).not.toEqual(take(alea(2, 'a'), 5));
    expect(take(alea(1, 'a'), 5)).not.toEqual(take(alea(1, 'b'), 5));
    expect(take(rngFor(1, 'a'), 5)).not.toEqual(take(rngFor(1, 'a', 'salt'), 5));
  });

  it('every value is in [0, 1)', () => {
    for (const v of take(rngFor(7, 'node'), 5000)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('rngFor(1, "a") starts with a fixed sequence on every platform', () => {
    expect(take(rngFor(1, 'a'), 4)).toMatchInlineSnapshot(`
      [
        0.9587359735742211,
        0.13086131843738258,
        0.854136151727289,
        0.5531535076443106,
      ]
    `);
  });

  it('between maps the stream into [min, max)', () => {
    const rng = rngFor(3, 'range');
    for (let i = 0; i < 200; i++) {
      const v = between(rng, -5, 15);
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThan(15);
    }
  });

  it('noise stays in [-1, 1] and is deterministic per rng', () => {
    const a = noise2D(rngFor(1, 'n')), b = noise2D(rngFor(1, 'n')), other = noise2D(rngFor(2, 'n'));
    let differs = false;
    for (let x = -5; x <= 5; x += 0.37) {
      for (let y = -5; y <= 5; y += 0.41) {
        const v = a(x, y);
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
        expect(b(x, y)).toBe(v);
        if (other(x, y) !== v) differs = true;
      }
    }
    expect(differs).toBe(true);
  });
});
