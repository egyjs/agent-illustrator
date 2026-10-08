# M2: Scene, Registry, Transactions, SVG Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a plain-JSON scene model on top of the M1 geometry kernel, plus everything needed to change and draw it. That means:
- a validated document schema
- world transforms and exact world bounds
- immer-based edits with checkpoints
- one op registry with an all-or-nothing batch executor and `{ code, message, hint }` errors
- seven initial ops
- a deterministic SVG serializer

**Architecture:**
- **Layers.** `scene` (model, color, query, store) sits on `geometry`. `ops` (registry plus op domains) sits on `scene`. `render/svg.ts` reads `scene`.
- **Running a batch.** `executeBatch` first validates every call with its op's zod schema. It then applies the ops in order, one immer `produce` per op, so every op reads a frozen document and the WeakMap caches stay valid. Any failure returns the untouched original document.
- **Public API.** `packages/engine/src/index.ts` exposes the engine for M3.

**Tech Stack:**
- TypeScript ~6.0.3 (type stripping on Node ≥ 22.18), vitest ^5.0.3
- zod ^4.6.5, immer ^11.1.21, culori ^4.0.2 (+ @types/culori ^4.0.1)
- the M1 geometry module

**Spec:**
- [`PROJECT_INIT.md`](../../../PROJECT_INIT.md): §2.1, §2.3, FR-1, FR-2, FR-3.1, FR-11.3, NFR-1/3/4, §4, §5 M2.
- [`specs/2026-10-07-agent-illustrator-v1-design.md`](../specs/2026-10-07-agent-illustrator-v1-design.md): A3 scene model (adopted here as the default, with the refinements below) and S5 (decided here).
- Roadmap: [`2026-10-07-v1-roadmap.md`](2026-10-07-v1-roadmap.md).

## Decisions taken in this plan (flag to the owner)

- **A3 adopted as the default** (status "Proposed"; the owner set the goal "plan and execute until MVP", so it proceeds unless they object). Refinements:
  1. World-transform caching is keyed by the node object *and validated against the parent's world matrix*. A3 point 4 ("caches survive without invalidation") holds for per-node data such as local geometry, but not for world transforms: an ancestor can change while the node object stays identical.
  2. `defs` (gradients, filters) arrive with M5, and `text` nodes with M8. M2 has `group` and `path` only.
  3. Ids also reject `canvas`, names starting with `__`, and `Object.prototype` member names such as `constructor`. This prevents prototype pollution of the `nodes` map.
- **S5 adopted:** merged op variants (`boolean {mode}`, one `transform`, `array {kind}`, `gradient {type}`), about 35 ops in total. The M2 ops are unaffected; M4–M6 use the merged forms.
- **Style edits use `{ ids, style, unset }`.** The `style` object reuses the same schema as the shape ops' `style` field.
- **Colors.** A paint is any CSS color culori parses, or `none`, or a token name. The serializer always writes `#rrggbb` (or `rgba()` when translucent), so every renderer, resvg 0.34 included, understands the output.

## Global Constraints

- **Runtime and syntax**
  - `engines.node` is `">=22.18"`. TypeScript is `~6.0.3`. All packages are ESM.
  - Relative imports carry the `.ts` extension. Type-only imports use `import type`.
  - Erasable syntax only: no enums, namespaces or parameter properties.
- **Layering (ESLint `LAYER_BANS`)**
  - `scene` may import `geometry`. `ops` may import `scene` and `geometry`. `render` may import `scene` and `geometry`. Nothing imports `ops` except `engine/src/index.ts`.
  - `engine/src/errors.ts` sits at the src root and imports nothing.
  - Only `geometry` imports paper.
  - The engine never mentions MCP or LLMs, hint texts included.
- **Determinism.** `Math.random` is banned in `packages/engine/**`. The same ops on the same document give the same document and the same SVG (NFR-4).
- **Errors (NFR-3).** Every engine error is an `EngineError` with `{ code, message, hint }`. The hint says how to fix the call.
- **All-or-nothing batches (FR-2.3).** Validate everything first, then apply. Any failure leaves the original document object unchanged.
- **Scene data**
  - Plain readonly data, frozen by immer.
  - Lookups by id go through `getNode`/`requireNode` (`Object.hasOwn`), never a bare `doc.nodes[id]` on untrusted ids.
- **Workflow**
  - Work on branch `m2-scene`, created from `main` after M1 is merged.
  - Commit messages are conventional and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Shell: no `>` redirects and no `bash`/`node -e` (the lean-ctx allowlist). Run scripts as files.

## Review Focus

1. **Prototype-named ids** (`__proto__`, `constructor`, `toString`). They must be rejected as new ids and must never resolve through prototype lookup. Tests: Task 2 (`accepts semantic ids and rejects unusable ones`), Task 4 (`requireNode explains unknown ids…`), Task 5 (`rejects unusable ids`).
2. **A stale world transform.** An ancestor's transform changes while the child node object stays shared. World transforms and bounds must follow. Test: Task 4 (`caches per node object but follows a changed ancestor`).
3. **A failure in the middle of a batch leaves no trace.** The same document object comes back, `$last` is unchanged, and statuses read rolled_back / error / skipped. Tests: Task 5 (`rolls back the whole batch…`) and Task 9 (acceptance).
4. **Paints that resvg cannot parse.** Named, `oklch()`, translucent and token colors must reach the SVG as `#rrggbb` or `rgba()`. Tests: Task 1 (color tests) and Task 8 (`resolves tokens, keeps translucency…`).
5. **Grouping non-adjacent siblings.** The z-order position and the world placement must be preserved. Test: Task 7 (`group wraps siblings at the topmost member's z position…`).

---

## File Structure

```
pnpm-workspace.yaml                         # + catalog: @types/culori, culori, immer (Task 1)
packages/engine/package.json                # + dependencies culori, immer, zod; devDependencies @types/culori (Task 1)
packages/engine/src/
  errors.ts          # EngineError, ErrorCode, ErrorInfo, closest() (Task 1)
  index.ts           # public API (Task 9)
  scene/color.ts     # toSvgColor, resolvePaint (Task 1)
  scene/model.ts     # types, isValidId, StyleSchema, DocSchema, createDocument, validateDocument, integrityProblem (Task 2)
  scene/store.ts     # insertNode, detach, removeSubtree, DocumentStore (Task 3)
  scene/query.ts     # getNode, requireNode, worldTransform, worldBounds, worldSubpaths, subtreeIds, siblings (Task 4)
  ops/registry.ts    # Length, OpContext, defineOp, Registry, executeBatch, DEFAULT_LIMITS (Task 5)
  ops/shapes.ts      # rect, ellipse, polygon, line (Task 6)
  ops/style.ts       # style (Task 7)
  ops/structure.ts   # group, delete (Task 7)
  ops/index.ts       # createRegistry() (Task 7)
  render/svg.ts      # toSvg (Task 8)
packages/engine/test/
  fixtures.ts        # pathNode, groupNode, docOf, expectIntact, expectCode (Task 2)
  errors.test.ts  scene/color.test.ts  scene/model.test.ts  scene/store.test.ts  scene/query.test.ts
  ops/registry.test.ts  ops/shapes.test.ts  ops/structure.test.ts  render/svg.test.ts  acceptance.test.ts
packages/mcp-server/package.json            # + dependencies culori, immer, paper, zod (Task 9)
docs/…                                      # spec A3/S5 outcomes, roadmap (Task 9)
```

---

### Task 1: Dependencies, `errors.ts`, `scene/color.ts`

**Files:**
- Modify: `pnpm-workspace.yaml`, `packages/engine/package.json`
- Create: `packages/engine/src/errors.ts`, `packages/engine/src/scene/color.ts`
- Test: `packages/engine/test/errors.test.ts`, `packages/engine/test/scene/color.test.ts`

**Interfaces:**
- Produces:
  - `type ErrorCode`: `'invalid_input' | 'unknown_op' | 'unknown_id' | 'invalid_reference' | 'invalid_color' | 'invalid_structure' | 'invalid_document' | 'limit_exceeded' | 'internal_error'`
  - `type ErrorInfo = { code, message, hint }`
  - `class EngineError extends Error { code; hint; get info(): ErrorInfo }`
  - `closest(name: string, candidates: Iterable<string>, max = 3): string[]`
  - `toSvgColor(value: string): string | undefined`
  - `resolvePaint(doc: Pick<Doc, 'tokens'>, paint: string): string | undefined`

- [ ] **Step 1: Add the dependencies**

In `pnpm-workspace.yaml` `catalog:`, add `'@types/culori': ^4.0.1` (before `'@types/node'`), `culori: ^4.0.2` (after `'@types/node'`) and `immer: ^11.1.21` (after `eslint`).

Set `packages/engine/package.json` to:

```json
{
  "name": "@agent-illustrator/engine",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "culori": "catalog:", "immer": "catalog:", "paper": "catalog:", "zod": "catalog:" },
  "devDependencies": { "@types/culori": "catalog:" }
}
```

Run: `pnpm install`
Expected: exit 0.

- [ ] **Step 2: Write the failing tests**

`packages/engine/test/errors.test.ts`:

```ts
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
```

`packages/engine/test/scene/color.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolvePaint, toSvgColor } from '../../src/scene/color.ts';

describe('scene/color', () => {
  it('normalizes CSS colors to lowercase #rrggbb', () => {
    expect(toSvgColor('#fff')).toBe('#ffffff');
    expect(toSvgColor('teal')).toBe('#008080');
    expect(toSvgColor('RebeccaPurple')).toBe('#663399');
    expect(toSvgColor('rgb(42 157 143)')).toBe('#2a9d8f');
    expect(toSvgColor(' #2A9D8F ')).toBe('#2a9d8f');
  });

  it('turns other color spaces into hex, so any renderer can draw them', () => {
    expect(toSvgColor('oklch(1 0 0)')).toBe('#ffffff');
    expect(toSvgColor('hsl(0 100% 50%)')).toBe('#ff0000');
  });

  it('keeps translucency as rgba() and none as none', () => {
    expect(toSvgColor('rgb(255 0 0 / 50%)')).toBe('rgba(255, 0, 0, 0.5)');
    expect(toSvgColor('none')).toBe('none');
  });

  it('returns undefined for anything that is not a color', () => {
    expect(toSvgColor('palette.primary')).toBeUndefined();
    expect(toSvgColor('')).toBeUndefined();
    expect(toSvgColor('#12')).toBeUndefined();
  });

  it('resolvePaint looks up tokens first and ignores prototype members', () => {
    const doc = { tokens: { 'palette.primary': '#E76F51' } };
    expect(resolvePaint(doc, 'palette.primary')).toBe('#e76f51');
    expect(resolvePaint(doc, 'navy')).toBe('#000080');
    expect(resolvePaint(doc, 'palette.missing')).toBeUndefined();
    expect(resolvePaint(doc, 'constructor')).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm exec vitest run packages/engine/test/errors.test.ts packages/engine/test/scene/color.test.ts`
Expected: FAIL. `Cannot find module '../src/errors.ts'` and `'../../src/scene/color.ts'`.

- [ ] **Step 4: Write `errors.ts`**

`packages/engine/src/errors.ts`:

```ts
/** Machine-readable error kinds. Every error also carries a hint that says how to fix the call (NFR-3). */
export type ErrorCode =
  | 'invalid_input'
  | 'unknown_op'
  | 'unknown_id'
  | 'invalid_reference'
  | 'invalid_color'
  | 'invalid_structure'
  | 'invalid_document'
  | 'limit_exceeded'
  | 'internal_error';

export type ErrorInfo = { readonly code: ErrorCode; readonly message: string; readonly hint: string };

export class EngineError extends Error {
  readonly code: ErrorCode;
  readonly hint: string;

  constructor(code: ErrorCode, message: string, hint: string) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.hint = hint;
  }

  get info(): ErrorInfo {
    return { code: this.code, message: this.message, hint: this.hint };
  }
}

/** Up to `max` candidates within edit distance max(2, ⌊length/3⌋) of `name`, ignoring case, nearest first. */
export function closest(name: string, candidates: Iterable<string>, max = 3): string[] {
  const limit = Math.max(2, Math.floor(name.length / 3));
  const scored: [string, number][] = [];
  for (const c of candidates) {
    const d = editDistance(name.toLowerCase(), c.toLowerCase());
    if (d <= limit) scored.push([c, d]);
  }
  scored.sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return scored.slice(0, max).map(([c]) => c);
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length]!;
}
```

- [ ] **Step 5: Write `scene/color.ts`**

`packages/engine/src/scene/color.ts`:

```ts
import { formatHex, formatRgb, parse } from 'culori';
import type { Doc } from './model.ts';

/**
 * Any CSS color culori parses (hex, names, rgb(), hsl(), oklch(), …) → a color string every SVG
 * renderer understands: '#rrggbb', or 'rgba(r, g, b, a)' when translucent. 'none' stays 'none'.
 * Out-of-gamut colors are clamped to sRGB. Returns undefined when the string is not a color.
 */
export function toSvgColor(value: string): string | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'none') return 'none';
  const color = parse(v);
  if (!color) return undefined;
  return color.alpha === undefined || color.alpha >= 1 ? formatHex(color) : formatRgb(color);
}

/** A paint is a token name (looked up first) or a color; undefined when it is neither. */
export function resolvePaint(doc: Pick<Doc, 'tokens'>, paint: string): string | undefined {
  const token = Object.hasOwn(doc.tokens, paint) ? doc.tokens[paint] : undefined;
  return toSvgColor(token ?? paint);
}
```

