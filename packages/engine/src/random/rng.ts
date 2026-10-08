import { createNoise2D } from 'simplex-noise';

/** Uniform numbers in [0, 1). */
export type Rng = () => number;

/** Baagøe's Mash hash, which turns seed strings into Alea state. */
function mash(): (data: string) => number {
  let n = 0xefc8249d;
  return (data) => {
    for (let i = 0; i < data.length; i++) {
      n += data.charCodeAt(i);
      let h = 0.02519603282416938 * n;
      n = h >>> 0;
      h -= n;
      h *= n;
      n = h >>> 0;
      h -= n;
      n += h * 0x100000000;
    }
    return (n >>> 0) * 2.3283064365386963e-10;
  };
}

/** Alea (Baagøe): a small seedable PRNG. The same seeds give the same sequence on every platform. */
export function alea(...seeds: readonly (string | number)[]): Rng {
  const m = mash();
  let s0 = m(' '), s1 = m(' '), s2 = m(' ');
  let c = 1;
  for (const seed of seeds) {
    const s = String(seed);
    s0 -= m(s);
    if (s0 < 0) s0 += 1;
    s1 -= m(s);
    if (s1 < 0) s1 += 1;
    s2 -= m(s);
    if (s2 < 0) s2 += 1;
  }
  return () => {
    const t = 2091639 * s0 + c * 2.3283064365386963e-10;
    s0 = s1;
    s1 = s2;
    return (s2 = t - (c = t | 0));
  };
}

/**
 * Randomness for one node (spec A3.6): derived from the document seed, the node id and a salt, with
 * no shared stream, so replaying or editing other ops never reshuffles this node.
 */
export function rngFor(seed: number, nodeId: string, salt = ''): Rng {
  return alea(seed, nodeId, salt);
}

/** A uniform number in [min, max). */
export const between = (rng: Rng, min: number, max: number): number => min + (max - min) * rng();

/** 2D simplex noise in [-1, 1], with its permutation drawn from `rng`. */
export function noise2D(rng: Rng): (x: number, y: number) => number {
  return createNoise2D(rng);
}
