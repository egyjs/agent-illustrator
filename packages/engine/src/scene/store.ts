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

/**
 * A document's current version plus named checkpoints (FR-12.1). Versions are immutable, so a
 * checkpoint is only a reference and restoring one is exact.
 */
export class DocumentStore {
  #doc: Doc;
  readonly #checkpoints = new Map<string, Doc>();

  constructor(doc: Doc) {
    this.#doc = doc;
  }

  get doc(): Doc {
    return this.#doc;
  }

  commit(doc: Doc): void {
    this.#doc = doc;
  }

  checkpoint(label: string): void {
    this.#checkpoints.set(label, this.#doc);
  }

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
    this.#doc = doc;
    return doc;
  }

  checkpoints(): string[] {
    return [...this.#checkpoints.keys()];
  }
}