The `Doc` type comes from `model.ts` (Task 2). Until then, typecheck fails on this import; tests still run, because vitest strips types. Step 7 runs typecheck only after Task 2, so this task's Step 7 runs lint alone.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm exec vitest run packages/engine/test/errors.test.ts packages/engine/test/scene/color.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 7: Lint**

Run: `pnpm lint`
Expected: exit 0. (Typecheck waits for Task 2, which defines `Doc`.)

- [ ] **Step 8: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml packages/engine/package.json packages/engine/src/errors.ts packages/engine/src/scene/color.ts packages/engine/test/errors.test.ts packages/engine/test/scene/color.test.ts
git commit -m "feat(engine): engine errors with hints and CSS color normalization" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `scene/model.ts`

**Files:**
- Create: `packages/engine/src/scene/model.ts`
- Create: `packages/engine/test/fixtures.ts`
- Test: `packages/engine/test/scene/model.test.ts`

**Interfaces:**
- Consumes:
  - `EngineError` from `errors.ts`
  - `toSvgColor` from `color.ts`
  - `FillRule`, `Mat6`, `Subpath` from `geometry/types.ts`
  - test helper `square` from `test/geometry/helpers.ts`
- Produces:
  - `ID_PATTERN`, `RESERVED_IDS`, `MAX_CANVAS = 16384`
  - `isValidId(id: string): boolean`
  - types `Paint`, `LineCap`, `LineJoin`, `Style`, `NodeMeta`, `GroupNode`, `PathNode`, `SceneNode`, `Canvas`, `Doc`
  - `PaintSchema`, `StyleSchema`, `SubpathSchema`, `DocSchema` (zod)
  - `type CreateDocumentInput = { width; height; background?; seed? }`
  - `createDocument(input): Doc`, `validateDocument(json: unknown): Doc`, `integrityProblem(doc: Doc): string | null`
  - fixtures: `pathNode(id, subpaths, extra?)`, `groupNode(id, children, extra?)`, `docOf(nodes, root?)`, `expectIntact(doc)`, `expectCode(fn, code)`

- [ ] **Step 1: Write the fixtures**

`packages/engine/test/fixtures.ts`:

```ts
import { expect } from 'vitest';
import { EngineError } from '../src/errors.ts';
import { IDENTITY } from '../src/geometry/transform.ts';
import type { Subpath } from '../src/geometry/types.ts';
import { integrityProblem, type Doc, type GroupNode, type PathNode, type SceneNode } from '../src/scene/model.ts';

export function pathNode(id: string, subpaths: Subpath[], extra: Partial<PathNode> = {}): PathNode {
  return { id, type: 'path', parent: null, transform: IDENTITY, style: {}, fillRule: 'nonzero', subpaths, ...extra };
}

export function groupNode(id: string, children: string[], extra: Partial<GroupNode> = {}): GroupNode {
  return { id, type: 'group', parent: null, transform: IDENTITY, style: {}, children, ...extra };
}

/** An 800×600 document holding these nodes; `root` defaults to every node without a parent, in order. */
export function docOf(nodes: SceneNode[], root?: string[]): Doc {
  return {
    schema: 1,
    seed: 1,
    canvas: { width: 800, height: 600 },
    tokens: {},
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    root: root ?? nodes.filter((n) => n.parent === null).map((n) => n.id),
  };
}

export function expectIntact(doc: Doc): void {
  expect(integrityProblem(doc)).toBeNull();
}

/** Runs fn and expects an EngineError with this code. */
export function expectCode(fn: () => unknown, code: string): EngineError {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(EngineError);
  expect((caught as EngineError).code).toBe(code);
  return caught as EngineError;
}
```

- [ ] **Step 2: Write the failing test**

`packages/engine/test/scene/model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createDocument, integrityProblem, isValidId, validateDocument } from '../../src/scene/model.ts';
import { docOf, expectCode, groupNode, pathNode } from '../fixtures.ts';
import { square } from '../geometry/helpers.ts';

describe('scene/model: ids', () => {
  it('accepts semantic ids and rejects unusable ones', () => {
    for (const id of ['sky', 'tree_1', 'Hill.left', 'a-b', '_x', 'x'.repeat(64)]) expect(isValidId(id)).toBe(true);
    for (const id of ['', '1tree', 'has space', 'canvas', '$last', '__proto__', 'constructor', 'toString', 'x'.repeat(65)]) {
      expect(isValidId(id)).toBe(false);
    }
  });
});

describe('scene/model: createDocument', () => {
  it('creates an empty document with defaults', () => {
    expect(createDocument({ width: 800, height: 600 })).toEqual({
      schema: 1,
      seed: 1,
      canvas: { width: 800, height: 600 },
      tokens: {},
      nodes: {},
      root: [],
    });
    const doc = createDocument({ width: 10, height: 20, background: '#fff', seed: 42 });
    expect(doc.canvas).toEqual({ width: 10, height: 20, background: '#fff' });
    expect(doc.seed).toBe(42);
  });

  it.each([
    [{ width: 0, height: 10 }, 'invalid_input'],
    [{ width: 10, height: Number.NaN }, 'invalid_input'],
    [{ width: 20_000, height: 10 }, 'invalid_input'],
    [{ width: 10, height: 10, seed: 1.5 }, 'invalid_input'],
    [{ width: 10, height: 10, background: 'blurple' }, 'invalid_color'],
  ])('rejects %o with %s', (input, code) => {
    expectCode(() => createDocument(input), code);
  });
});

describe('scene/model: validateDocument', () => {
  const valid = docOf([groupNode('g', ['p']), pathNode('p', [square(0, 0, 10)], { parent: 'g' })]);

  it('accepts a valid document and its JSON round trip', () => {
    expect(integrityProblem(valid)).toBeNull();
    expect(validateDocument(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  });

  it.each([
    ['a node key that differs from its id', { ...valid, nodes: { ...valid.nodes, q: valid.nodes.p } }],
    ['a listed child that does not exist', { ...valid, root: ['g', 'ghost'] }],
    ['a parent link that disagrees with the list', { ...valid, nodes: { ...valid.nodes, p: { ...valid.nodes.p!, parent: null } } }],
    ['a node listed twice', { ...valid, root: ['g', 'p'] }],
    ['a node nobody lists', { ...valid, root: [] }],
    ['an unknown schema version', { ...valid, schema: 2 }],
    ['an unusable id', { ...valid, root: ['g'], nodes: { ...valid.nodes, constructor: pathNode('constructor', []) } }],
    ['an unknown style key', { ...valid, nodes: { ...valid.nodes, p: { ...valid.nodes.p!, style: { color: 'red' } } } }],
  ])('rejects %s', (_, doc) => {
    expectCode(() => validateDocument(doc), 'invalid_document');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm exec vitest run packages/engine/test/scene/model.test.ts`
Expected: FAIL. `Cannot find module '../../src/scene/model.ts'`.

- [ ] **Step 4: Write `scene/model.ts`**

`packages/engine/src/scene/model.ts`:

```ts
import { z } from 'zod';
import { EngineError } from '../errors.ts';
import type { FillRule, Mat6, Subpath } from '../geometry/types.ts';
import { toSvgColor } from './color.ts';

/** Semantic ids double as SVG ids: a letter or "_", then letters, digits, "_", "." or "-"; at most 64 characters. */
export const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
/** Words with a meaning of their own in op fields. */
export const RESERVED_IDS: ReadonlySet<string> = new Set(['canvas']);
export const MAX_CANVAS = 16384;

/** False for the pattern's misses, reserved words, and names that would collide with Object.prototype. */
export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id) && !id.startsWith('__') && !(id in Object.prototype) && !RESERVED_IDS.has(id);
}

/** A CSS color, 'none', or the name of a token in `doc.tokens`. */
export type Paint = string;
export type LineCap = 'butt' | 'round' | 'square';
export type LineJoin = 'miter' | 'round' | 'bevel';

export type Style = {
  readonly fill?: Paint;
  readonly stroke?: Paint;
  readonly strokeWidth?: number;
  readonly strokeCap?: LineCap;
  readonly strokeJoin?: LineJoin;
  readonly strokeDash?: readonly number[];
  readonly miterLimit?: number;
  readonly opacity?: number;
  readonly fillOpacity?: number;
  readonly strokeOpacity?: number;
};

/** Provenance: the primitive or generator parameters a node was made from (FR-1.2). */
export type NodeMeta = { readonly source?: unknown };

type NodeBase = {
  readonly id: string;
  readonly parent: string | null;
  readonly transform: Mat6;
  readonly style: Style;
  readonly meta?: NodeMeta;
};

export type GroupNode = NodeBase & { readonly type: 'group'; readonly children: readonly string[] };
export type PathNode = NodeBase & { readonly type: 'path'; readonly fillRule: FillRule; readonly subpaths: readonly Subpath[] };
export type SceneNode = GroupNode | PathNode;

export type Canvas = { readonly width: number; readonly height: number; readonly background?: Paint };

/** Spec A3: a flat node map keyed by id, plus the top-level z-order (back → front). */
export type Doc = {
  readonly schema: 1;
  readonly seed: number;
  readonly canvas: Canvas;
  readonly tokens: Readonly<Record<string, string>>;
  readonly nodes: Readonly<Record<string, SceneNode>>;
  readonly root: readonly string[];
};

// zod 4's z.number() already rejects NaN and ±Infinity.
const num = z.number();
const IdSchema = z.string().refine(isValidId, 'not a usable id');
const Vec2Schema = z.tuple([num, num]);
const SegSchema = z.tuple([num, num, num, num, num, num]);
const Mat6Schema = z.tuple([num, num, num, num, num, num]);

export const SubpathSchema = z.strictObject({ start: Vec2Schema, segs: z.array(SegSchema), closed: z.boolean() });
export const PaintSchema = z.string().min(1).max(64);
export const StyleSchema = z.strictObject({
  fill: PaintSchema.optional(),
  stroke: PaintSchema.optional(),
  strokeWidth: z.number().min(0).max(10_000).optional(),
  strokeCap: z.enum(['butt', 'round', 'square']).optional(),
  strokeJoin: z.enum(['miter', 'round', 'bevel']).optional(),
  strokeDash: z.array(z.number().min(0)).max(32).optional(),
  miterLimit: z.number().min(1).max(1000).optional(),
  opacity: z.number().min(0).max(1).optional(),
  fillOpacity: z.number().min(0).max(1).optional(),
  strokeOpacity: z.number().min(0).max(1).optional(),
});

const nodeBase = {
  id: IdSchema,
  parent: IdSchema.nullable(),
  transform: Mat6Schema,
  style: StyleSchema,
  meta: z.strictObject({ source: z.unknown().optional() }).optional(),
};
const GroupSchema = z.strictObject({ ...nodeBase, type: z.literal('group'), children: z.array(IdSchema) });
const PathSchema = z.strictObject({
  ...nodeBase,
  type: z.literal('path'),
  fillRule: z.enum(['nonzero', 'evenodd']),
  subpaths: z.array(SubpathSchema),
});

export const DocSchema = z.strictObject({
  schema: z.literal(1),
  seed: z.number().int(),
  canvas: z.strictObject({
    width: z.number().positive().max(MAX_CANVAS),
    height: z.number().positive().max(MAX_CANVAS),
    background: PaintSchema.optional(),
  }),
  tokens: z.record(z.string(), z.string()),
  nodes: z.record(IdSchema, z.discriminatedUnion('type', [GroupSchema, PathSchema])),
  root: z.array(IdSchema),
});

export type CreateDocumentInput = {
  readonly width: number;
  readonly height: number;
  readonly background?: Paint;
  readonly seed?: number;
};

/** A new empty document (FR-1.1). The seed defaults to 1; callers that want variety pass their own. */
export function createDocument(input: CreateDocumentInput): Doc {
  const { width, height, background, seed = 1 } = input;
  for (const [name, v] of [['width', width], ['height', height]] as const) {
    if (!Number.isFinite(v) || v <= 0 || v > MAX_CANVAS) {
      throw new EngineError(
        'invalid_input',
        `canvas ${name} must be a number in (0, ${MAX_CANVAS}], got ${v}`,
        'Give the canvas size in px, for example width 800 and height 600.',
      );
    }
  }
  if (!Number.isSafeInteger(seed)) {
    throw new EngineError('invalid_input', `seed must be an integer, got ${seed}`, 'Use a whole number such as 42, or leave seed out.');
  }
  if (background !== undefined && toSvgColor(background) === undefined) {
    throw new EngineError(
      'invalid_color',
      `background "${background}" is not a color`,
      'Use a CSS color such as "#ffffff", "white" or "rgb(240 240 240)", or "none".',
    );
  }
  return {
    schema: 1,
    seed,
    canvas: background === undefined ? { width, height } : { width, height, background },
    tokens: {},
    nodes: {},
    root: [],
  };
}

/** Untrusted JSON → Doc: the schema first, then the tree invariants. Throws invalid_document. */
export function validateDocument(json: unknown): Doc {
  const parsed = DocSchema.safeParse(json);
  const hint = 'Load a document saved by this engine; edits by hand must keep its schema.';
  if (!parsed.success) throw new EngineError('invalid_document', z.prettifyError(parsed.error), hint);
  const doc = parsed.data as Doc;
  const problem = integrityProblem(doc);
  if (problem) throw new EngineError('invalid_document', problem, hint);
  return doc;
}

/**
 * The first broken tree invariant, or null. Invariants: every map key equals its node's id; every
 * listed id exists, is listed once, and names its list's owner as parent; every node is reachable
 * from root.
 */
export function integrityProblem(doc: Doc): string | null {
  for (const [key, node] of Object.entries(doc.nodes)) {
    if (key !== node.id) return `node key "${key}" holds id "${node.id}"`;
  }
  const seen = new Set<string>();
  const visit = (ids: readonly string[], parent: string | null): string | null => {
    for (const id of ids) {
      const node = Object.hasOwn(doc.nodes, id) ? doc.nodes[id] : undefined;
      const where = parent === null ? 'root' : `group "${parent}"`;
      if (!node) return `"${id}" is listed in ${where} but does not exist`;
      if (seen.has(id)) return `"${id}" is listed more than once`;
      seen.add(id);
      if (node.parent !== parent) return `"${id}" names parent ${JSON.stringify(node.parent)} but is listed in ${where}`;
      if (node.type === 'group') {
        const problem = visit(node.children, id);
        if (problem) return problem;
      }
    }
    return null;
  };
  const problem = visit(doc.root, null);
  if (problem) return problem;
  const orphan = Object.keys(doc.nodes).find((id) => !seen.has(id));
  return orphan === undefined ? null : `"${orphan}" is not reachable from root`;
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm exec vitest run packages/engine/test/scene/model.test.ts`
Expected: PASS (16 tests). `it.each` counts each row: 1 (ids) + 1 + 5 (createDocument) + 1 + 8 (validateDocument).

