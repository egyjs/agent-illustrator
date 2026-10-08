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
  it('hands out random, unique ids and returns the same session on get', () => {
    const store = new MemorySessionStore(5);
    const a = store.create(doc());
    const b = store.create(doc());
    expect(a.id).toMatch(/^doc-[0-9a-f]{6}$/);
    expect(a.id).not.toBe(b.id);
    expect(store.get(b.id)).toBe(b);
    expect(store.size()).toBe(2);
    expect(a.lastCreated).toBeUndefined();
    expect(a.renders).toBe(0);
  });

  it('unknown ids fail with a hint that lists the open documents', () => {
    const store = new MemorySessionStore(5);
    const a = store.create(doc());
    const error = codeOf(() => store.get('doc-zzzzzz'));
    expect(error.code).toBe('unknown_id');
    expect(error.hint).toContain(a.id);
  });

  it('at the cap, closes the least recently used document and says so when it is asked for', () => {
    const closed: string[] = [];
    const store = new MemorySessionStore(2, (id) => closed.push(id));
    const a = store.create(doc());
    const b = store.create(doc());
    store.get(a.id);
    const c = store.create(doc());
    expect(closed).toEqual([b.id]);
    expect(store.size()).toBe(2);
    expect(store.get(a.id)).toBe(a);
    expect(store.get(c.id)).toBe(c);
    const error = codeOf(() => store.get(b.id));
    expect(error.code).toBe('unknown_id');
    expect(error.message).toContain('was closed');
  });
});
