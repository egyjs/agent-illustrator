import { randomBytes } from 'node:crypto';
import { DocumentStore, EngineError, type Doc } from '@agent-illustrator/engine';

export type Session = {
  readonly id: string;
  readonly store: DocumentStore;
  /** What "$last" refers to in the next batch. */
  lastCreated: string | undefined;
  /** Renders so far; names this document's PNG fallback files. */
  renders: number;
};

/** Where documents live between tool calls (FR-12.3); a Redis store can implement this later. */
export interface SessionStore {
  create(doc: Doc): Session;
  get(id: string): Session;
  size(): number;
}

const REMEMBER_CLOSED = 1000;

/**
 * In-memory documents with random ids, so ids from another server process or an earlier run never
 * silently hit a different drawing. At the cap, the least recently used document is closed to make
 * room, and asking for it later says so.
 */
export class MemorySessionStore implements SessionStore {
  readonly #sessions = new Map<string, Session>();
  readonly #closed = new Set<string>();
  readonly #max: number;
  readonly #onClose: (id: string) => void;

  constructor(maxDocuments: number, onClose: (id: string) => void = () => {}) {
    this.#max = maxDocuments;
    this.#onClose = onClose;
  }

  create(doc: Doc): Session {
    while (this.#sessions.size >= this.#max) {
      const oldest = this.#sessions.keys().next().value!;
      this.#sessions.delete(oldest);
      this.#closed.add(oldest);
      if (this.#closed.size > REMEMBER_CLOSED) this.#closed.delete(this.#closed.values().next().value!);
      this.#onClose(oldest);
    }
    let id: string;
    do id = `doc-${randomBytes(3).toString('hex')}`;
    while (this.#sessions.has(id) || this.#closed.has(id));
    const session: Session = { id, store: new DocumentStore(doc), lastCreated: undefined, renders: 0 };
    this.#sessions.set(id, session);
    return session;
  }

  get(id: string): Session {
    const session = this.#sessions.get(id);
    if (!session) {
      if (this.#closed.has(id)) {
        throw new EngineError('unknown_id', `document "${id}" was closed to make room (the server keeps ${this.#max} open)`, 'Create a new document and redraw it.');
      }
      const open = [...this.#sessions.keys()];
      throw new EngineError(
        'unknown_id',
        `no document "${id}"`,
        open.length > 0 ? `Open documents: ${open.join(', ')}.` : 'Call create_document first and use the doc_id it returns.',
      );
    }
    this.#sessions.delete(id);
    this.#sessions.set(id, session); // most recently used last
    return session;
  }

  size(): number {
    return this.#sessions.size;
  }
}