- [ ] **Step 6: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/scene/model.ts packages/engine/test/fixtures.ts packages/engine/test/scene/model.test.ts
git commit -m "feat(scene): document model, id rules, zod schema and integrity check" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `scene/store.ts`

**Files:**
- Create: `packages/engine/src/scene/store.ts`
- Test: `packages/engine/test/scene/store.test.ts`

**Interfaces:**
- Consumes:
  - `Doc`, `SceneNode`, `createDocument` from `model.ts`
  - `EngineError`
  - fixtures
- Produces:
  - `insertNode(d: Draft<Doc>, node: SceneNode, index?: number): void`
  - `detach(d: Draft<Doc>, id: string): { parent: string | null; index: number }`
  - `removeSubtree(d: Draft<Doc>, id: string): string[]`
  - `class DocumentStore { constructor(doc); get doc(); commit(doc); checkpoint(label); restore(label): Doc; checkpoints(): string[] }`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/scene/store.test.ts`:

```ts
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import type { EngineError } from '../../src/errors.ts';
import { createDocument, type GroupNode } from '../../src/scene/model.ts';
import { detach, DocumentStore, insertNode, removeSubtree } from '../../src/scene/store.ts';
import { docOf, expectCode, expectIntact, groupNode, pathNode } from '../fixtures.ts';
import { square } from '../geometry/helpers.ts';

const base = docOf(
  [groupNode('g', ['a']), pathNode('a', [square(0, 0, 10)], { parent: 'g' }), pathNode('b', [square(20, 0, 10)])],
  ['g', 'b'],
);

describe('scene/store: tree edits on drafts', () => {
  it('insertNode adds on top by default, or at an index, in root or a group', () => {
    const next = produce(base, (d) => {
      insertNode(d, pathNode('c', []));
      insertNode(d, pathNode('d', []), 0);
      insertNode(d, pathNode('e', [], { parent: 'g' }));
    });
    expect(next.root).toEqual(['d', 'g', 'b', 'c']);
    expect((next.nodes.g as GroupNode).children).toEqual(['a', 'e']);
    expectIntact(next);
    expect(base.root).toEqual(['g', 'b']);
  });

  it('insertNode under a non-group throws invalid_structure and the base stays untouched', () => {
    expectCode(() => produce(base, (d) => insertNode(d, pathNode('x', [], { parent: 'b' }))), 'invalid_structure');
    expect(Object.keys(base.nodes)).toEqual(['g', 'a', 'b']);
  });

  it('removeSubtree deletes a group with its descendants, parents first', () => {
    let removed: string[] = [];
    const next = produce(base, (d) => {
      removed = removeSubtree(d, 'g');
    });
    expect(removed).toEqual(['g', 'a']);
    expect(Object.keys(next.nodes)).toEqual(['b']);
    expect(next.root).toEqual(['b']);
    expectIntact(next);
  });

  it('detach reports the former parent and index', () => {
    produce(base, (d) => {
      expect(detach(d, 'b')).toEqual({ parent: null, index: 1 });
      expect(detach(d, 'a')).toEqual({ parent: 'g', index: 0 });
    });
  });
});

