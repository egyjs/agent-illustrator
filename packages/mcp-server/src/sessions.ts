import { DocumentStore, EngineError, type Doc } from '@agent-illustrator/engine';

export type Session = {
  readonly id: string;
  readonly store: DocumentStore;
  /** What "$last" refers to in the next batch. */
  lastCreated: string | undefined;
};

/** Where documents live between tool calls (FR-12.3); a Redis store can implement this later. */
export interface SessionStore {
  create(doc: Doc): Session;
  get(id: string): Session;
  size(): number;
}

export class MemorySessionStore implements SessionStore {
  readonly #sessions = new Map<string, Session>();
  readonly #max: number;
  #next = 1;

  constructor(maxDocuments: number) {
    this.#max = maxDocuments;
  }

  create(doc: Doc): Session {
    if (this.#sessions.size >= this.#max) {
      throw new EngineError('limit_exceeded', `this server already holds ${this.#max} documents`, 'Keep working in an existing doc_id instead of creating new ones.');
    }
    const session: Session = { id: `doc-${this.#next++}`, store: new DocumentStore(doc), lastCreated: undefined };
    this.#sessions.set(session.id, session);
    return session;
  }

  get(id: string): Session {
    const session = this.#sessions.get(id);
    if (!session) {
      const open = [...this.#sessions.keys()];
      throw new EngineError(
        'unknown_id',
        `no document "${id}"`,
        open.length > 0 ? `Open documents: ${open.join(', ')}.` : 'Call create_document first and use the doc_id it returns.',
      );
    }
    return session;
  }

  size(): number {
    return this.#sessions.size;
  }
}
