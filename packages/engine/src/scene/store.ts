import { castDraft, type Draft } from 'immer';
import { EngineError } from '../errors.ts';
import type { Doc, SceneNode } from './model.ts';

function childList(d: Draft<Doc>, parent: string): string[] {
  const owner = Object.hasOwn(d.nodes, parent) ? d.nodes[parent] : undefined;
  if (!owner || owner.type !== 'group') {
    throw new EngineError(
      'invalid_structure',
      `"${parent}" is not a group`,
      'Pass the id of a group as parent, or leave parent out to work at the top level.',
    );
  }
  return owner.children;
}

/** Adds the node to the map and to its parent's children (or root) at `index`; the default is on top. */
export function insertNode(d: Draft<Doc>, node: SceneNode, index?: number): void {
  d.nodes[node.id] = castDraft(node);
  const list = node.parent === null ? d.root : childList(d, node.parent);
  list.splice(index ?? list.length, 0, node.id);
}

/** Takes the node out of its parent's list (it stays in the map) and reports where it was. */
export function detach(d: Draft<Doc>, id: string): { parent: string | null; index: number } {
  const node = d.nodes[id]!;
  const list = node.parent === null ? d.root : childList(d, node.parent);
  const index = list.indexOf(id);
  if (index >= 0) list.splice(index, 1);
  return { parent: node.parent, index };
}

/** Deletes the node and its descendants; returns the removed ids, parents first. */
export function removeSubtree(d: Draft<Doc>, id: string): string[] {
  detach(d, id);
  const removed: string[] = [];
  const walk = (nid: string): void => {
    const node = d.nodes[nid];
    if (!node) return;
    removed.push(nid);
    if (node.type === 'group') for (const child of [...node.children]) walk(child);
    delete d.nodes[nid];
  };
  walk(id);
  return removed;
}

const MAX_UNDO = 50;
const MAX_CHECKPOINTS = 50;
const CHECKPOINT_LABEL = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * A document's current version, an undo stack of the last 50 earlier versions and named
 * checkpoints (FR-12.1). Versions are immutable, so the stack and the checkpoints only hold
 * references and going back to one is exact.
 */
export class DocumentStore {
  #doc: Doc;
  readonly #checkpoints = new Map<string, Doc>();
  readonly #undo: Doc[] = [];

  constructor(doc: Doc) {
    this.#doc = doc;
  }

  get doc(): Doc {
    return this.#doc;
  }

  /** How many versions `undo` can still go back through. */
  get undoDepth(): number {
    return this.#undo.length;
  }

  /** Makes `doc` current and keeps the version it replaces for `undo`; the same version is not a change. */
  commit(doc: Doc): void {
    if (doc === this.#doc) return;
    this.#undo.push(this.#doc);
    if (this.#undo.length > MAX_UNDO) this.#undo.shift();
    this.#doc = doc;
  }

  /** Goes back to the version before the last commit or restore. */
  undo(): Doc {
    const previous = this.#undo.pop();
    if (!previous) {
      throw new EngineError('invalid_input', 'nothing to undo', `Undo goes back through the last ${MAX_UNDO} changes; this document has none left. Restore a checkpoint instead.`);
    }
    this.#doc = previous;
    return previous;
  }

  /** Names the current version; saving a label again moves it. */
  checkpoint(label: string): void {
    if (!CHECKPOINT_LABEL.test(label)) {
      throw new EngineError('invalid_input', `bad checkpoint label ${JSON.stringify(label.slice(0, 80))}`, 'Use 1-64 letters, digits, "_", "-" or ".", for example "before-sky".');
    }
    if (!this.#checkpoints.has(label) && this.#checkpoints.size >= MAX_CHECKPOINTS) {
      throw new EngineError('limit_exceeded', `a document keeps at most ${MAX_CHECKPOINTS} checkpoints`, `Reuse a label to replace its checkpoint. Existing: ${this.checkpoints().join(', ')}.`);
    }
    this.#checkpoints.set(label, this.#doc);
  }

  /** Makes the checkpointed version current; the version it replaces goes on the undo stack. */
  restore(label: string): Doc {
    const doc = this.#checkpoints.get(label);
    if (!doc) {
      const known = [...this.#checkpoints.keys()];
      throw new EngineError(
        'unknown_id',
        `no checkpoint "${label}"`,
        known.length > 0 ? `Known checkpoints: ${known.join(', ')}.` : 'Save a checkpoint before restoring one.',
      );
    }
    this.commit(doc);
    return doc;
  }

  checkpoints(): string[] {
    return [...this.#checkpoints.keys()];
  }
}
