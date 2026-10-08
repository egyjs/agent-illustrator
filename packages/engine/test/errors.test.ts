import { describe, expect, it } from 'vitest';
import { closest, EngineError } from '../src/errors.ts';

describe('errors', () => {
  it('EngineError carries code, message and hint', () => {
    const e = new EngineError('unknown_id', 'no node "x"', 'List ids first.');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('EngineError');
    expect(e.info).toEqual({ code: 'unknown_id', message: 'no node "x"', hint: 'List ids first.' });
  });

  it('closest suggests near names, nearest first, ignoring case', () => {
    expect(closest('elipse', ['rect', 'ellipse', 'line'])).toEqual(['ellipse']);
    expect(closest('Rect', ['line', 'react', 'rect'])).toEqual(['rect', 'react']);
    expect(closest('zzz', ['rect'])).toEqual([]);
  });
});
