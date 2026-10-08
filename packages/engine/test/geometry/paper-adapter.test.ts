import { describe, expect, it } from 'vitest';
import { fromPaper, toPaper, withPaper } from '../../src/geometry/paper-adapter.ts';
import type { Subpath } from '../../src/geometry/types.ts';
import { kappaCircle, square } from './helpers.ts';

// Engine tests may not import paper (ESLint), so the scope registry is reached through the scope's class.
const scopeCount = () => withPaper((s) => Object.keys(Reflect.get(s.constructor, '_scopes') as object).length);

describe('paper-adapter: scope lifecycle (F5)', () => {
  it('reuses one scope and never grows the static scope registry', () => {
    const first = withPaper((s) => s);
    const before = scopeCount();
    for (let i = 0; i < 50; i++) withPaper((s) => toPaper(s, [square(0, 0, 10)]));
    expect(withPaper((s) => s)).toBe(first);
    expect(scopeCount()).toBe(before);
  });

  it('leaves the project empty, even when the callback throws', () => {
    expect(() =>
      withPaper((s) => {
        toPaper(s, [square(0, 0, 10)]);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(withPaper((s) => s.project.isEmpty())).toBe(true);
  });

  it('re-activates its scope after another scope became active', () => {
    withPaper((s) => {
      const Rogue = s.constructor as unknown as new () => typeof s;
      const rogue = new Rogue(); // the PaperScope constructor makes itself the active scope
      rogue.setup(new rogue.Size(1, 1));
    });
    withPaper((s) => {
      expect(toPaper(s, [square(0, 0, 10)]).project).toBe(s.project);
    });
  });
});

describe('paper-adapter: conversion', () => {
  it('round-trips closed, open and multi-subpath geometry', () => {
    const open: Subpath = { start: [0, 0], closed: false, segs: [[10, 20, 30, 20, 40, 0]] };
    withPaper((s) => {
      expect(fromPaper(toPaper(s, [square(0, 0, 10)]))).toEqual([square(0, 0, 10)]);
      expect(fromPaper(toPaper(s, [open]))).toEqual([open]);
      expect(fromPaper(toPaper(s, [square(0, 0, 10), kappaCircle(50, 50, 20)]))).toHaveLength(2);
    });
  });

  it('makes the closing segment explicit for an implicitly closed subpath', () => {
    const implicit: Subpath = { start: [0, 0], closed: true, segs: [[0, 0, 10, 0, 10, 0], [10, 0, 10, 10, 10, 10]] };
    withPaper((s) => {
      const [back] = fromPaper(toPaper(s, [implicit]));
      expect(back?.segs).toHaveLength(3);
      expect(back?.segs[2]).toEqual([10, 10, 0, 0, 0, 0]);
    });
  });

  it('skips empty subpaths and carries the fill rule', () => {
    withPaper((s) => {
      const item = toPaper(s, [{ start: [1, 1], segs: [], closed: false }, square(0, 0, 10)], 'evenodd');
      expect(item.fillRule).toBe('evenodd');
      expect(fromPaper(item)).toEqual([square(0, 0, 10)]);
    });
  });
});
