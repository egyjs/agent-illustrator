// rbush 4 ships no declarations and @types/rbush is not a dependency; this covers the calls spatial-index.ts makes.
declare module 'rbush' {
  export interface BBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }
  export default class RBush<T extends BBox> {
    constructor(maxEntries?: number);
    load(items: readonly T[]): this;
    search(box: BBox): T[];
  }
}