describe('scene/store: DocumentStore', () => {
  it('checkpoints are references to immutable versions', () => {
    const v1 = createDocument({ width: 10, height: 10 });
    const store = new DocumentStore(v1);
    store.checkpoint('start');
    const v2 = produce(v1, (d) => {
      d.seed = 7;
    });
    store.commit(v2);
    expect(store.doc).toBe(v2);
    expect(store.restore('start')).toBe(v1);
    expect(store.doc).toBe(v1);
    expect(store.checkpoints()).toEqual(['start']);
  });

  it('restoring an unknown checkpoint names the known ones', () => {
    const store = new DocumentStore(createDocument({ width: 10, height: 10 }));
    store.checkpoint('first-pass');
    const e: EngineError = expectCode(() => store.restore('second'), 'unknown_id');
    expect(e.hint).toContain('first-pass');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run packages/engine/test/scene/store.test.ts`
Expected: FAIL. `Cannot find module '../../src/scene/store.ts'`.

- [ ] **Step 3: Write `scene/store.ts`**

`packages/engine/src/scene/store.ts`:

```ts
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run packages/engine/test/scene/store.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/scene/store.ts packages/engine/test/scene/store.test.ts
git commit -m "feat(scene): immer tree edits and checkpointed document store" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `scene/query.ts`

**Files:**
- Create: `packages/engine/src/scene/query.ts`
- Test: `packages/engine/test/scene/query.test.ts`

**Interfaces:**
- Consumes:
  - `pathBounds`, `unionBoxes` from `bezier.ts`
  - `applyToSubpaths`, `IDENTITY`, `multiply` from `transform.ts`
  - `closest`, `EngineError`
  - model types
- Produces:
  - `getNode(doc, id): SceneNode | undefined`
  - `requireNode(doc, id): SceneNode`
  - `worldTransform(doc, id): Mat6`
  - `worldBounds(doc, id): Box | null`
  - `worldSubpaths(doc, node: PathNode): Subpath[]`
  - `subtreeIds(doc, id): string[]`
  - `siblings(doc, node): readonly string[]`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/scene/query.test.ts`:

```ts
import { castDraft, produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyToPoint, rotate, scale, translate } from '../../src/geometry/transform.ts';
import { getNode, requireNode, siblings, subtreeIds, worldBounds, worldTransform } from '../../src/scene/query.ts';
import { docOf, expectCode, groupNode, pathNode } from '../fixtures.ts';
import { expectVec, square } from '../geometry/helpers.ts';

const nested = docOf([
  groupNode('g', ['h'], { transform: translate(10, 0) }),
  groupNode('h', ['p'], { parent: 'g', transform: scale(2) }),
  pathNode('p', [square(0, 0, 10)], { parent: 'h', transform: translate(1, 1) }),
]);

describe('scene/query: world transforms', () => {
  it('composes world = parent world · local', () => {
    expectVec(applyToPoint(worldTransform(nested, 'p'), [0, 0]), [12, 2]);
    expect(worldTransform(nested, 'g')).toBe(nested.nodes.g!.transform);
  });

  it('caches per node object but follows a changed ancestor', () => {
    expect(worldTransform(nested, 'p')).toBe(worldTransform(nested, 'p'));
    const moved = produce(nested, (d) => {
      d.nodes.g!.transform = castDraft(translate(100, 0));
    });
    expect(moved.nodes.p).toBe(nested.nodes.p); // structural sharing: p itself is unchanged
    expectVec(applyToPoint(worldTransform(moved, 'p'), [0, 0]), [102, 2]);
    expect(worldBounds(moved, 'p')).toEqual({ x: 102, y: 2, width: 20, height: 20 });
    expect(worldBounds(nested, 'p')).toEqual({ x: 12, y: 2, width: 20, height: 20 });
  });
});

describe('scene/query: world bounds', () => {
  it('are exact under rotation', () => {
    const doc = docOf([pathNode('p', [square(0, 0, 10)], { transform: rotate(45, 5, 5) })]);
    const b = worldBounds(doc, 'p')!;
    expect(b.width).toBeCloseTo(10 * Math.SQRT2, 9);
    expect(b.x).toBeCloseTo(5 - 5 * Math.SQRT2, 9);
  });

  it('union a group's children; empty groups and empty paths have none', () => {
    const doc = docOf([
      groupNode('g', ['a', 'b']),
      pathNode('a', [square(0, 0, 10)], { parent: 'g' }),
      pathNode('b', [square(20, 5, 10)], { parent: 'g' }),
      groupNode('empty', []),
      pathNode('blank', []),
    ]);
    expect(worldBounds(doc, 'g')).toEqual({ x: 0, y: 0, width: 30, height: 15 });
    expect(worldBounds(doc, 'empty')).toBeNull();
    expect(worldBounds(doc, 'blank')).toBeNull();
  });
});

describe('scene/query: lookup', () => {
  it('requireNode explains unknown ids and never returns prototype members', () => {
    const doc = docOf([pathNode('circle', [])]);
    expect(expectCode(() => requireNode(doc, 'ciricle'), 'unknown_id').hint).toContain('"circle"');
    expect(getNode(doc, 'constructor')).toBeUndefined();
    expect(getNode(doc, 'toString')).toBeUndefined();
    expectCode(() => requireNode(doc, '__proto__'), 'unknown_id');
  });

  it('subtreeIds lists a node and its descendants, parents first; siblings is the owning list', () => {
    expect(subtreeIds(nested, 'g')).toEqual(['g', 'h', 'p']);
    expect(siblings(nested, nested.nodes.p!)).toEqual(['p']);
    expect(siblings(nested, nested.nodes.g!)).toEqual(['g']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run packages/engine/test/scene/query.test.ts`
Expected: FAIL. `Cannot find module '../../src/scene/query.ts'`.

- [ ] **Step 3: Write `scene/query.ts`**

`packages/engine/src/scene/query.ts`:

```ts
import { closest, EngineError } from '../errors.ts';
import { pathBounds, unionBoxes } from '../geometry/bezier.ts';
import { applyToSubpaths, IDENTITY, multiply } from '../geometry/transform.ts';
import type { Box, Mat6, Subpath } from '../geometry/types.ts';
import type { Doc, PathNode, SceneNode } from './model.ts';

/** The node with this id, or undefined. Own keys only, so "constructor" and friends never resolve. */
export function getNode(doc: Doc, id: string): SceneNode | undefined {
  return Object.hasOwn(doc.nodes, id) ? doc.nodes[id] : undefined;
}

/** The node with this id, or an unknown_id error whose hint names the closest ids. */
export function requireNode(doc: Doc, id: string): SceneNode {
  const node = getNode(doc, id);
  if (node) return node;
  const ids = Object.keys(doc.nodes);
  const near = closest(id, ids);
  const hint =
    near.length > 0
      ? `Did you mean ${near.map((n) => `"${n}"`).join(' or ')}?`
      : ids.length > 0
        ? `Existing ids include ${ids.slice(0, 10).join(', ')}.`
        : 'The document is empty; create a node first.';
  throw new EngineError('unknown_id', `no node with id "${id}"`, hint);
}

const sameMatrix = (a: Mat6, b: Mat6) => a === b || a.every((v, i) => v === b[i]);

const worldCache = new WeakMap<SceneNode, { readonly parent: Mat6; readonly world: Mat6 }>();

/**
 * world = parentWorld · local (FR-1.4). The cache is keyed by the node object and checked against
 * the parent's world matrix, because an ancestor can change while this node object is shared.
 */
export function worldTransform(doc: Doc, id: string): Mat6 {
  const node = requireNode(doc, id);
  const parent = node.parent === null ? IDENTITY : worldTransform(doc, node.parent);
  const hit = worldCache.get(node);
  if (hit && sameMatrix(hit.parent, parent)) return hit.world;
  const world = node.parent === null ? node.transform : multiply(parent, node.transform);
  worldCache.set(node, { parent, world });
  return world;
}

/** A path's geometry in world space. */
export function worldSubpaths(doc: Doc, node: PathNode): Subpath[] {
  return applyToSubpaths(worldTransform(doc, node.id), node.subpaths);
}

const boundsCache = new WeakMap<PathNode, { readonly world: Mat6; readonly box: Box | null }>();

/**
 * Exact world-space bounds (FR-5.3): control points go through the world matrix, then exact Bézier
 * bounds are taken. Groups union their children. Empty groups and empty paths give null. Stroke
 * width is not included.
 */
export function worldBounds(doc: Doc, id: string): Box | null {
  const node = requireNode(doc, id);
  if (node.type === 'group') {
    return unionBoxes(node.children.map((c) => worldBounds(doc, c)).filter((b): b is Box => b !== null));
  }
  const world = worldTransform(doc, id);
  const hit = boundsCache.get(node);
  if (hit && sameMatrix(hit.world, world)) return hit.box;
  const box = pathBounds(applyToSubpaths(world, node.subpaths));
  boundsCache.set(node, { world, box });
  return box;
}

/** The node and everything below it, depth-first, parents before children. */
export function subtreeIds(doc: Doc, id: string): string[] {
  const out: string[] = [];
  const walk = (nid: string): void => {
    out.push(nid);
    const node = requireNode(doc, nid);
    if (node.type === 'group') node.children.forEach(walk);
  };
  walk(id);
  return out;
}

/** The list that holds the node: its parent's children, or root. */
export function siblings(doc: Doc, node: SceneNode): readonly string[] {
  if (node.parent === null) return doc.root;
  const parent = requireNode(doc, node.parent);
  return parent.type === 'group' ? parent.children : [];
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run packages/engine/test/scene/query.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/scene/query.ts packages/engine/test/scene/query.test.ts
git commit -m "feat(scene): world transforms and exact world bounds with safe caching" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `ops/registry.ts`

**Files:**
- Create: `packages/engine/src/ops/registry.ts`
- Test: `packages/engine/test/ops/registry.test.ts`

**Interfaces:**
- Consumes:
  - `closest`, `EngineError`, `ErrorInfo`
  - `resolvePaint`
  - `isValidId`, `Doc`, `SceneNode`, `Style`
  - `getNode`, `requireNode`, `worldBounds`
  - `insertNode` (tests)
- Produces:
  - `Length` (zod) and `type Length`, `type Axis = 'x' | 'y' | 'min'`
  - `type Warning`, `type OpResult = { id?; ids? }`
  - `type Limits`, `DEFAULT_LIMITS = { maxOpsPerBatch: 200, maxNodes: 5000, maxSegmentsPerPath: 20000 }`
  - `interface OpContext { doc; limits; update(recipe); node(ref); newId(requested, prefix); len(v, axis); style(s); warn(code, message) }`
  - `type OpCall`, `interface OpDef<S>`, `defineOp(def)`
  - `class Registry { register(...defs): this; get(name); names(); list() }`
  - `type OpOutcome`, `type BatchResult = { ok; committed; doc; results; lastCreated? }`, `type BatchOptions = { dryRun?; lastCreated?; limits? }`
  - `executeBatch(registry, doc, calls: readonly unknown[], options?): BatchResult`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/ops/registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { polyline } from '../../src/geometry/paths.ts';
import { IDENTITY } from '../../src/geometry/transform.ts';
import { defineOp, executeBatch, Length, Registry, type OpOutcome } from '../../src/ops/registry.ts';
import { createDocument, type Doc } from '../../src/scene/model.ts';
import { insertNode } from '../../src/scene/store.ts';
import { expectCode, expectIntact } from '../fixtures.ts';

/** Test op: a square of side `size` with its top-left corner at (x, y). */
const box = defineOp({
  name: 'box',
  domain: 'test',
  description: 'a test square',
  schema: z.strictObject({ id: z.string().optional(), x: Length, y: Length, size: z.number().positive(), fill: z.string().optional() }),
  examples: [[{ op: 'box', x: 0, y: 0, size: 10 }]],
  handler(input, ctx) {
    const x = ctx.len(input.x, 'x'), y = ctx.len(input.y, 'y'), s = input.size;
    const style = ctx.style(input.fill === undefined ? undefined : { fill: input.fill });
    const id = ctx.newId(input.id, 'box');
    const subpaths = [polyline([[x, y], [x + s, y], [x + s, y + s], [x, y + s]], true)];
    ctx.update((d) => insertNode(d, { id, type: 'path', parent: null, transform: IDENTITY, style, fillRule: 'nonzero', subpaths }));
    return { id };
  },
});
const touch = defineOp({
  name: 'touch',
  domain: 'test',
  description: 'resolves a reference',
  schema: z.strictObject({ ref: z.string() }),
  examples: [],
  handler(input, ctx) {
    return { ids: [ctx.node(input.ref).id] };
  },
});
const crash = defineOp({
  name: 'crash',
  domain: 'test',
  description: 'throws a non-engine error',
  schema: z.strictObject({}),
  examples: [],
  handler() {
    throw new TypeError('boom');
  },
});

const registry = new Registry().register(box, touch, crash);
const fresh = (): Doc => createDocument({ width: 800, height: 600 });
const statuses = (results: readonly OpOutcome[]) => results.map((o) => o.status);
const square = (id: string, x = 0) => ({ op: 'box', id, x, y: 0, size: 5 });

describe('ops/registry: executeBatch', () => {
  it('applies a valid batch and reports ids, exact bounds and warnings', () => {
    const r = executeBatch(registry, fresh(), [{ op: 'box', id: 'a', x: 10, y: 20, size: 5 }]);
    expect(r.ok).toBe(true);
    expect(r.committed).toBe(true);
    expect(r.results).toEqual([{ op: 'box', status: 'ok', id: 'a', bounds: { x: 10, y: 20, width: 5, height: 5 }, warnings: [] }]);
    expect(Object.keys(r.doc.nodes)).toEqual(['a']);
    expectIntact(r.doc);
  });

  it('validates every op before applying any', () => {
    const doc = fresh();
    const r = executeBatch(registry, doc, [square('a'), { op: 'box', x: 'ten', y: 0, size: 5 }, { op: 'nope' }, 'not an op']);
    expect(r.ok).toBe(false);
    expect(r.doc).toBe(doc);
    expect(statuses(r.results)).toEqual(['skipped', 'error', 'error', 'error']);
    expect(r.results[1]).toMatchObject({ error: { code: 'invalid_input' } });
    expect(r.results[2]).toMatchObject({ error: { code: 'unknown_op' } });
    expect(r.results[3]).toMatchObject({ op: '?', error: { code: 'invalid_input' } });
  });

  it('rolls back the whole batch when an op fails mid-way', () => {
    const doc = fresh();
    const r = executeBatch(registry, doc, [square('a'), square('b', 10), { op: 'touch', ref: 'missing' }, square('c', 20)]);
    expect(r.ok).toBe(false);
    expect(r.committed).toBe(false);
    expect(r.doc).toBe(doc);
    expect(statuses(r.results)).toEqual(['rolled_back', 'rolled_back', 'error', 'skipped']);
    expect(r.results[2]).toMatchObject({ error: { code: 'unknown_id' } });
    expect(r.lastCreated).toBeUndefined();
  });

  it('wraps unexpected exceptions as internal_error and rolls back', () => {
    const doc = fresh();
    const r = executeBatch(registry, doc, [square('a'), { op: 'crash' }]);
    expect(r.doc).toBe(doc);
    expect(r.results[1]).toMatchObject({ status: 'error', error: { code: 'internal_error', message: 'boom' } });
  });

  it('$last is the most recent node, and carries across batches through lastCreated', () => {
    const r1 = executeBatch(registry, fresh(), [square('a'), { op: 'touch', ref: '$last' }]);
    expect(r1.results[1]).toMatchObject({ status: 'ok', ids: ['a'] });
    expect(r1.lastCreated).toBe('a');
    const r2 = executeBatch(registry, r1.doc, [{ op: 'touch', ref: '$last' }], { lastCreated: r1.lastCreated });
    expect(r2.results[0]).toMatchObject({ ids: ['a'] });
    const r3 = executeBatch(registry, fresh(), [{ op: 'touch', ref: '$last' }]);
    expect(r3.results[0]).toMatchObject({ error: { code: 'invalid_reference' } });
  });

  it('suffixes taken ids with a warning and generates ids when none is given', () => {
    const r = executeBatch(registry, fresh(), [square('a'), square('a'), { op: 'box', x: 0, y: 0, size: 1 }, { op: 'box', x: 0, y: 0, size: 1 }]);
    expect(r.results.map((o) => ('id' in o ? o.id : undefined))).toEqual(['a', 'a-2', 'box-1', 'box-2']);
    expect(r.results[1]).toMatchObject({ warnings: [{ code: 'id_renamed' }] });
  });

  it('rejects unusable ids', () => {
    for (const id of ['constructor', '__proto__', 'canvas', '9lives']) {
      expect(executeBatch(registry, fresh(), [square(id)]).results[0]).toMatchObject({ error: { code: 'invalid_input' } });
    }
  });

  it('resolves percent lengths against the canvas', () => {
    const r = executeBatch(registry, fresh(), [{ op: 'box', x: '50%', y: '25%', size: 10 }]);
    expect(r.results[0]).toMatchObject({ bounds: { x: 400, y: 150, width: 10, height: 10 } });
  });

  it('a dry run reports results without committing', () => {
    const doc = fresh();
    const r = executeBatch(registry, doc, [square('a')], { dryRun: true });
    expect(r.ok).toBe(true);
    expect(r.committed).toBe(false);
    expect(r.doc).toBe(doc);
    expect(r.results[0]).toMatchObject({ status: 'ok', id: 'a' });
  });

  it('enforces the batch-size and node-count limits', () => {
    expectCode(() => executeBatch(registry, fresh(), [square('a'), square('b'), square('c')], { limits: { maxOpsPerBatch: 2 } }), 'limit_exceeded');
    const r = executeBatch(registry, fresh(), [square('a'), square('b')], { limits: { maxNodes: 1 } });
    expect(statuses(r.results)).toEqual(['rolled_back', 'error']);
    expect(r.results[1]).toMatchObject({ error: { code: 'limit_exceeded' } });
  });

  it('checks paints: colors and existing tokens pass, anything else fails and lists the tokens', () => {
    const doc: Doc = { ...fresh(), tokens: { 'palette.primary': '#e76f51' } };
    expect(executeBatch(registry, doc, [{ op: 'box', x: 0, y: 0, size: 5, fill: 'palette.primary' }]).ok).toBe(true);
    const bad = executeBatch(registry, doc, [{ op: 'box', x: 0, y: 0, size: 5, fill: 'palette.nope' }]);
    expect(bad.results[0]).toMatchObject({ error: { code: 'invalid_color' } });
    expect(JSON.stringify(bad.results[0])).toContain('palette.primary');
  });

  it('an unknown op gets a did-you-mean hint', () => {
    const r = executeBatch(registry, fresh(), [{ op: 'bx' }]);
    expect(JSON.stringify(r.results[0])).toContain('"box"');
  });
});

describe('ops/registry: Registry', () => {
  it('refuses to register two ops with one name', () => {
    expect(() => new Registry().register(box, box)).toThrow('registered twice');
    expect(registry.names()).toEqual(['box', 'touch', 'crash']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run packages/engine/test/ops/registry.test.ts`
Expected: FAIL. `Cannot find module '../../src/ops/registry.ts'`.

- [ ] **Step 3: Write `ops/registry.ts`**

`packages/engine/src/ops/registry.ts`:

```ts
import { produce, type Draft } from 'immer';
import { z } from 'zod';
import { closest, EngineError, type ErrorInfo } from '../errors.ts';
import type { Box } from '../geometry/types.ts';
import { resolvePaint } from '../scene/color.ts';
import { isValidId, type Doc, type SceneNode, type Style } from '../scene/model.ts';
import { getNode, requireNode, worldBounds } from '../scene/query.ts';

/** A coordinate or length: canvas units, or a percent string such as "50%" (FR-2.1). */
export const Length = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?%$/, 'expected a number or a percent string such as "50%"')]);
export type Length = z.output<typeof Length>;
/** What a percent refers to: the canvas width, its height, or the smaller of the two. */
export type Axis = 'x' | 'y' | 'min';

export type Warning = { readonly code: string; readonly message: string };
export type OpResult = { readonly id?: string; readonly ids?: readonly string[] };

export type Limits = { readonly maxOpsPerBatch: number; readonly maxNodes: number; readonly maxSegmentsPerPath: number };
export const DEFAULT_LIMITS: Limits = { maxOpsPerBatch: 200, maxNodes: 5000, maxSegmentsPerPath: 20_000 };

/** What a handler sees. `doc` is frozen and always current; changes go through `update`. */
export interface OpContext {
  readonly doc: Doc;
  readonly limits: Limits;
  /** Applies an immer recipe; `doc` reflects it right away. */
  update(recipe: (draft: Draft<Doc>) => void): void;
  /** Resolves an id or "$last" to a node; throws unknown_id or invalid_reference. */
  node(ref: string): SceneNode;
  /**
   * Claims an id for a new node: the requested one (suffixed -2, -3… with a warning when taken) or
   * "<prefix>-<n>". The claimed id becomes "$last".
   */
  newId(requested: string | undefined, prefix: string): string;
  /** Canvas units from a number or a percent of the canvas width (x), height (y) or smaller side (min). */
  len(v: Length, axis: Axis): number;
  /** Checks every paint in the style (a color or an existing token) and drops undefined keys. */
  style(s: Style | undefined): Style;
  warn(code: string, message: string): void;
}

/** One call as it arrives: `op` names the op; the other fields are its input. */
export type OpCall = { readonly op: string; readonly [field: string]: unknown };

export interface OpDef<S extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly domain: string;
  readonly description: string;
  readonly schema: S;
  /** Sample batches that run on an empty 800×600 document; the last call of each uses this op. */
  readonly examples: readonly (readonly OpCall[])[];
  handler(input: z.output<S>, ctx: OpContext): OpResult;
}

export function defineOp<S extends z.ZodType>(def: OpDef<S>): OpDef<S> {
  return def;
}

/** The single source of truth for ops (PROJECT_INIT §2.1.3). */
export class Registry {
  readonly #ops = new Map<string, OpDef>();

  register(...defs: readonly OpDef[]): this {
    for (const def of defs) {
      if (this.#ops.has(def.name)) throw new Error(`op "${def.name}" is registered twice`);
      this.#ops.set(def.name, def);
    }
    return this;
  }

  get(name: string): OpDef | undefined {
    return this.#ops.get(name);
  }

  names(): string[] {
    return [...this.#ops.keys()];
  }

  list(): OpDef[] {
    return [...this.#ops.values()];
  }
}

type Done = { readonly op: string; readonly id?: string; readonly ids?: readonly string[]; readonly bounds?: Box | null; readonly warnings: readonly Warning[] };

export type OpOutcome =
  | (Done & { readonly status: 'ok' | 'rolled_back' })
  | { readonly op: string; readonly status: 'error'; readonly error: ErrorInfo }
  | { readonly op: string; readonly status: 'skipped' };

export type BatchResult = {
  readonly ok: boolean;
  /** True when `doc` is the new version. False after a failure (the original comes back) and on dry runs. */
  readonly committed: boolean;
  readonly doc: Doc;
  readonly results: readonly OpOutcome[];
  /** What "$last" refers to after this batch; pass it to the next one. */
  readonly lastCreated?: string;
};

export type BatchOptions = { readonly dryRun?: boolean; readonly lastCreated?: string; readonly limits?: Partial<Limits> };

function paintError(doc: Doc, value: string): EngineError {
  const tokens = Object.keys(doc.tokens);
  return new EngineError(
    'invalid_color',
    `"${value}" is not a color or a token`,
    `Use a CSS color such as "#2a9d8f", "teal" or "rgb(42 157 143)", or "none"${tokens.length > 0 ? `, or a token: ${tokens.slice(0, 10).join(', ')}` : ''}.`,
  );
}

class Context implements OpContext {
  doc: Doc;
  last: string | undefined;
  readonly limits: Limits;
  readonly warnings: Warning[] = [];
  readonly #claimed = new Set<string>();

  constructor(doc: Doc, last: string | undefined, limits: Limits) {
    this.doc = doc;
    this.last = last;
    this.limits = limits;
  }

  update(recipe: (draft: Draft<Doc>) => void): void {
    this.doc = produce(this.doc, recipe);
  }

  node(ref: string): SceneNode {
    if (ref !== '$last') return requireNode(this.doc, ref);
    if (this.last === undefined) {
      throw new EngineError('invalid_reference', '"$last" was used before any node was created', 'Create a node first, or name it by its id.');
    }
    return requireNode(this.doc, this.last);
  }

  newId(requested: string | undefined, prefix: string): string {
    const taken = (id: string) => getNode(this.doc, id) !== undefined || this.#claimed.has(id);
    let id: string;
    if (requested === undefined) {
      let n = 1;
      while (taken(`${prefix}-${n}`)) n++;
      id = `${prefix}-${n}`;
    } else {
      if (!isValidId(requested)) {
        throw new EngineError(
          'invalid_input',
          `"${requested}" is not a usable id`,
          'Ids start with a letter or "_" and use letters, digits, "_", "." or "-" (at most 64). "canvas" is reserved.',
        );
      }
      const stem = requested.slice(0, 58);
      id = requested;
      for (let n = 2; taken(id); n++) id = `${stem}-${n}`;
      if (id !== requested) this.warn('id_renamed', `id "${requested}" is taken; the new node is "${id}"`);
    }
    this.#claimed.add(id);
    this.last = id;
    return id;
  }

  len(v: Length, axis: Axis): number {
    if (typeof v === 'number') return v;
    const { width, height } = this.doc.canvas;
    const ref = axis === 'x' ? width : axis === 'y' ? height : Math.min(width, height);
    return (Number.parseFloat(v) / 100) * ref;
  }

  style(s: Style | undefined): Style {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(s ?? {})) {
      if (value === undefined) continue;
      if ((key === 'fill' || key === 'stroke') && resolvePaint(this.doc, value as string) === undefined) {
        throw paintError(this.doc, value as string);
      }
      out[key] = value;
    }
    return out as Style;
  }

  warn(code: string, message: string): void {
    this.warnings.push({ code, message });
  }
}

type Parsed = { readonly def: OpDef; readonly input: unknown };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseCall(registry: Registry, call: unknown): Parsed | ErrorInfo {
  if (!isRecord(call)) {
    return { code: 'invalid_input', message: 'each op must be an object', hint: 'Write ops like {"op": "rect", "x": 10, "y": 10, "width": 100, "height": 50}.' };
  }
  const fields: Record<string, unknown> = { ...call };
  const name = fields.op;
  delete fields.op;
  if (typeof name !== 'string') {
    return { code: 'invalid_input', message: 'an op is missing its "op" name', hint: `Add "op" with one of: ${registry.names().join(', ')}.` };
  }
  const def = registry.get(name);
  if (!def) {
    const near = closest(name, registry.names());
    const guess = near.length > 0 ? `Did you mean ${near.map((n) => `"${n}"`).join(' or ')}? ` : '';
    return { code: 'unknown_op', message: `unknown op "${name}"`, hint: `${guess}Known ops: ${registry.names().join(', ')}.` };
  }
  const parsed = def.schema.safeParse(fields);
  if (!parsed.success) {
    const example = def.examples[0]?.at(-1);
    return {
      code: 'invalid_input',
      message: `${name}: ${z.prettifyError(parsed.error)}`,
      hint: example ? `Example: ${JSON.stringify(example)}` : `Check the fields of "${name}".`,
    };
  }
  return { def, input: parsed.data };
}

/**
 * Runs a batch of op calls as one transaction (FR-2.3):
 * 1. Every call is validated against its op's schema before anything runs.
 * 2. Ops apply in order, each in its own immer `produce`.
 * 3. Any failure returns the original document. Ops that ran become "rolled_back"; later ones are
 *    "skipped".
 *
 * Batch-level problems (too many ops) throw an EngineError instead.
 */
export function executeBatch(registry: Registry, doc: Doc, calls: readonly unknown[], options: BatchOptions = {}): BatchResult {
  const limits: Limits = { ...DEFAULT_LIMITS, ...options.limits };
  if (calls.length > limits.maxOpsPerBatch) {
    throw new EngineError('limit_exceeded', `${calls.length} ops in one batch; the limit is ${limits.maxOpsPerBatch}`, 'Split the work into several smaller batches.');
  }
  const names = calls.map((c) => (isRecord(c) && typeof c.op === 'string' ? c.op : '?'));
  const parsed = calls.map((c) => parseCall(registry, c));
  const failed = (p: Parsed | ErrorInfo): p is ErrorInfo => 'code' in p;
  const unchanged = (results: OpOutcome[]): BatchResult => ({ ok: false, committed: false, doc, results, lastCreated: options.lastCreated });

  if (parsed.some(failed)) {
    return unchanged(parsed.map((p, i): OpOutcome => (failed(p) ? { op: names[i]!, status: 'error', error: p } : { op: names[i]!, status: 'skipped' })));
  }

  let current = doc;
  let last = options.lastCreated;
  const done: Done[] = [];
  for (const [i, p] of (parsed as Parsed[]).entries()) {
    const ctx = new Context(current, last, limits);
    try {
      const result = p.def.handler(p.input, ctx);
      const count = Object.keys(ctx.doc.nodes).length;
      if (count > limits.maxNodes) {
        throw new EngineError(
          'limit_exceeded',
          `the document would hold ${count} nodes; the limit is ${limits.maxNodes}`,
          'Delete or merge nodes (for example with a boolean union) before adding more.',
        );
      }
      current = ctx.doc;
      last = ctx.last;
      done.push({
        op: names[i]!,
        ...(result.id === undefined ? {} : { id: result.id, bounds: worldBounds(current, result.id) }),
        ...(result.ids === undefined ? {} : { ids: result.ids }),
        warnings: ctx.warnings,
      });
    } catch (e) {
      const error: ErrorInfo =
        e instanceof EngineError
          ? e.info
          : { code: 'internal_error', message: e instanceof Error ? e.message : String(e), hint: 'This is an engine bug, not a mistake in the call. Try a simpler op.' };
      return unchanged([
        ...done.map((o): OpOutcome => ({ ...o, status: 'rolled_back' })),
        { op: names[i]!, status: 'error', error },
        ...names.slice(i + 1).map((op): OpOutcome => ({ op, status: 'skipped' })),
      ]);
    }
  }
  return {
    ok: true,
    committed: !options.dryRun,
    doc: options.dryRun ? doc : current,
    results: done.map((o): OpOutcome => ({ ...o, status: 'ok' })),
    lastCreated: options.dryRun ? options.lastCreated : last,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run packages/engine/test/ops/registry.test.ts`
Expected: PASS (13 tests). Note: `toEqual` for the first test lists the keys `op, status, id, bounds, warnings`; key order does not matter to `toEqual`.

- [ ] **Step 5: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/ops/registry.ts packages/engine/test/ops/registry.test.ts
git commit -m "feat(ops): op registry and all-or-nothing batch executor" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `ops/shapes.ts` (rect, ellipse, polygon, line)

**Files:**
- Create: `packages/engine/src/ops/shapes.ts`
- Test: `packages/engine/test/ops/shapes.test.ts`

**Interfaces:**
- Consumes:
  - `ellipse` (as `ellipsePath`), `polyline`, `roundCorners` from `geometry/paths.ts`
  - `cosSinDeg`, `IDENTITY` from `geometry/transform.ts`
  - `StyleSchema`, `PathNode`, `Style` from `model.ts`
  - `insertNode`
  - `defineOp`, `Length`, `OpContext` from `registry.ts`
- Produces: op definitions `rect`, `ellipse`, `polygon`, `line`. Each accepts `id?`, `parent?` and `style?`, plus:
  - rect: `x, y, width, height, radius?`
  - ellipse: `cx, cy, rx, ry?`
  - polygon: `cx, cy, radius, sides, rotation?`
  - line: `x1, y1, x2, y2`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/ops/shapes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { polyline } from '../../src/geometry/paths.ts';
import type { Box } from '../../src/geometry/types.ts';
import { executeBatch, Registry, type BatchResult } from '../../src/ops/registry.ts';
import { ellipse, line, polygon, rect } from '../../src/ops/shapes.ts';
import { createDocument, type Doc, type GroupNode, type PathNode } from '../../src/scene/model.ts';
import { docOf, expectIntact, groupNode } from '../fixtures.ts';

const registry = new Registry().register(rect, ellipse, polygon, line);
function run(ops: unknown[], doc: Doc = createDocument({ width: 800, height: 600 })): BatchResult {
  const r = executeBatch(registry, doc, ops);
  expectIntact(r.doc);
  return r;
}
const pathOf = (r: BatchResult, id: string) => r.doc.nodes[id] as PathNode;

describe('ops/shapes', () => {
  it('rect: exact bounds, one closed path, provenance in meta.source', () => {
    const r = run([{ op: 'rect', id: 'card', x: 10, y: 20, width: 30, height: 40, style: { fill: 'teal' } }]);
    expect(r.results[0]).toMatchObject({ status: 'ok', id: 'card', bounds: { x: 10, y: 20, width: 30, height: 40 } });
    const n = pathOf(r, 'card');
    expect(n.subpaths).toEqual([polyline([[10, 20], [40, 20], [40, 60], [10, 60]], true)]);
    expect(n.style).toEqual({ fill: 'teal' });
    expect(n.meta?.source).toEqual({ kind: 'rect', x: 10, y: 20, width: 30, height: 40, radius: 0 });
  });

  it('rect: percent sizes, and a clamped corner radius with a warning', () => {
    const r = run([{ op: 'rect', id: 'bg', x: 0, y: 0, width: '100%', height: '50%', radius: 400 }]);
    expect(r.results[0]).toMatchObject({ bounds: { x: 0, y: 0, width: 800, height: 300 }, warnings: [{ code: 'radius_clamped' }] });
    expect(pathOf(r, 'bg').subpaths[0]!.segs).toHaveLength(4);
  });

  it('rect: rejects a non-positive size or a negative radius with a hint', () => {
    expect(run([{ op: 'rect', x: 0, y: 0, width: 0, height: 10 }]).results[0]).toMatchObject({ status: 'error', error: { code: 'invalid_input' } });
    expect(run([{ op: 'rect', x: 0, y: 0, width: 5, height: 10, radius: -1 }]).results[0]).toMatchObject({ error: { code: 'invalid_input' } });
  });

  it('ellipse: a circle by default, exact bounds', () => {
    const r = run([
      { op: 'ellipse', id: 'sun', cx: 100, cy: 100, rx: 50 },
      { op: 'ellipse', id: 'egg', cx: 0, cy: 0, rx: 10, ry: 20 },
    ]);
    expect(r.results[0]).toMatchObject({ bounds: { x: 50, y: 50, width: 100, height: 100 } });
    expect(r.results[1]).toMatchObject({ bounds: { x: -10, y: -20, width: 20, height: 40 } });
  });

  it('polygon: first vertex at the top, exact at multiples of 90°', () => {
    const r = run([{ op: 'polygon', id: 'diamond', cx: 50, cy: 50, radius: 10, sides: 4 }]);
    expect(pathOf(r, 'diamond').subpaths).toEqual([polyline([[50, 40], [60, 50], [50, 60], [40, 50]], true)]);
    const tri = run([{ op: 'polygon', id: 't', cx: 0, cy: 0, radius: 10, sides: 3, rotation: 180 }]);
    const b = (tri.results[0] as { bounds: Box }).bounds;
    expect(b.y + b.height).toBeCloseTo(10, 9); // turned 180°, the apex points down
    expect(b.y).toBeCloseTo(-5, 9);
  });

  it('line: an open path with a default black stroke; equal end points are an error', () => {
    const r = run([{ op: 'line', id: 'l', x1: 0, y1: 0, x2: 10, y2: 10 }]);
    expect(pathOf(r, 'l').subpaths).toEqual([polyline([[0, 0], [10, 10]], false)]);
    expect(pathOf(r, 'l').style).toEqual({ stroke: '#000000' });
    expect(run([{ op: 'line', x1: 5, y1: 5, x2: 5, y2: 5 }]).results[0]).toMatchObject({ error: { code: 'invalid_input' } });
  });

  it('shapes go into a parent group, which must be a group', () => {
    const r = run([{ op: 'rect', id: 'r', x: 0, y: 0, width: 5, height: 5, parent: 'g' }], docOf([groupNode('g', [])]));
    expect((r.doc.nodes.g as GroupNode).children).toEqual(['r']);
    expect(r.doc.nodes.r!.parent).toBe('g');
    const bad = run([{ op: 'rect', id: 'a', x: 0, y: 0, width: 5, height: 5 }, { op: 'rect', x: 0, y: 0, width: 5, height: 5, parent: 'a' }]);
    expect(bad.results[1]).toMatchObject({ error: { code: 'invalid_structure' } });
  });

  it('every shape example runs on an empty canvas', () => {
    for (const def of registry.list()) {
      for (const example of def.examples) {
        expect(executeBatch(registry, createDocument({ width: 800, height: 600 }), example).ok).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run packages/engine/test/ops/shapes.test.ts`
Expected: FAIL. `Cannot find module '../../src/ops/shapes.ts'`.

- [ ] **Step 3: Write `ops/shapes.ts`**

`packages/engine/src/ops/shapes.ts`:

```ts
import { z } from 'zod';
import { EngineError } from '../errors.ts';
import { ellipse as ellipsePath, polyline, roundCorners } from '../geometry/paths.ts';
import { cosSinDeg, IDENTITY } from '../geometry/transform.ts';
import type { Subpath, Vec2 } from '../geometry/types.ts';
import { StyleSchema, type PathNode, type Style } from '../scene/model.ts';
import { insertNode } from '../scene/store.ts';
import { defineOp, Length, type OpContext } from './registry.ts';

const common = { id: z.string().optional(), parent: z.string().optional(), style: StyleSchema.optional() };
type Common = { readonly id?: string; readonly parent?: string; readonly style?: Style };

function positive(op: string, name: string, v: number): number {
  if (!(v > 0)) {
    throw new EngineError('invalid_input', `${op} ${name} must be > 0, got ${v}`, `Give ${name} a positive size in canvas units or a percent such as "10%".`);
  }
  return v;
}

/** Inserts a new path node (on top of its parent or the canvas) and returns its id. */
function addPath(ctx: OpContext, input: Common, prefix: string, subpaths: Subpath[], source: Record<string, unknown>, defaults: Style = {}): string {
  const parent = input.parent === undefined ? null : ctx.node(input.parent);
  if (parent && parent.type !== 'group') {
    throw new EngineError('invalid_structure', `parent "${parent.id}" is a ${parent.type}, not a group`, 'Pass a group id as parent, or leave parent out.');
  }
  const segs = subpaths.reduce((n, sp) => n + sp.segs.length, 0);
  if (segs > ctx.limits.maxSegmentsPerPath) {
    throw new EngineError('limit_exceeded', `${segs} segments in one path; the limit is ${ctx.limits.maxSegmentsPerPath}`, 'Use fewer points or sides.');
  }
  const style = ctx.style({ ...defaults, ...input.style });
  const id = ctx.newId(input.id, prefix);
  const node: PathNode = { id, type: 'path', parent: parent?.id ?? null, transform: IDENTITY, style, fillRule: 'nonzero', subpaths, meta: { source } };
  ctx.update((d) => insertNode(d, node));
  return id;
}

export const rect = defineOp({
  name: 'rect',
  domain: 'shapes',
  description: 'Rectangle from its top-left corner (x, y), width and height, with optional rounded corners (radius, clamped to half the shorter side).',
  schema: z.strictObject({ ...common, x: Length, y: Length, width: Length, height: Length, radius: Length.optional() }),
  examples: [
    [{ op: 'rect', id: 'sky', x: 0, y: 0, width: '100%', height: '60%', style: { fill: '#8ecae6' } }],
    [{ op: 'rect', id: 'card', x: 100, y: 100, width: 200, height: 120, radius: 16, style: { fill: '#ffffff', stroke: '#264653', strokeWidth: 2 } }],
  ],
  handler(input, ctx) {
    const x = ctx.len(input.x, 'x'), y = ctx.len(input.y, 'y');
    const w = positive('rect', 'width', ctx.len(input.width, 'x'));
    const h = positive('rect', 'height', ctx.len(input.height, 'y'));
    const r = input.radius === undefined ? 0 : ctx.len(input.radius, 'min');
    if (r < 0) throw new EngineError('invalid_input', `rect radius must be ≥ 0, got ${r}`, 'Use 0 for sharp corners or a positive radius.');
    let sp = polyline([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);
    if (r > 0) {
      const rounded = roundCorners(sp, r);
      if (rounded.clamped > 0) ctx.warn('radius_clamped', `radius ${r} is more than half the shorter side; used ${Math.min(w, h) / 2}`);
      sp = rounded.subpath;
    }
    return { id: addPath(ctx, input, 'rect', [sp], { kind: 'rect', x, y, width: w, height: h, radius: r }) };
  },
});

export const ellipse = defineOp({
  name: 'ellipse',
  domain: 'shapes',
  description: 'Ellipse or circle from its center (cx, cy) and radii; ry defaults to rx, which makes a circle.',
  schema: z.strictObject({ ...common, cx: Length, cy: Length, rx: Length, ry: Length.optional() }),
  examples: [[{ op: 'ellipse', id: 'sun', cx: '75%', cy: '20%', rx: 60, style: { fill: '#ffb703' } }]],
  handler(input, ctx) {
    const cx = ctx.len(input.cx, 'x'), cy = ctx.len(input.cy, 'y');
    const rx = positive('ellipse', 'rx', ctx.len(input.rx, 'x'));
    const ry = input.ry === undefined ? rx : positive('ellipse', 'ry', ctx.len(input.ry, 'y'));
    return { id: addPath(ctx, input, 'ellipse', [ellipsePath(cx, cy, rx, ry)], { kind: 'ellipse', cx, cy, rx, ry }) };
  },
});

export const polygon = defineOp({
  name: 'polygon',
  domain: 'shapes',
  description: 'Regular polygon with `sides` corners on a circle of `radius` around (cx, cy). The first corner points up; rotation turns it clockwise in degrees.',
  schema: z.strictObject({ ...common, cx: Length, cy: Length, radius: Length, sides: z.number().int().min(3).max(1000), rotation: z.number().optional() }),
  examples: [[{ op: 'polygon', id: 'hex', cx: 400, cy: 300, radius: 80, sides: 6, style: { fill: '#2a9d8f' } }]],
  handler(input, ctx) {
    const cx = ctx.len(input.cx, 'x'), cy = ctx.len(input.cy, 'y');
    const r = positive('polygon', 'radius', ctx.len(input.radius, 'min'));
    const rotation = input.rotation ?? 0;
    const pts = Array.from({ length: input.sides }, (_, k): Vec2 => {
      const [c, s] = cosSinDeg(rotation - 90 + (360 * k) / input.sides);
      return [cx + r * c, cy + r * s];
    });
    return { id: addPath(ctx, input, 'polygon', [polyline(pts, true)], { kind: 'polygon', cx, cy, radius: r, sides: input.sides, rotation }) };
  },
});

export const line = defineOp({
  name: 'line',
  domain: 'shapes',
  description: 'Straight line from (x1, y1) to (x2, y2). Stroke defaults to black, since a line has no fill area.',
  schema: z.strictObject({ ...common, x1: Length, y1: Length, x2: Length, y2: Length }),
  examples: [[{ op: 'line', id: 'horizon', x1: 0, y1: '60%', x2: '100%', y2: '60%', style: { stroke: '#264653', strokeWidth: 3 } }]],
  handler(input, ctx) {
    const a: Vec2 = [ctx.len(input.x1, 'x'), ctx.len(input.y1, 'y')];
    const b: Vec2 = [ctx.len(input.x2, 'x'), ctx.len(input.y2, 'y')];
    if (a[0] === b[0] && a[1] === b[1]) {
      throw new EngineError('invalid_input', 'line end points are the same point', 'Give the line two different end points.');
    }
    return { id: addPath(ctx, input, 'line', [polyline([a, b], false)], { kind: 'line', x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, { stroke: '#000000' }) };
  },
});
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run packages/engine/test/ops/shapes.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/ops/shapes.ts packages/engine/test/ops/shapes.test.ts
git commit -m "feat(ops): rect, ellipse, polygon and line" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `style`, `group`, `delete`, and `createRegistry`

**Files:**
- Create: `packages/engine/src/ops/style.ts`, `packages/engine/src/ops/structure.ts`, `packages/engine/src/ops/index.ts`
- Test: `packages/engine/test/ops/structure.test.ts`

**Interfaces:**
- Consumes:
  - `StyleSchema`, `Style`, `GroupNode`
  - `siblings`
  - `detach`, `insertNode`, `removeSubtree`
  - `defineOp`, `Registry`
  - shape ops
- Produces:
  - op `style { ids, style?, unset? }`
  - op `group { id?, ids }`
  - op `delete { ids }` (exported as `remove`)
  - `createRegistry(): Registry` with all seven ops, in the order rect, ellipse, polygon, line, style, group, delete

- [ ] **Step 1: Write the failing test**

`packages/engine/test/ops/structure.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/ops/index.ts';
import { executeBatch, type BatchResult } from '../../src/ops/registry.ts';
import { createDocument, type Doc, type GroupNode } from '../../src/scene/model.ts';
import { worldBounds } from '../../src/scene/query.ts';
import { expectIntact } from '../fixtures.ts';

const registry = createRegistry();
function run(ops: unknown[], doc: Doc = createDocument({ width: 800, height: 600 })): BatchResult {
  const r = executeBatch(registry, doc, ops);
  expectIntact(r.doc);
  return r;
}
const four = ['a', 'b', 'c', 'd'].map((id, i) => ({ op: 'rect', id, x: i * 20, y: 0, width: 10, height: 10 }));

describe('ops/style', () => {
  it('merges into the current style, unsets keys, and accepts $last', () => {
    const r = run([
      { op: 'rect', id: 'a', x: 0, y: 0, width: 10, height: 10, style: { fill: 'red', stroke: 'blue' } },
      { op: 'style', ids: ['a'], style: { fill: 'teal', strokeWidth: 2 }, unset: ['stroke'] },
      { op: 'rect', id: 'b', x: 0, y: 0, width: 10, height: 10 },
      { op: 'style', ids: ['$last'], style: { opacity: 0.5 } },
    ]);
    expect(r.doc.nodes.a!.style).toEqual({ fill: 'teal', strokeWidth: 2 });
    expect(r.doc.nodes.b!.style).toEqual({ opacity: 0.5 });
    expect(r.results[1]).toMatchObject({ status: 'ok', ids: ['a'] });
  });

  it('rejects unknown style keys and unknown colors', () => {
    expect(run([...four, { op: 'style', ids: ['a'], style: { color: 'red' } }]).results[4]).toMatchObject({ error: { code: 'invalid_input' } });
    expect(run([...four, { op: 'style', ids: ['a'], style: { fill: 'blurple' } }]).results[4]).toMatchObject({ error: { code: 'invalid_color' } });
  });
});

describe('ops/group', () => {
  it("group wraps siblings at the topmost member's z position, keeping their order", () => {
    const r = run([...four, { op: 'group', id: 'pair', ids: ['d', 'b'] }]);
    expect(r.doc.root).toEqual(['a', 'c', 'pair']);
    expect((r.doc.nodes.pair as GroupNode).children).toEqual(['b', 'd']);
    expect(r.doc.nodes.b!.parent).toBe('pair');
    expect(r.results[4]).toMatchObject({ id: 'pair', bounds: { x: 20, y: 0, width: 50, height: 10 } });
    const low = run([...four, { op: 'group', id: 'low', ids: ['a', 'c'] }]);
    expect(low.doc.root).toEqual(['b', 'low', 'd']);
  });

  it('keeps world placement, so member bounds do not move', () => {
    const before = run(four).doc;
    const after = run([{ op: 'group', ids: ['b', 'c'] }], before).doc;
    expect(worldBounds(after, 'b')).toEqual(worldBounds(before, 'b'));
  });

  it('rejects members with different parents', () => {
    const r = run([...four, { op: 'group', id: 'g', ids: ['a'] }, { op: 'group', ids: ['a', 'b'] }]);
    expect(r.results[5]).toMatchObject({ error: { code: 'invalid_structure' } });
  });
});

describe('ops/delete', () => {
  it('removes nodes with their descendants', () => {
    const r = run([...four, { op: 'group', id: 'pair', ids: ['a', 'b'] }, { op: 'delete', ids: ['pair', 'c'] }]);
    expect(r.results[5]).toMatchObject({ ids: ['pair', 'a', 'b', 'c'] });
    expect(r.doc.root).toEqual(['d']);
    expect(Object.keys(r.doc.nodes)).toEqual(['d']);
  });

  it('tolerates a node already deleted along with its group', () => {
    const r = run([...four, { op: 'group', id: 'pair', ids: ['a', 'b'] }, { op: 'delete', ids: ['pair', 'a'] }]);
    expect(r.results[5]).toMatchObject({ status: 'ok', ids: ['pair', 'a', 'b'] });
  });
});

describe('ops: createRegistry', () => {
  it('registers the seven M2 ops, and every example runs and ends with its op', () => {
    expect(registry.names()).toEqual(['rect', 'ellipse', 'polygon', 'line', 'style', 'group', 'delete']);
    for (const def of registry.list()) {
      expect(def.examples.length).toBeGreaterThan(0);
      for (const example of def.examples) {
        expect(example.at(-1)?.op).toBe(def.name);
        expect(executeBatch(registry, createDocument({ width: 800, height: 600 }), example).ok).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run packages/engine/test/ops/structure.test.ts`
Expected: FAIL. `Cannot find module '../../src/ops/index.ts'`.

- [ ] **Step 3: Write `ops/style.ts`**

`packages/engine/src/ops/style.ts`:

```ts
import { castDraft } from 'immer';
import { z } from 'zod';
import { StyleSchema, type Style } from '../scene/model.ts';
import { defineOp } from './registry.ts';

export const style = defineOp({
  name: 'style',
  domain: 'style',
  description: 'Sets style properties on nodes, merging into their current style, and removes the properties listed in unset.',
  schema: z.strictObject({ ids: z.array(z.string()).min(1).max(1000), style: StyleSchema.optional(), unset: z.array(StyleSchema.keyof()).optional() }),
  examples: [
    [
      { op: 'rect', id: 'box', x: 10, y: 10, width: 50, height: 50 },
      { op: 'style', ids: ['$last'], style: { fill: '#e76f51', stroke: '#264653', strokeWidth: 3 } },
    ],
  ],
  handler(input, ctx) {
    const ids = [...new Set(input.ids.map((ref) => ctx.node(ref).id))];
    const patch = ctx.style(input.style);
    if (Object.keys(patch).length === 0 && !input.unset?.length) ctx.warn('no_change', 'style was given nothing to set or unset');
    ctx.update((d) => {
      for (const id of ids) {
        const next: Record<string, unknown> = { ...d.nodes[id]!.style, ...patch };
        for (const key of input.unset ?? []) delete next[key];
        d.nodes[id]!.style = castDraft(next as Style);
      }
    });
    return { ids };
  },
});
```

- [ ] **Step 4: Write `ops/structure.ts`**

`packages/engine/src/ops/structure.ts`:

```ts
import { z } from 'zod';
import { EngineError } from '../errors.ts';
import { IDENTITY } from '../geometry/transform.ts';
import { siblings } from '../scene/query.ts';
import { detach, insertNode, removeSubtree } from '../scene/store.ts';
import { defineOp } from './registry.ts';

export const group = defineOp({
  name: 'group',
  domain: 'structure',
  description: 'Wraps sibling nodes in a new group placed where the topmost member was. Members keep their order and their look.',
  schema: z.strictObject({ id: z.string().optional(), ids: z.array(z.string()).min(1).max(1000) }),
  examples: [
    [
      { op: 'rect', id: 'body', x: 300, y: 250, width: 200, height: 100 },
      { op: 'ellipse', id: 'wheel', cx: 340, cy: 360, rx: 25 },
      { op: 'group', id: 'cart', ids: ['body', 'wheel'] },
    ],
  ],
  handler(input, ctx) {
    const members = [...new Map(input.ids.map((ref) => [ctx.node(ref).id, ctx.node(ref)] as const)).values()];
    const first = members[0]!;
    if (members.some((m) => m.parent !== first.parent)) {
      throw new EngineError('invalid_structure', 'group members must share one parent', 'Group nodes that sit side by side in the same group, or all at the top level.');
    }
    const list = siblings(ctx.doc, first);
    const ordered = members.map((m) => m.id).sort((a, b) => list.indexOf(a) - list.indexOf(b));
    // After the members are taken out, this is where the topmost one was.
    const at = list.indexOf(ordered.at(-1)!) - (ordered.length - 1);
    const id = ctx.newId(input.id, 'group');
    ctx.update((d) => {
      for (const m of ordered) {
        detach(d, m);
        d.nodes[m]!.parent = id;
      }
      insertNode(d, { id, type: 'group', parent: first.parent, transform: IDENTITY, style: {}, children: ordered }, at);
    });
    return { id };
  },
});

export const remove = defineOp({
  name: 'delete',
  domain: 'structure',
  description: 'Deletes nodes. Deleting a group deletes everything inside it.',
  schema: z.strictObject({ ids: z.array(z.string()).min(1).max(1000) }),
  examples: [
    [
      { op: 'rect', id: 'draft', x: 10, y: 10, width: 50, height: 50 },
      { op: 'delete', ids: ['draft'] },
    ],
  ],
  handler(input, ctx) {
    const targets = input.ids.map((ref) => ctx.node(ref).id);
    const removed: string[] = [];
    ctx.update((d) => {
      for (const id of targets) if (Object.hasOwn(d.nodes, id)) removed.push(...removeSubtree(d, id));
    });
    return { ids: removed };
  },
});
```

- [ ] **Step 5: Write `ops/index.ts`**

`packages/engine/src/ops/index.ts`:

```ts
import { Registry } from './registry.ts';
import { ellipse, line, polygon, rect } from './shapes.ts';
import { group, remove } from './structure.ts';
import { style } from './style.ts';

/** A registry holding every built-in op. */
export function createRegistry(): Registry {
  return new Registry().register(rect, ellipse, polygon, line, style, group, remove);
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `pnpm exec vitest run packages/engine/test/ops/structure.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 7: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/engine/src/ops/style.ts packages/engine/src/ops/structure.ts packages/engine/src/ops/index.ts packages/engine/test/ops/structure.test.ts
git commit -m "feat(ops): style, group and delete; built-in registry" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `render/svg.ts`

**Files:**
- Create: `packages/engine/src/render/svg.ts`
- Test: `packages/engine/test/render/svg.test.ts`

**Interfaces:**
- Consumes:
  - `isStraight` from `bezier.ts`
  - `IDENTITY`
  - `resolvePaint`
  - model types
  - `createRegistry`, `executeBatch` (tests)
- Produces:
  - `type SvgOptions = { readonly precision?: number }`
  - `toSvg(doc: Doc, options?: SvgOptions): string`. The precision defaults to 3 decimals for coordinates; the linear part of a matrix uses precision + 3.

- [ ] **Step 1: Write the failing test**

`packages/engine/test/render/svg.test.ts`:

```ts
import { castDraft, produce, type Draft } from 'immer';
import { describe, expect, it } from 'vitest';
import { translate } from '../../src/geometry/transform.ts';
import { createRegistry } from '../../src/ops/index.ts';
import { executeBatch } from '../../src/ops/registry.ts';
import { toSvg } from '../../src/render/svg.ts';
import { createDocument, type Doc, type PathNode } from '../../src/scene/model.ts';
import { docOf, pathNode } from '../fixtures.ts';

const registry = createRegistry();
const blank = () => createDocument({ width: 100, height: 50 });
function draw(ops: unknown[], doc: Doc = blank()): Doc {
  const r = executeBatch(registry, doc, ops);
  expect(r.ok).toBe(true);
  return r.doc;
}
const HEAD = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">';

describe('render/svg', () => {
  it('an empty document is the svg element alone, plus an optional background', () => {
    expect(toSvg(blank())).toBe(`${HEAD}</svg>`);
    expect(toSvg(createDocument({ width: 100, height: 50, background: '#fff' }))).toBe(`${HEAD}<rect width="100" height="50" fill="#ffffff"/></svg>`);
  });

  it('straight segments become L and the closing segment becomes Z', () => {
    const doc = draw([{ op: 'rect', id: 'box', x: 10, y: 10, width: 30, height: 20, style: { fill: 'teal' } }]);
    expect(toSvg(doc)).toBe(`${HEAD}<path id="box" d="M10 10 L40 10 L40 30 L10 30 Z" fill="#008080"/></svg>`);
  });

  it('curves become C, with numbers rounded to the precision', () => {
    const doc = draw([{ op: 'ellipse', id: 'dot', cx: 50, cy: 25, rx: 10 }]);
    expect(toSvg(doc)).toBe(
      `${HEAD}<path id="dot" d="M60 25 C60 30.523 55.523 35 50 35 C44.477 35 40 30.523 40 25 C40 19.477 44.477 15 50 15 C55.523 15 60 19.477 60 25 Z"/></svg>`,
    );
    expect(toSvg(doc, { precision: 1 })).toContain('C60 30.5 55.5 35 50 35');
  });

  it('groups nest, transforms print as matrix(), style attributes come in a fixed order', () => {
    const doc = draw([
      { op: 'line', id: 'l', x1: 0, y1: 0, x2: 10, y2: 10, style: { opacity: 0.5, strokeDash: [4, 2], strokeCap: 'round', strokeWidth: 2 } },
      { op: 'group', id: 'g', ids: ['l'] },
    ]);
    const moved = produce(doc, (d) => {
      d.nodes.g!.transform = castDraft(translate(5, 5));
    });
    expect(toSvg(moved)).toBe(
      `${HEAD}<g id="g" transform="matrix(1 0 0 1 5 5)"><path id="l" d="M0 0 L10 10" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-dasharray="4 2" opacity="0.5"/></g></svg>`,
    );
  });

  it('resolves tokens, keeps translucency, writes evenodd', () => {
    const doc: Doc = { ...blank(), tokens: { 'palette.primary': '#E76F51' } };
    const drawn = draw([{ op: 'rect', id: 'a', x: 0, y: 0, width: 10, height: 10, style: { fill: 'palette.primary', stroke: 'rgb(0 0 0 / 25%)' } }], doc);
    const odd = produce(drawn, (d) => {
      (d.nodes.a as Draft<PathNode>).fillRule = 'evenodd';
    });
    expect(toSvg(odd)).toBe(`${HEAD}<path id="a" d="M0 0 L10 0 L10 10 L0 10 Z" fill-rule="evenodd" fill="#e76f51" stroke="rgba(0, 0, 0, 0.25)"/></svg>`);
  });

  it('prints negative zero as 0 and leaves out paints that no longer resolve', () => {
    const doc = docOf([pathNode('p', [{ start: [-0.0001, 0], segs: [[5, 0, 5, 0, 5, 0]], closed: false }], { style: { fill: 'palette.gone' } })]);
    expect(toSvg(doc)).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><path id="p" d="M0 0 L5 0"/></svg>');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run packages/engine/test/render/svg.test.ts`
Expected: FAIL. `Cannot find module '../../src/render/svg.ts'`.

- [ ] **Step 3: Write `render/svg.ts`**

`packages/engine/src/render/svg.ts`:

```ts
import { isStraight } from '../geometry/bezier.ts';
import { IDENTITY } from '../geometry/transform.ts';
import type { Mat6, Subpath } from '../geometry/types.ts';
import { resolvePaint } from '../scene/color.ts';
import type { Doc, Style } from '../scene/model.ts';

export type SvgOptions = { readonly precision?: number };

type Fmt = (v: number) => string;

function formatter(precision: number): Fmt {
  return (v) => {
    const r = Number(v.toFixed(precision));
    return Object.is(r, -0) ? '0' : String(r);
  };
}

/**
 * Scene → SVG string. Tokens resolve to colors, and the output depends only on the document, so
 * equal documents give equal strings (NFR-4). `precision` is the number of decimals for
 * coordinates (default 3); matrix scale and rotation terms keep 3 more.
 */
export function toSvg(doc: Doc, options: SvgOptions = {}): string {
  const precision = options.precision ?? 3;
  const n = formatter(precision);
  const fine = formatter(precision + 3);
  const { width, height, background } = doc.canvas;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${n(height)}" viewBox="0 0 ${n(width)} ${n(height)}">`];
  const bg = background === undefined ? undefined : resolvePaint(doc, background);
  if (bg !== undefined && bg !== 'none') parts.push(`<rect width="${n(width)}" height="${n(height)}" fill="${bg}"/>`);
  for (const id of doc.root) parts.push(element(doc, id, n, fine));
  parts.push('</svg>');
  return parts.join('');
}

function element(doc: Doc, id: string, n: Fmt, fine: Fmt): string {
  const node = doc.nodes[id]!;
  const attrs = [`id="${node.id}"`];
  if (node.type === 'path') {
    attrs.push(`d="${pathData(node.subpaths, n)}"`);
    if (node.fillRule === 'evenodd') attrs.push('fill-rule="evenodd"');
  }
  if (!isIdentity(node.transform)) {
    const [a, b, c, d, e, f] = node.transform;
    attrs.push(`transform="matrix(${[a, b, c, d].map(fine).join(' ')} ${n(e)} ${n(f)})"`);
  }
  attrs.push(...styleAttrs(doc, node.style, n));
  if (node.type === 'path') return `<path ${attrs.join(' ')}/>`;
  const children = node.children.map((child) => element(doc, child, n, fine)).join('');
  return children === '' ? `<g ${attrs.join(' ')}/>` : `<g ${attrs.join(' ')}>${children}</g>`;
}

const isIdentity = (m: Mat6) => m === IDENTITY || m.every((v, i) => v === IDENTITY[i]);

/** M/L/C/Z path data. Straight segments print as L; a straight closing segment is left to Z. */
function pathData(subpaths: readonly Subpath[], n: Fmt): string {
  const out: string[] = [];
  for (const sp of subpaths) {
    if (sp.segs.length === 0) continue;
    out.push(`M${n(sp.start[0])} ${n(sp.start[1])}`);
    let [px, py] = sp.start;
    sp.segs.forEach(([c1x, c1y, c2x, c2y, x, y], i) => {
      const straight = isStraight([px, py, c1x, c1y, c2x, c2y, x, y]);
      const closing = sp.closed && i === sp.segs.length - 1 && x === sp.start[0] && y === sp.start[1];
      if (!(straight && closing)) out.push(straight ? `L${n(x)} ${n(y)}` : `C${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(x)} ${n(y)}`);
      px = x;
      py = y;
    });
    if (sp.closed) out.push('Z');
  }
  return out.join(' ');
}

/** Presentation attributes in a fixed order. Paints that do not resolve are left out. */
function styleAttrs(doc: Doc, s: Style, n: Fmt): string[] {
  const out: string[] = [];
  const paint = (name: string, value: string | undefined) => {
    if (value === undefined) return;
    const color = resolvePaint(doc, value);
    if (color !== undefined) out.push(`${name}="${color}"`);
  };
  paint('fill', s.fill);
  if (s.fillOpacity !== undefined) out.push(`fill-opacity="${n(s.fillOpacity)}"`);
  paint('stroke', s.stroke);
  if (s.strokeWidth !== undefined) out.push(`stroke-width="${n(s.strokeWidth)}"`);
  if (s.strokeCap !== undefined) out.push(`stroke-linecap="${s.strokeCap}"`);
  if (s.strokeJoin !== undefined) out.push(`stroke-linejoin="${s.strokeJoin}"`);
  if (s.strokeDash !== undefined && s.strokeDash.length > 0) out.push(`stroke-dasharray="${s.strokeDash.map(n).join(' ')}"`);
  if (s.miterLimit !== undefined) out.push(`stroke-miterlimit="${n(s.miterLimit)}"`);
  if (s.strokeOpacity !== undefined) out.push(`stroke-opacity="${n(s.strokeOpacity)}"`);
  if (s.opacity !== undefined) out.push(`opacity="${n(s.opacity)}"`);
  return out;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run packages/engine/test/render/svg.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/render/svg.ts packages/engine/test/render/svg.test.ts
git commit -m "feat(render): deterministic scene-to-SVG serializer" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Public API, M2 acceptance, server dependencies, docs

**Files:**
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/test/acceptance.test.ts`
- Modify: `packages/mcp-server/package.json` (dependencies)
- Modify: `docs/superpowers/specs/2026-10-07-agent-illustrator-v1-design.md`, `docs/superpowers/plans/2026-10-07-v1-roadmap.md`

**Interfaces:**
- Consumes: everything above.
- Produces, as the engine's public API (M3 imports only from `@agent-illustrator/engine`):
  - `ENGINE_VERSION`
  - `EngineError`, `ErrorCode`, `ErrorInfo`
  - geometry types
  - `createDocument`, `validateDocument`, `integrityProblem` and the model types
  - `worldBounds`, `worldTransform`
  - `DocumentStore`
  - `Registry`, `defineOp`, `executeBatch`, `DEFAULT_LIMITS` and the batch types
  - `createRegistry`
  - `toSvg`, `SvgOptions`

- [ ] **Step 1: Write the failing acceptance test**

`packages/engine/test/acceptance.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createDocument, createRegistry, executeBatch, integrityProblem, toSvg, validateDocument } from '../src/index.ts';

const registry = createRegistry();
const SCENE = [
  { op: 'rect', id: 'sky', x: 0, y: 0, width: '100%', height: '60%', style: { fill: '#8ecae6' } },
  { op: 'rect', id: 'ground', x: 0, y: '60%', width: '100%', height: '40%', style: { fill: '#2a9d8f' } },
  { op: 'ellipse', id: 'sun', cx: '75%', cy: '20%', rx: 50, style: { fill: '#ffb703' } },
  { op: 'polygon', id: 'roof', cx: 200, cy: 280, radius: 60, sides: 3, style: { fill: '#e76f51' } },
  { op: 'rect', id: 'house', x: 150, y: 300, width: 100, height: 80, radius: 4, style: { fill: '#f4f1de' } },
  { op: 'line', id: 'path', x1: 200, y1: 380, x2: 260, y2: 600, style: { stroke: '#264653', strokeWidth: 4, strokeCap: 'round' } },
  { op: 'group', id: 'home', ids: ['roof', 'house'] },
  { op: 'style', ids: ['sun'], style: { opacity: 0.9 } },
];
const fresh = () => createDocument({ width: 800, height: 600, background: 'white', seed: 42 });

describe('M2 acceptance', () => {
  it('a batch with a mid-batch failure rolls back fully', () => {
    const doc = fresh();
    const r = executeBatch(registry, doc, [...SCENE, { op: 'delete', ids: ['nothing'] }, { op: 'rect', x: 0, y: 0, width: 1, height: 1 }]);
    expect(r.ok).toBe(false);
    expect(r.doc).toBe(doc);
    expect(r.results.map((o) => o.status)).toEqual([...SCENE.map(() => 'rolled_back'), 'error', 'skipped']);
    expect(toSvg(r.doc)).toBe(toSvg(doc));
  });

  it('the same seed and ops give an identical document and SVG', () => {
    const a = executeBatch(registry, fresh(), SCENE);
    const b = executeBatch(registry, fresh(), SCENE);
    expect(a.ok && b.ok).toBe(true);
    expect(JSON.stringify(a.doc)).toBe(JSON.stringify(b.doc));
    expect(toSvg(a.doc)).toBe(toSvg(b.doc));
  });

  it('a committed scene keeps its tree intact and survives a JSON round trip', () => {
    const { doc } = executeBatch(registry, fresh(), SCENE);
    expect(integrityProblem(doc)).toBeNull();
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('matches the SVG snapshot', () => {
    expect(toSvg(executeBatch(registry, fresh(), SCENE).doc)).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run packages/engine/test/acceptance.test.ts`
Expected: FAIL. `createRegistry` (and the other names) are not exported from `../src/index.ts`, so you see `TypeError: … is not a function` or a missing-export `SyntaxError`.

- [ ] **Step 3: Write the public API**

`packages/engine/src/index.ts`:

```ts
import pkg from '../package.json' with { type: 'json' };

export const ENGINE_VERSION: string = pkg.version;

export { EngineError, type ErrorCode, type ErrorInfo } from './errors.ts';
export type { Box, FillRule, Mat6, Seg, Subpath, Vec2 } from './geometry/types.ts';
export {
  createDocument,
  integrityProblem,
  validateDocument,
  type Canvas,
  type CreateDocumentInput,
  type Doc,
  type GroupNode,
  type PathNode,
  type SceneNode,
  type Style,
} from './scene/model.ts';
export { worldBounds, worldTransform } from './scene/query.ts';
export { DocumentStore } from './scene/store.ts';
export {
  DEFAULT_LIMITS,
  defineOp,
  executeBatch,
  Registry,
  type BatchOptions,
  type BatchResult,
  type Limits,
  type OpCall,
  type OpDef,
  type OpOutcome,
  type Warning,
} from './ops/registry.ts';
export { createRegistry } from './ops/index.ts';
export { toSvg, type SvgOptions } from './render/svg.ts';
```

- [ ] **Step 4: Run it to verify it passes, then inspect the snapshot**

Run: `pnpm exec vitest run packages/engine/test/acceptance.test.ts`
Expected: PASS (4 tests). The run writes `packages/engine/test/__snapshots__/acceptance.test.ts.snap`. Read it and check four things before committing:
- the background rect is `#ffffff`
- the z-order is sky, ground, sun, path, then the `home` group
- `home` holds roof and house
- the sun carries `opacity="0.9"`

This is a check of facts already pinned by earlier tests, not a new assertion.

- [ ] **Step 5: Declare the engine's runtime dependencies in the published package**

tsdown bundles `@agent-illustrator/engine` and keeps the third-party packages in `dependencies` external (spec S4). In `packages/mcp-server/package.json`, add after `"scripts"`:

```json
  "dependencies": {
    "culori": "catalog:",
    "immer": "catalog:",
    "paper": "catalog:",
    "zod": "catalog:"
  },
```

Run: `pnpm install`
Expected: exit 0.

- [ ] **Step 6: Record the decisions in the spec and the roadmap**

In `docs/superpowers/specs/2026-10-07-agent-illustrator-v1-design.md`:
- Change the heading `## A3. Scene model (Proposed; confirm before the M2 plan)` to `## A3. Scene model (Adopted as the default with the M2 plan, 2026-10-08; owner may still object)`.
- Append to the end of the A3 section:

```
7. **Refinements in M2 (2026-10-08):**
   - World-transform caches are validated against the parent's world matrix, because an ancestor can change while a node object stays shared. Point 4 holds for per-node data only.
   - `defs` arrive with M5 (gradients, filters) and `text` with M8.
   - Ids also reject `canvas`, a leading `__`, and Object.prototype names.
   - Paints are CSS colors (via culori), `none`, or token names. SVG output always carries `#rrggbb` or `rgba()`.
```

- In the S5 row of the "Open suggestions" table, set the evidence column to `**Adopted** in the M2 plan (2026-10-08): merged variants; M2 ops unaffected`.

In `docs/superpowers/plans/2026-10-07-v1-roadmap.md`, set:

```
| M2 Scene, registry, transactions, SVG out | [`2026-10-08-m2-scene-registry-svg.md`](2026-10-08-m2-scene-registry-svg.md) | Done YYYY-MM-DD |
| M3 First end-to-end MCP slice | not yet written | Next |
```

Use the actual completion date.

- [ ] **Step 7: Full verification**

Run: `pnpm check && pnpm build && pnpm smoke`
Expected:
- Lint shows 0 problems, typecheck exits 0, and every test is green.
- The build succeeds, and smoke prints the version and `--doctor` OK.

Then search `packages/mcp-server/dist/cli.mjs` for `immer`, `culori` and `paper`. Each must be absent, or appear only as an external `import` from a declared dependency.

- [ ] **Step 8: Commit**

```bash
git add packages/engine/src/index.ts packages/engine/test/acceptance.test.ts packages/engine/test/__snapshots__ packages/mcp-server/package.json pnpm-lock.yaml docs/superpowers/specs/2026-10-07-agent-illustrator-v1-design.md docs/superpowers/plans/2026-10-07-v1-roadmap.md
git commit -m "feat(engine): public API and M2 acceptance; record A3 and S5 outcomes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Follow-ups for later plans (not M2 work)

- **M3:** the server holds one `DocumentStore` per session and passes `lastCreated` between batches. `apply_ops` maps `BatchResult` to tool output. The registry's op names feed the loose `apply_ops` enum (S1/F4).
- **M4:** transform ops edit `transform` and report `worldBounds`. Layout ops use `worldBounds` and `siblings`. Structure ops (reorder, clip, mask, duplicate, rename, ungroup) extend `structure.ts`.
- **M5:** add `defs` to `Doc` and `DocSchema`, add the tokens op, and add gradient paints (`url(#id)`) to the paint grammar.
- **M7:** `document_io load` uses `validateDocument`. History wraps `DocumentStore`, with limits on how many checkpoints are kept.
