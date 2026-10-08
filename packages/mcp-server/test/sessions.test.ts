import { createDocument, EngineError } from '@agent-illustrator/engine';
import { describe, expect, it } from 'vitest';
import { MemorySessionStore } from '../src/sessions.ts';

const doc = () => createDocument({ width: 10, height: 10 });
function codeOf(fn: () => unknown): EngineError {
  try {
    fn();
  } catch (e) {
    if (e instanceof EngineError) return e;
  }
  throw new Error('expected an EngineError');
}

describe('MemorySessionStore', () => {
  it('hands out sequential ids and returns the same session on get', () => {
    const store = new MemorySessionStore(5);
    const a = store.create(doc());
    const b = store.create(doc());
    expect([a.id, b.id]).toEqual(['doc-1', 'doc-2']);
    expect(store.get('doc-2')).toBe(b);
    expect(store.size()).toBe(2);
    expect(a.lastCreated).toBeUndefined();
  });

  it('unknown ids fail with a hint that lists the open documents', () => {
    const store = new MemorySessionStore(5);
    store.create(doc());
    const error = codeOf(() => store.get('doc-9'));
    expect(error.code).toBe('unknown_id');
    expect(error.hint).toContain('doc-1');
  });

  it('refuses more documents than the limit', () => {
    const store = new MemorySessionStore(1);
    store.create(doc());
    expect(codeOf(() => store.create(doc())).code).toBe('limit_exceeded');
  });
});
