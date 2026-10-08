# M4: Paths, Booleans, Transforms, Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give agents the ops that make real drawings:
- free paths: points, SVG path data, rounded corners, stars
- booleans
- transforms with anchor or point pivots
- layout: place, align, distribute, snap
- structure: reorder, duplicate, rename, ungroup, clip

Each op reports exact world bounds.

**Architecture:**
- **Geometry.** `geometry/pathdata.ts` parses SVG path data into cubics.
- **Shared helpers.** `ops/common.ts` holds what several ops share: points, the 9 anchors, `addPath`, `applyWorld` (move a node by a canvas-space matrix), `shapeOf` (a node's filled area in canvas space), and selection helpers.
- **New op files.** `ops/paths.ts`, `ops/boolean.ts`, `ops/transform.ts` and `ops/layout.ts` hold the new ops. `analysis/spatial-index.ts` is the rbush band query that snap uses.
- **Clip.** Clip becomes node geometry stored in the node's local space and rendered as a `<clipPath>`.

**Tech Stack:** TypeScript ~6.0.3, vitest ^5.0.3, zod ^4.6.5, immer ^11.1.21, rbush ^4.0.1, plus the M1–M3 engine.

**Spec:**
- [`PROJECT_INIT.md`](../../../PROJECT_INIT.md): FR-1.7, FR-3, FR-4, FR-5, FR-6, §5 M4, Appendix A (anchors, distribute, affine).
- [`specs/2026-10-07-agent-illustrator-v1-design.md`](../specs/2026-10-07-agent-illustrator-v1-design.md): A3 (with the M2 refinements), S5 (merged ops).

## Decisions taken in this plan (flag to the owner)

- **Merged op names (S5):**
  - `boolean { mode: union | subtract | intersect | exclude }` replaces four ops.
  - One `transform { translate?, rotate?, scale?, skew?, matrix?, pivot?, around? }`.
  - `path_from_points` and `path_commands` keep their FR names.
- **Ops never take raw command arrays.** `path_commands` takes SVG path data `d` (for example `"M10 10 L90 10 Q50 60 10 10 Z"`), which every model already knows.
- **Coordinates are canvas units everywhere**, even inside transformed groups (M2 review fix). A new node under a transformed parent gets the inverse of the parent's world matrix as its transform. Layout and transform deltas are canvas-space too, converted per node by `applyWorld`.
- **Multi-node ops report bounds per node.** When an op returns `ids`, the outcome carries `boundsById` (exact world bounds of each id that still exists).
- **Op ids are checked in the schema** (`IdInput = z.string().refine(isValidId)`), so a bad id fails in the validate-first pass together with any other schema errors. The executor still suffixes ids on collision.
- **Clip stores geometry, not a reference.** `clip { id, shape }` turns the shape node's filled area into the target's local space and stores it as `node.clip = { subpaths, fillRule }`. The shape node is removed unless `keep`. This refines A3's `clip?: string`: no hidden "clip source" nodes, and the clip moves with the node.
- **`mask` moves to M5.** Masks need gradients to be useful (fades), and a geometry-only mask is just a clip.
- **Transforms default to `around: "each"`.** Each node turns about its own pivot; `"selection"` uses the combined bounds.

## Global Constraints

- Everything in the M2 plan's Global Constraints still holds:
  - ESM, `.ts` imports, erasable syntax
  - the layer bans
  - no `Math.random`
  - `{ code, message, hint }` errors
  - all-or-nothing batches
  - own-key id lookups
- Every op that creates or moves exactly one node returns `{ id }`, so the executor reports its exact world bounds. Multi-node ops return `{ ids }`; with a single target they return `{ id }`.
- Geometry `RangeError`s never reach the executor as `internal_error`. Ops wrap geometry calls with `geometryInput(fn, hint)`, which turns them into `invalid_input`.
- `rbush` is imported only in `engine/src/analysis/`.
- **Workflow:** branch `m4-ops` from `main` after M3 is merged. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The shell allows no `>`, no `bash` and no `node -e`.

## Review Focus

1. **Children of transformed groups.** A canvas-space move (transform, place, align, distribute, snap) must move the node by exactly that much on the canvas, even when its parent is scaled or rotated. Tests: Task 5 (`translates a child of a scaled group by canvas units`) and Task 6 (`place works for a child of a transformed group`).
2. **Booleans across parents and transforms.** Operands live under different transformed parents. The result must land in the first operand's parent space with the correct world geometry. Test: Task 4 (`works across transformed parents`).
3. **Selections that contain both a group and its descendant.** Transform and layout must not move the descendant twice. Booleans must refuse the selection. Tests: Task 4 (`refuses an operand inside another operand`) and Task 5 (`skips nodes whose ancestor is selected`).
4. **Malformed path data and degenerate inputs.** Bad SVG path strings, a single point, zero radius and empty boolean results must return errors or warnings with hints, never `internal_error`. Tests: Task 1 (parser errors), Task 3 (`path_commands reports …`) and Task 4 (`an empty result …`).
5. **Renaming and ungrouping keep the tree intact.** Every parent and child reference is updated, `$last` follows a rename, and an ungroup keeps the look (world placement, inherited style, opacity). Tests: Task 7.

---

## File Structure

```
pnpm-workspace.yaml                        # + catalog rbush (Task 6)
packages/engine/package.json               # + rbush (Task 6)
packages/mcp-server/package.json           # + rbush (Task 8)
packages/engine/src/
  geometry/pathdata.ts      # parsePathData (Task 1)
  ops/common.ts             # shared op helpers (Task 2)
  ops/registry.ts           # OpContext.newId(…, options), OpContext.last (Task 2)
  ops/shapes.ts             # uses common.ts; + star (Tasks 2–3)
  ops/paths.ts              # path_from_points, path_commands, round_corners (Task 3)
  ops/boolean.ts            # boolean (Task 4)
  ops/transform.ts          # transform (Task 5)
  analysis/spatial-index.ts # bandQuery over node bounds (Task 6)
  ops/layout.ts             # place, align, distribute, snap (Task 6)
  ops/structure.ts          # + reorder, duplicate, rename, ungroup, clip (Task 7)
  scene/model.ts            # + ClipShape, NodeBase.clip, schema (Task 7)
  scene/query.ts            # worldBounds intersects the clip (Task 7)
  render/svg.ts             # <clipPath> + clip-path (Task 7)
  ops/index.ts              # registers all M4 ops (Task 8)
packages/engine/test/
  geometry/pathdata.test.ts  ops/paths.test.ts  ops/boolean.test.ts  ops/transform.test.ts
  ops/layout.test.ts  ops/structure2.test.ts  acceptance-m4.test.ts
```

---

### Task 1: SVG path data parser

**Files:**
- Create: `packages/engine/src/geometry/pathdata.ts`
- Test: `packages/engine/test/geometry/pathdata.test.ts`

**Interfaces:**
- Consumes: `arcToCubics`, `line`, `quadToCubic` from `geometry/paths.ts`.
- Produces:
  - `parsePathData(d: string): Subpath[]`. It handles M, L, H, V, C, S, Q, T, A and Z in absolute and relative forms, implicit repeats and compact arc flags.
  - Malformed input throws `RangeError` with the position.

- [ ] **Step 1: Write the failing test**

`packages/engine/test/geometry/pathdata.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parsePathData } from '../../src/geometry/pathdata.ts';
import { arcToCubics, line, polyline, quadToCubic } from '../../src/geometry/paths.ts';
import { square } from './helpers.ts';

describe('geometry/pathdata', () => {
  it('reads absolute lines and closes with an explicit segment', () => {
    expect(parsePathData('M10 10 L20 10 L20 20 Z')).toEqual([polyline([[10, 10], [20, 10], [20, 20]], true)]);
  });

  it('reads relative commands, H and V', () => {
    expect(parsePathData('m10 10 h10 v10 h-10 z')).toEqual([square(10, 10, 10)]);
  });

  it('repeats the last command for extra coordinates; after M the repeat is L', () => {
    expect(parsePathData('M0 0 10 0 10 10')).toEqual([polyline([[0, 0], [10, 0], [10, 10]], false)]);
    expect(parsePathData('m0 0 10 0 0 10')).toEqual([polyline([[0, 0], [10, 0], [10, 10]], false)]);
  });

  it('reflects the previous control point for S and T', () => {
    const [s] = parsePathData('M0 0 C0 10 10 10 10 0 S20 -10 20 0');
    expect(s!.segs[1]).toEqual([10, -10, 20, -10, 20, 0]);
    const [t] = parsePathData('M0 0 Q5 10 10 0 T20 0');
    expect(t!.segs[1]).toEqual(quadToCubic([10, 0], [15, -10], [20, 0]));
  });

  it('reads arcs, including compact flags', () => {
    expect(parsePathData('M0 0a50 50 0 01100 0')).toEqual([{ start: [0, 0], segs: arcToCubics([0, 0], 50, 50, 0, false, true, [100, 0]), closed: false }]);
  });

  it('reads compact numbers', () => {
    expect(parsePathData('M-.5.5L1e1-2')).toEqual([{ start: [-0.5, 0.5], segs: [line([-0.5, 0.5], [10, -2])], closed: false }]);
  });

  it('starts a new subpath at the old start after Z, and keeps several subpaths', () => {
    const sps = parsePathData('M0 0 L10 0 L10 10 Z L5 5 M20 20 L30 20');
    expect(sps).toHaveLength(3);
    expect(sps[1]).toEqual({ start: [0, 0], segs: [line([0, 0], [5, 5])], closed: false });
    expect(sps[2]!.start).toEqual([20, 20]);
  });

  it.each([
    ['', 'empty'],
    ['L10 10', '"M"'],
    ['M10', 'a number'],
    ['M0 0 X5 5', 'a path command'],
    ['M0 0 A10 10 0 2 0 5 5', 'an arc flag'],
  ])('rejects %j with a message naming %s', (d, what) => {
    expect(() => parsePathData(d)).toThrow(RangeError);
    expect(() => parsePathData(d)).toThrow(what);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run packages/engine/test/geometry/pathdata.test.ts`
Expected: FAIL. `Cannot find module '../../src/geometry/pathdata.ts'`.

- [ ] **Step 3: Write `pathdata.ts`**

`packages/engine/src/geometry/pathdata.ts`:

```ts
import { arcToCubics, line, quadToCubic } from './paths.ts';
import type { Seg, Subpath, Vec2 } from './types.ts';

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
const SEPARATORS = /[\s,]*/y;
const COMMANDS = 'MmZzLlHhVvCcSsQqTtAa';

/**
 * SVG path data → cubic subpaths (FR-3.3). Handles every command in absolute and relative form,
 * implicit repeats (after M they are L), S/T reflection and compact arc flags ("a5 5 0 0110 0").
 * A subpath that only moves draws nothing and is dropped. Throws RangeError naming the position.
 */
export function parsePathData(d: string): Subpath[] {
  let i = 0;
  const skip = (): void => {
    SEPARATORS.lastIndex = i;
    SEPARATORS.exec(d);
    i = SEPARATORS.lastIndex;
  };
  const fail = (what: string): never => {
    throw new RangeError(`path data: expected ${what} at position ${i}${i < d.length ? ` ("${d[i]}")` : ' (end)'}`);
  };
  const num = (): number => {
    skip();
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(d);
    if (!m) return fail('a number');
    i = NUMBER.lastIndex;
    return Number(m[0]);
  };
  const flag = (): boolean => {
    skip();
    const c = d[i];
    if (c !== '0' && c !== '1') return fail('an arc flag (0 or 1)');
    i++;
    return c === '1';
  };
  const atNumber = (): boolean => {
    NUMBER.lastIndex = i;
    return NUMBER.test(d);
  };

  skip();
  if (i >= d.length) throw new RangeError('path data is empty');
  if (d[i] !== 'M' && d[i] !== 'm') fail('"M" to start the path');

  const out: Subpath[] = [];
  let segs: Seg[] = [];
  let start: Vec2 = [0, 0];
  let open = false;
  let x = 0, y = 0;
  let c2x = 0, c2y = 0; // second control of the last cubic, for S
  let qx = 0, qy = 0; // control of the last quadratic, for T
  let cmd = '';
  let prev = '';
  const begin = (): void => {
    if (open) return;
    start = [x, y];
    segs = [];
    open = true;
  };
  const finish = (closed: boolean): void => {
    if (open && segs.length > 0) out.push({ start, segs, closed });
    segs = [];
    open = false;
  };

  for (;;) {
    skip();
    if (i >= d.length) break;
    const c = d[i]!;
    if (COMMANDS.includes(c)) {
      cmd = c;
      i++;
    } else if (cmd === '' || cmd === 'Z' || cmd === 'z' || !atNumber()) {
      fail('a path command');
    }
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M': {
        finish(false);
        x = ox + num();
        y = oy + num();
        begin();
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'Z': {
        if (open && segs.length > 0) {
          if (x !== start[0] || y !== start[1]) segs.push(line([x, y], start));
          finish(true);
        }
        open = false;
        [x, y] = start;
        break;
      }
      case 'L': {
        begin();
        const nx = ox + num(), ny = oy + num();
        segs.push(line([x, y], [nx, ny]));
        [x, y] = [nx, ny];
        break;
      }
      case 'H': {
        begin();
        const nx = ox + num();
        segs.push(line([x, y], [nx, y]));
        x = nx;
        break;
      }
      case 'V': {
        begin();
        const ny = oy + num();
        segs.push(line([x, y], [x, ny]));
        y = ny;
        break;
      }
      case 'C': {
        begin();
        const a = ox + num(), b = oy + num(), e = ox + num(), f = oy + num(), nx = ox + num(), ny = oy + num();
        segs.push([a, b, e, f, nx, ny]);
        [c2x, c2y, x, y] = [e, f, nx, ny];
        break;
      }
      case 'S': {
        begin();
        const reflect = prev === 'C' || prev === 'S';
        const a = reflect ? 2 * x - c2x : x, b = reflect ? 2 * y - c2y : y;
        const e = ox + num(), f = oy + num(), nx = ox + num(), ny = oy + num();
        segs.push([a, b, e, f, nx, ny]);
        [c2x, c2y, x, y] = [e, f, nx, ny];
        break;
      }
      case 'Q': {
        begin();
        const a = ox + num(), b = oy + num(), nx = ox + num(), ny = oy + num();
        segs.push(quadToCubic([x, y], [a, b], [nx, ny]));
        [qx, qy, x, y] = [a, b, nx, ny];
        break;
      }
      case 'T': {
        begin();
        const reflect = prev === 'Q' || prev === 'T';
        const a = reflect ? 2 * x - qx : x, b = reflect ? 2 * y - qy : y;
        const nx = ox + num(), ny = oy + num();
        segs.push(quadToCubic([x, y], [a, b], [nx, ny]));
        [qx, qy, x, y] = [a, b, nx, ny];
        break;
      }
      case 'A': {
        begin();
        const rx = num(), ry = num(), rot = num(), large = flag(), sweep = flag(), nx = ox + num(), ny = oy + num();
        segs.push(...arcToCubics([x, y], rx, ry, rot, large, sweep, [nx, ny]));
        [x, y] = [nx, ny];
        break;
      }
    }
    prev = cmd.toUpperCase();
  }
  finish(false);
  return out;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run packages/engine/test/geometry/pathdata.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/geometry/pathdata.ts packages/engine/test/geometry/pathdata.test.ts
git commit -m "feat(geometry): SVG path data parser to cubic subpaths" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Shared op helpers and `OpContext` additions

**Files:**
- Create: `packages/engine/src/ops/common.ts`
- Modify: `packages/engine/src/ops/registry.ts` (`newId` options, `last`), `packages/engine/src/ops/shapes.ts` (use `common.ts`)
- Test: `packages/engine/test/ops/common.test.ts`

**Interfaces:**
- Consumes: geometry (`booleanOp`, `applyToPoint`, `compose`, `IDENTITY`, `invert`, `translate`, `unionBoxes`), scene (`worldBounds`, `worldSubpaths`, `worldTransform`, `requireNode`), `insertNode`, `Length`, `OpContext`.
- Produces (`common.ts`):
  - field schemas: `common`, `type Common`, `PointInput`, `ANCHORS`, `type Anchor`, `AnchorInput`
  - `anchorPoint(box, anchor): Vec2`, `point(ctx, p): Vec2`, `positive(op, name, v): number`
  - `addPath(ctx, input: Common, p: { prefix; subpaths; source; defaults?; fillRule? }): string`
  - `geometryInput<T>(fn, hint): T`
  - `resolveIds(ctx, refs): string[]`, `topmost(ctx, ids): string[]`
  - `boundsOf(ctx, id): Box`, `selectionBounds(ctx, ids): Box`
  - `applyWorld(ctx, id, D: Mat6): void`
  - `shapeOf(ctx, id): Shape`
- Produces (`registry.ts`):
  - `OpContext.newId(requested, prefix, options?: { releasing?: ReadonlySet<string>; quiet?: boolean })`
  - `OpContext.last: string | undefined`, now readable and writable

- [ ] **Step 1: Write the failing test**

`packages/engine/test/ops/common.test.ts`:

```ts
import { castDraft, produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { rotate, scale, translate } from '../../src/geometry/transform.ts';
import { anchorPoint, applyWorld, shapeOf, topmost } from '../../src/ops/common.ts';
import { defineOp, executeBatch, Registry } from '../../src/ops/registry.ts';
import { worldBounds } from '../../src/scene/query.ts';
import { docOf, groupNode, pathNode } from '../fixtures.ts';
import { square } from '../geometry/helpers.ts';
import { signedArea } from '../../src/geometry/flatten.ts';

const box = { x: 10, y: 20, width: 100, height: 50 };
/** A test op that runs one helper with a live OpContext. */
const probe = (fn: Parameters<typeof defineOp>[0]['handler']) =>
  new Registry().register(defineOp({ name: 'probe', domain: 'test', description: '', schema: z.strictObject({}), examples: [], handler: fn }));

describe('ops/common', () => {
  it('anchorPoint covers the 9 anchors', () => {
    expect(anchorPoint(box, 'top-left')).toEqual([10, 20]);
    expect(anchorPoint(box, 'top')).toEqual([60, 20]);
    expect(anchorPoint(box, 'right')).toEqual([110, 45]);
    expect(anchorPoint(box, 'center')).toEqual([60, 45]);
    expect(anchorPoint(box, 'bottom-right')).toEqual([110, 70]);
  });

  it('applyWorld moves a node by canvas units even inside a scaled, rotated group', () => {
    const doc = docOf([
      groupNode('g', ['p'], { transform: rotate(30, 0, 0) }),
      pathNode('p', [square(0, 0, 10)], { parent: 'g', transform: scale(2) }),
    ]);
    const before = worldBounds(doc, 'p')!;
    const r = executeBatch(probe((_, ctx) => (applyWorld(ctx, 'p', translate(7, -3)), { id: 'p' })), doc, [{ op: 'probe' }]);
    const after = worldBounds(r.doc, 'p')!;
    expect(after.x - before.x).toBeCloseTo(7, 9);
    expect(after.y - before.y).toBeCloseTo(-3, 9);
    expect(after.width).toBeCloseTo(before.width, 9);
  });

  it('shapeOf returns canvas-space geometry; a group is the union of its paths', () => {
    const doc = docOf([
      groupNode('g', ['a', 'b'], { transform: translate(100, 0) }),
      pathNode('a', [square(0, 0, 10)], { parent: 'g' }),
      pathNode('b', [square(5, 5, 10)], { parent: 'g' }),
    ]);
    let area = 0, x = 0;
    executeBatch(
      probe((_, ctx) => {
        const s = shapeOf(ctx, 'g');
        area = signedArea(s.subpaths);
        x = Math.min(...s.subpaths.map((sp) => sp.start[0]));
        return {};
      }),
      doc,
      [{ op: 'probe' }],
    );
    expect(area).toBeCloseTo(175, 6);
    expect(x).toBeGreaterThanOrEqual(100);
  });

  it('topmost drops nodes whose ancestor is also selected', () => {
    const doc = docOf([groupNode('g', ['p']), pathNode('p', [], { parent: 'g' }), pathNode('q', [])]);
    let kept: string[] = [];
    executeBatch(probe((_, ctx) => ((kept = topmost(ctx, ['p', 'g', 'q'])), {})), doc, [{ op: 'probe' }]);
    expect(kept).toEqual(['g', 'q']);
  });

  it('newId can release ids that the op is about to delete, and can stay quiet', () => {
    const doc = docOf([pathNode('a', [])]);
    const ids: string[] = [];
    const r = executeBatch(
      probe((_, ctx) => {
        ids.push(ctx.newId('a', 'x', { releasing: new Set(['a']) }), ctx.newId('a', 'x', { quiet: true }));
        return {};
      }),
      doc,
      [{ op: 'probe' }],
    );
    expect(ids).toEqual(['a', 'a-2']);
    expect(r.results[0]).toMatchObject({ warnings: [] });
  });

  it('a produce on a fresh doc still sees the moved transform (sanity for castDraft use)', () => {
    const moved = produce(docOf([pathNode('p', [square(0, 0, 1)])]), (d) => {
      d.nodes.p!.transform = castDraft(translate(1, 1));
    });
    expect(worldBounds(moved, 'p')).toEqual({ x: 1, y: 1, width: 1, height: 1 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run packages/engine/test/ops/common.test.ts`
Expected: FAIL. `Cannot find module '../../src/ops/common.ts'`.

- [ ] **Step 3: Extend `OpContext.newId` and expose `last`**

In `packages/engine/src/ops/registry.ts`:

1. In `interface OpContext`, replace the `newId` declaration with:

```ts
  /**
   * Claims an id for a new node: the requested one (suffixed -2, -3… with a warning when taken) or
   * "<prefix>-<n>". The claimed id becomes "$last". `releasing` lists ids this op deletes before it
   * inserts, which therefore count as free. `quiet` suppresses the renamed warning.
   */
  newId(requested: string | undefined, prefix: string, options?: { readonly releasing?: ReadonlySet<string>; readonly quiet?: boolean }): string;
  /** The node "$last" refers to. Ops that rename or replace nodes keep it pointing at the right one. */
  last: string | undefined;
```

2. Per-id bounds for multi-node results. Add `readonly boundsById?: Readonly<Record<string, Box | null>>` to the `Done` type. In `executeBatch`, after the `ids` spread, add:

```ts
        ...(result.ids === undefined
          ? {}
          : { boundsById: Object.fromEntries(result.ids.filter((x) => Object.hasOwn(current.nodes, x)).map((x) => [x, worldBounds(current, x)])) }),
```

Add this test to `packages/engine/test/ops/registry.test.ts`, inside `ops/registry: executeBatch`:

```ts
  it('ops that return several ids get bounds for each one that still exists', () => {
    const r = executeBatch(registry, fresh(), [square('a'), { op: 'touch', ref: 'a' }]);
    expect(r.results[1]).toMatchObject({ ids: ['a'], boundsById: { a: { x: 0, y: 0, width: 5, height: 5 } } });
  });
```

3. In `class Context`, change the `newId` signature and the `taken`/warn lines:

```ts
  newId(requested: string | undefined, prefix: string, options: { readonly releasing?: ReadonlySet<string>; readonly quiet?: boolean } = {}): string {
    const taken = (id: string) => (getNode(this.doc, id) !== undefined && !options.releasing?.has(id)) || this.#claimed.has(id);
```

and

```ts
      if (id !== requested && !options.quiet) this.warn('id_renamed', `id "${requested}" is taken; the new node is "${id}"`);
```

- [ ] **Step 4: Write `ops/common.ts`**

`packages/engine/src/ops/common.ts`:

```ts
import { castDraft } from 'immer';
import { z } from 'zod';
import { EngineError } from '../errors.ts';
import { unionBoxes } from '../geometry/bezier.ts';
import { booleanOp, type Shape } from '../geometry/boolean.ts';
import { compose, IDENTITY, invert } from '../geometry/transform.ts';
import type { Box, FillRule, Mat6, Subpath, Vec2 } from '../geometry/types.ts';
import { isValidId, StyleSchema, type PathNode, type Style } from '../scene/model.ts';
import { requireNode, worldBounds, worldSubpaths, worldTransform } from '../scene/query.ts';
import { insertNode } from '../scene/store.ts';
import { Length, type OpContext } from './registry.ts';

/** A new node's id; rejected in the validate-first pass when it can never be used. */
export const IdInput = z.string().refine(isValidId, 'not a usable id: start with a letter or "_", use letters, digits, "_", "." or "-", and avoid "canvas" and names like "constructor"');

/** Fields every drawing op accepts. Coordinates are canvas units, also inside transformed groups. */
export const common = { id: IdInput.optional(), parent: z.string().optional(), style: StyleSchema.optional() };
export type Common = { readonly id?: string; readonly parent?: string; readonly style?: Style };

/** A point as [x, y]; each part is canvas units or a percent of the canvas width / height. */
export const PointInput = z.tuple([Length, Length]);
export type PointInput = z.output<typeof PointInput>;

export const ANCHORS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'] as const;
export type Anchor = (typeof ANCHORS)[number];
export const AnchorInput = z.enum(ANCHORS);

/** anchor(box, u, v) = (x + u·w, y + v·h), u, v ∈ {0, ½, 1} (Appendix A). */
export function anchorPoint(b: Box, a: Anchor): Vec2 {
  const u = a.endsWith('left') ? 0 : a.endsWith('right') ? 1 : 0.5;
  const v = a.startsWith('top') ? 0 : a.startsWith('bottom') ? 1 : 0.5;
  return [b.x + u * b.width, b.y + v * b.height];
}

export function point(ctx: OpContext, p: PointInput): Vec2 {
  return [ctx.len(p[0], 'x'), ctx.len(p[1], 'y')];
}

export function positive(op: string, name: string, v: number): number {
  if (!(v > 0)) {
    throw new EngineError('invalid_input', `${op} ${name} must be > 0, got ${v}`, `Give ${name} a positive size in canvas units or a percent such as "10%".`);
  }
  return v;
}

/** Runs geometry code; its RangeErrors become invalid_input errors with this hint. */
export function geometryInput<T>(fn: () => T, hint: string): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RangeError) throw new EngineError('invalid_input', e.message, hint);
    throw e;
  }
}

type NewPath = {
  readonly prefix: string;
  readonly subpaths: readonly Subpath[];
  readonly source: Record<string, unknown>;
  readonly defaults?: Style;
  readonly fillRule?: FillRule;
};

const isIdentity = (m: Mat6) => m.every((v, i) => v === IDENTITY[i]);

/**
 * The transform that makes a new child of `parentId` land at the canvas coordinates of its geometry:
 * the inverse of the parent's world matrix (identity at the top level).
 */
export function canvasSpaceIn(ctx: OpContext, parentId: string | null): Mat6 {
  const world = parentId === null ? IDENTITY : worldTransform(ctx.doc, parentId);
  if (isIdentity(world)) return IDENTITY;
  const inv = invert(world);
  if (!inv) throw new EngineError('invalid_structure', `group "${parentId}" is squashed flat (scale 0)`, 'Give that group a non-zero scale before adding to it.');
  return inv;
}

/** Inserts a new path node on top of its parent (or the canvas) and returns its id. Coordinates are canvas units. */
export function addPath(ctx: OpContext, input: Common, p: NewPath): string {
  const parent = input.parent === undefined ? null : ctx.node(input.parent);
  if (parent && parent.type !== 'group') {
    throw new EngineError('invalid_structure', `parent "${parent.id}" is a ${parent.type}, not a group`, 'Pass a group id as parent, or leave parent out.');
  }
  const transform = canvasSpaceIn(ctx, parent?.id ?? null);
  const segs = p.subpaths.reduce((n, sp) => n + sp.segs.length, 0);
  if (segs > ctx.limits.maxSegmentsPerPath) {
    throw new EngineError('limit_exceeded', `${segs} segments in one path; the limit is ${ctx.limits.maxSegmentsPerPath}`, 'Use fewer points, or split the shape.');
  }
  const style = ctx.style({ ...p.defaults, ...input.style });
  const id = ctx.newId(input.id, p.prefix);
  const node: PathNode = {
    id,
    type: 'path',
    parent: parent?.id ?? null,
    transform,
    style,
    fillRule: p.fillRule ?? 'nonzero',
    subpaths: p.subpaths,
    meta: { source: p.source },
  };
  ctx.update((d) => insertNode(d, node));
  return id;
}

/** Resolves refs (ids or "$last") to unique ids, in order. */
export function resolveIds(ctx: OpContext, refs: readonly string[]): string[] {
  return [...new Set(refs.map((r) => ctx.node(r).id))];
}

/** The ids whose ancestors are not selected too; an ancestor already carries its descendants. */
export function topmost(ctx: OpContext, ids: readonly string[]): string[] {
  const chosen = new Set(ids);
  return ids.filter((id) => {
    for (let p = requireNode(ctx.doc, id).parent; p !== null; p = requireNode(ctx.doc, p).parent) if (chosen.has(p)) return false;
    return true;
  });
}

/** World bounds, or an error when the node draws nothing. */
export function boundsOf(ctx: OpContext, id: string): Box {
  const b = worldBounds(ctx.doc, id);
  if (!b) throw new EngineError('invalid_structure', `"${id}" has no geometry to measure`, 'Give it some geometry first, or leave it out of this op.');
  return b;
}

export function selectionBounds(ctx: OpContext, ids: readonly string[]): Box {
  return unionBoxes(ids.map((id) => boundsOf(ctx, id)))!;
}

/** Moves a node by a canvas-space matrix D (world' = D·world); its new local transform is P⁻¹·D·P·local. */
export function applyWorld(ctx: OpContext, id: string, D: Mat6): void {
  const node = requireNode(ctx.doc, id);
  const P = node.parent === null ? IDENTITY : worldTransform(ctx.doc, node.parent);
  const Pinv = invert(P);
  if (!Pinv) {
    throw new EngineError('invalid_structure', `the group holding "${id}" is squashed flat (scale 0)`, 'Give the parent group a non-zero scale first.');
  }
  const local = compose(Pinv, D, P, node.transform);
  ctx.update((d) => {
    d.nodes[node.id]!.transform = castDraft(local);
  });
}

/** A node's filled area in canvas space. A group is the union of the paths inside it. */
export function shapeOf(ctx: OpContext, id: string): Shape {
  const node = requireNode(ctx.doc, id);
  if (node.type === 'path') return { subpaths: worldSubpaths(ctx.doc, node), fillRule: node.fillRule };
  let acc: Shape = { subpaths: [], fillRule: 'nonzero' };
  for (const child of node.children) acc = booleanOp('union', acc, shapeOf(ctx, child));
  return acc;
}
```

Then, in `packages/engine/src/ops/shapes.ts`, delete the local `common`, `Common`, `positive`, `isIdentity` and `addPath` definitions. The M2 review fix's canvas-space logic now lives in `canvasSpaceIn`. Import them from `./common.ts`, and change each `addPath(ctx, input, prefix, subpaths, source, defaults?)` call to the object form. For example, rect becomes `addPath(ctx, input, { prefix: 'rect', subpaths: [sp], source: { kind: 'rect', x, y, width: w, height: h, radius: r } })`, and line becomes `addPath(ctx, input, { prefix: 'line', subpaths: [...], source: {...}, defaults: { stroke: '#000000' } })`. The import list of `shapes.ts` becomes:

```ts
import { z } from 'zod';
import { EngineError } from '../errors.ts';
import { ellipse as ellipsePath, polyline, roundCorners } from '../geometry/paths.ts';
import { cosSinDeg } from '../geometry/transform.ts';
import type { Vec2 } from '../geometry/types.ts';
import { addPath, common, positive } from './common.ts';
import { defineOp, Length } from './registry.ts';
```

- [ ] **Step 5: Run the tests to verify they pass, and the shape tests still pass**

Run: `pnpm exec vitest run packages/engine/test/ops`
Expected: PASS. That is `common.test.ts` (6 tests) and every existing ops test.

- [ ] **Step 6: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/ops/common.ts packages/engine/src/ops/registry.ts packages/engine/src/ops/shapes.ts packages/engine/test/ops/common.test.ts
git commit -m "feat(ops): shared op helpers (anchors, canvas-space moves, shapes); newId releasing/quiet" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `path_from_points`, `path_commands`, `round_corners`, `star`

**Files:**
- Create: `packages/engine/src/ops/paths.ts`
- Modify: `packages/engine/src/ops/shapes.ts` (+ `star`)
- Test: `packages/engine/test/ops/paths.test.ts`

**Interfaces:**
- Consumes:
  - `polyline`, `smooth`, `fit`, `roundCorners` from `geometry/paths.ts`
  - `parsePathData`
  - `common.ts` helpers
- Produces these ops:
  - `path_from_points { …common, points: [x, y][] (2..5000), mode?: 'polyline' | 'smooth' | 'fit', closed?, tolerance? }`
  - `path_commands { …common, d, fillRule? }`
  - `round_corners { ids, radius }`
  - `star { …common, cx, cy, outer, inner, points, rotation?, roundness? }`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/ops/paths.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { signedArea } from '../../src/geometry/flatten.ts';
import { polyline } from '../../src/geometry/paths.ts';
import type { Box } from '../../src/geometry/types.ts';
import { pathCommands, pathFromPoints, roundCornersOp } from '../../src/ops/paths.ts';
import { executeBatch, Registry, type BatchResult } from '../../src/ops/registry.ts';
import { rect, star } from '../../src/ops/shapes.ts';
import { createDocument, type Doc, type PathNode } from '../../src/scene/model.ts';
import { expectIntact } from '../fixtures.ts';

const registry = new Registry().register(rect, star, pathFromPoints, pathCommands, roundCornersOp);
function run(ops: unknown[], doc: Doc = createDocument({ width: 800, height: 600 })): BatchResult {
  const r = executeBatch(registry, doc, ops);
  expectIntact(r.doc);
  return r;
}
const pathOf = (r: BatchResult, id: string) => r.doc.nodes[id] as PathNode;
const boundsAt = (r: BatchResult, i: number) => (r.results[i] as { bounds: Box }).bounds;

describe('ops/paths', () => {
  it('path_from_points: polyline through percent points, open by default', () => {
    const r = run([{ op: 'path_from_points', id: 'p', points: [[0, 0], ['50%', '50%'], [800, 0]] }]);
    expect(pathOf(r, 'p').subpaths).toEqual([polyline([[0, 0], [400, 300], [800, 0]], false)]);
    expect(boundsAt(r, 0)).toEqual({ x: 0, y: 0, width: 800, height: 300 });
  });

  it('path_from_points: smooth passes through every point; fit stays within tolerance', () => {
    const pts = [[0, 100], [100, 0], [200, 100], [300, 0]];
    const smooth = pathOf(run([{ op: 'path_from_points', id: 's', points: pts, mode: 'smooth' }]), 's').subpaths[0]!;
    expect(smooth.segs.map((g) => [g[4], g[5]])).toEqual(pts.slice(1));
    const fit = run([{ op: 'path_from_points', id: 'f', points: pts, mode: 'fit', closed: true, tolerance: 0.5 }]);
    expect(pathOf(fit, 'f').subpaths[0]!.closed).toBe(true);
  });

  it('path_from_points: repeated points are an invalid_input with a hint, not a crash', () => {
    expect(run([{ op: 'path_from_points', points: [[5, 5], [5, 5]], mode: 'smooth' }]).results[0]).toMatchObject({ error: { code: 'invalid_input' } });
  });

  it('path_commands: SVG path data with a fill rule', () => {
    const r = run([{ op: 'path_commands', id: 'ring', d: 'M0 0 H100 V100 H0 Z M25 25 H75 V75 H25 Z', fillRule: 'evenodd' }]);
    expect(pathOf(r, 'ring').fillRule).toBe('evenodd');
    expect(pathOf(r, 'ring').subpaths).toHaveLength(2);
    expect(boundsAt(r, 0)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('path_commands reports malformed data and empty drawings with hints', () => {
    expect(run([{ op: 'path_commands', d: 'M0 0 L10' }]).results[0]).toMatchObject({ error: { code: 'invalid_input' } });
    expect(JSON.stringify(run([{ op: 'path_commands', d: 'M0 0 L10' }]).results[0])).toContain('position');
    expect(run([{ op: 'path_commands', d: 'M5 5' }]).results[0]).toMatchObject({ error: { code: 'invalid_input' } });
  });

  it('round_corners fillets every path it is given and warns about clamping', () => {
    const r = run([
      { op: 'rect', id: 'a', x: 0, y: 0, width: 100, height: 100 },
      { op: 'rect', id: 'b', x: 200, y: 0, width: 20, height: 20 },
      { op: 'round_corners', ids: ['a', 'b'], radius: 15 },
    ]);
    expect(pathOf(r, 'a').subpaths[0]!.segs).toHaveLength(8);
    expect(signedArea(pathOf(r, 'a').subpaths)).toBeLessThan(10_000);
    expect(r.results[2]).toMatchObject({ status: 'ok', ids: ['a', 'b'], warnings: [{ code: 'radius_clamped' }] });
  });

  it('star: first tip up, exact bounds, roundness rounds the corners', () => {
    const r = run([{ op: 'star', id: 's', cx: 0, cy: 0, outer: 10, inner: 4, points: 5 }]);
    const b = boundsAt(r, 0);
    expect(b.y).toBeCloseTo(-10, 9);
    expect(b.y + b.height).toBeCloseTo(10 * Math.cos(Math.PI / 5), 9);
    expect(pathOf(r, 's').subpaths[0]!.segs).toHaveLength(10);
    const round = run([{ op: 'star', id: 's', cx: 0, cy: 0, outer: 10, inner: 4, points: 5, roundness: 0.5 }]);
    expect(pathOf(round, 's').subpaths[0]!.segs.length).toBeGreaterThan(10);
    expect(boundsAt(round, 0).y).toBeGreaterThan(-10);
  });

  it('every example runs on an empty canvas', () => {
    for (const def of [pathFromPoints, pathCommands, roundCornersOp, star]) {
      for (const ex of def.examples) expect(executeBatch(registry, createDocument({ width: 800, height: 600 }), ex).ok).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run packages/engine/test/ops/paths.test.ts`
Expected: FAIL. `Cannot find module '../../src/ops/paths.ts'`.

- [ ] **Step 3: Write `ops/paths.ts` and add `star`**

`packages/engine/src/ops/paths.ts`:

```ts
import { castDraft } from 'immer';
import { z } from 'zod';
import { EngineError } from '../errors.ts';
import { parsePathData } from '../geometry/pathdata.ts';
import { fit, polyline, roundCorners, smooth } from '../geometry/paths.ts';
import { addPath, common, geometryInput, point, PointInput, resolveIds } from './common.ts';
import { defineOp, Length } from './registry.ts';

export const pathFromPoints = defineOp({
  name: 'path_from_points',
  domain: 'paths',
  description:
    'Path through points [x, y]: mode "polyline" (straight lines), "smooth" (a curve through every point) or "fit" (a few curves near the points, within tolerance px).',
  schema: z.strictObject({
    ...common,
    points: z.array(PointInput).min(2).max(5000),
    mode: z.enum(['polyline', 'smooth', 'fit']).optional(),
    closed: z.boolean().optional(),
    tolerance: z.number().positive().optional(),
  }),
  examples: [
    [{ op: 'path_from_points', id: 'hills', points: [[0, 420], [200, 330], [420, 390], [640, 300], [800, 380]], mode: 'smooth', style: { fill: 'none', stroke: '#2a9d8f', strokeWidth: 4 } }],
  ],
  handler(input, ctx) {
    const pts = input.points.map((p) => point(ctx, p));
    const closed = input.closed ?? false;
    const mode = input.mode ?? 'polyline';
    const sp = geometryInput(
      () => (mode === 'polyline' ? polyline(pts, closed) : mode === 'smooth' ? smooth(pts, closed) : fit(pts, closed, input.tolerance ?? 1)),
      'Give at least two different points.',
    );
    return { id: addPath(ctx, input, { prefix: 'path', subpaths: [sp], source: { kind: 'path_from_points', mode, closed, points: pts.length } }) };
  },
});

export const pathCommands = defineOp({
  name: 'path_commands',
  domain: 'paths',
  description: 'Path from SVG path data `d` (M, L, H, V, C, S, Q, T, A, Z, absolute or relative). Quadratics and arcs become cubics. fillRule "evenodd" makes inner loops holes.',
  schema: z.strictObject({ ...common, d: z.string().min(1).max(200_000), fillRule: z.enum(['nonzero', 'evenodd']).optional() }),
  examples: [[{ op: 'path_commands', id: 'leaf', d: 'M400 200 Q480 260 400 380 Q320 260 400 200 Z', style: { fill: '#52b788' } }]],
  handler(input, ctx) {
    const subpaths = geometryInput(() => parsePathData(input.d), 'Use SVG path syntax, e.g. "M10 10 L90 10 Q50 60 10 10 Z".');
    if (subpaths.length === 0) {
      throw new EngineError('invalid_input', 'path data draws nothing (only moves)', 'Add drawing commands after M, e.g. "M10 10 L90 10".');
    }
    return { id: addPath(ctx, input, { prefix: 'path', subpaths, source: { kind: 'path_commands' }, ...(input.fillRule ? { fillRule: input.fillRule } : {}) }) };
  },
});

export const roundCornersOp = defineOp({
  name: 'round_corners',
  domain: 'paths',
  description: "Rounds the sharp corners between straight edges of paths with a fillet radius in the path's own units, clamped to half of each edge.",
  schema: z.strictObject({ ids: z.array(z.string()).min(1).max(1000), radius: Length }),
  examples: [
    [
      { op: 'path_from_points', id: 'tri', points: [[300, 400], [400, 220], [500, 400]], closed: true, style: { fill: '#e76f51' } },
      { op: 'round_corners', ids: ['tri'], radius: 20 },
    ],
  ],
  handler(input, ctx) {
    const r = ctx.len(input.radius, 'min');
    if (!(r > 0)) throw new EngineError('invalid_input', `radius must be > 0, got ${r}`, 'Give a positive radius in px.');
    const ids = resolveIds(ctx, input.ids);
    let clamped = 0, skipped = 0;
    for (const id of ids) {
      const node = ctx.node(id);
      if (node.type !== 'path') throw new EngineError('invalid_structure', `"${id}" is a group`, 'Round the paths inside the group by their ids.');
      const subpaths = node.subpaths.map((sp) => {
        const out = roundCorners(sp, r);
        clamped += out.clamped;
        skipped += out.skipped;
        return out.subpath;
      });
      ctx.update((d) => {
        (d.nodes[id] as { subpaths: unknown }).subpaths = castDraft(subpaths);
      });
    }
    if (clamped > 0) ctx.warn('radius_clamped', `${clamped} corner(s) got a smaller radius: the edges are too short for ${r}`);
    if (skipped > 0) ctx.warn('corners_skipped', `${skipped} corner(s) next to a curve were left sharp`);
    return ids.length === 1 ? { id: ids[0]! } : { ids };
  },
});
```

Append to `packages/engine/src/ops/shapes.ts`:

```ts
export const star = defineOp({
  name: 'star',
  domain: 'shapes',
  description: 'Star with `points` tips: outer and inner radius around (cx, cy). The first tip points up; rotation turns it clockwise in degrees; roundness 0..1 rounds the corners.',
  schema: z.strictObject({
    ...common,
    cx: Length,
    cy: Length,
    outer: Length,
    inner: Length,
    points: z.number().int().min(3).max(500),
    rotation: z.number().optional(),
    roundness: z.number().min(0).max(1).optional(),
  }),
  examples: [[{ op: 'star', id: 'badge', cx: 400, cy: 300, outer: 100, inner: 45, points: 5, style: { fill: '#ffb703' } }]],
  handler(input, ctx) {
    const cx = ctx.len(input.cx, 'x'), cy = ctx.len(input.cy, 'y');
    const ro = positive('star', 'outer', ctx.len(input.outer, 'min'));
    const ri = positive('star', 'inner', ctx.len(input.inner, 'min'));
    const n = input.points, rotation = input.rotation ?? 0, roundness = input.roundness ?? 0;
    const pts = Array.from({ length: 2 * n }, (_, k): Vec2 => {
      const r = k % 2 === 0 ? ro : ri;
      const [c, s] = cosSinDeg(rotation - 90 + (180 * k) / n);
      return [cx + r * c, cy + r * s];
    });
    let sp = polyline(pts, true);
    if (roundness > 0) {
      const edge = Math.hypot(pts[1]![0] - pts[0]![0], pts[1]![1] - pts[0]![1]);
      sp = roundCorners(sp, roundness * edge).subpath;
    }
    return { id: addPath(ctx, input, { prefix: 'star', subpaths: [sp], source: { kind: 'star', cx, cy, outer: ro, inner: ri, points: n, rotation, roundness } }) };
  },
});
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run packages/engine/test/ops/paths.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both exit 0. If the cast `(d.nodes[id] as { subpaths: unknown })` trips the linter or the compiler, use `(d.nodes[id] as Draft<PathNode>).subpaths = castDraft(subpaths)` with `Draft` imported from immer and `PathNode` from the model, and ledger the change.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/ops/paths.ts packages/engine/src/ops/shapes.ts packages/engine/test/ops/paths.test.ts
git commit -m "feat(ops): path_from_points, path_commands, round_corners and star" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `boolean`

**Files:**
- Create: `packages/engine/src/ops/boolean.ts`
- Test: `packages/engine/test/ops/boolean.test.ts`

**Interfaces:**
- Consumes:
  - `booleanOp` from geometry
  - `applyToSubpaths`, `invert`, `IDENTITY`
  - `shapeOf`, `resolveIds`, `topmost` from `common.ts`
  - `insertNode`, `removeSubtree`, `siblings`, `worldTransform`
- Produces: op `boolean { mode, ids (2..100), id?, keep?, style? }`.

- [ ] **Step 1: Write the failing test**

`packages/engine/test/ops/boolean.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { signedArea } from '../../src/geometry/flatten.ts';
import { translate, scale } from '../../src/geometry/transform.ts';
import { boolean } from '../../src/ops/boolean.ts';
import { executeBatch, Registry, type BatchResult } from '../../src/ops/registry.ts';
import { ellipse, rect } from '../../src/ops/shapes.ts';
import { group } from '../../src/ops/structure.ts';
import { createDocument, type Doc, type PathNode } from '../../src/scene/model.ts';
import { docOf, expectIntact, groupNode, pathNode } from '../fixtures.ts';
import { square } from '../geometry/helpers.ts';

const registry = new Registry().register(rect, ellipse, group, boolean);
function run(ops: unknown[], doc: Doc = createDocument({ width: 800, height: 600 })): BatchResult {
  const r = executeBatch(registry, doc, ops);
  expectIntact(r.doc);
  return r;
}
const two = [
  { op: 'rect', id: 'a', x: 0, y: 0, width: 10, height: 10 },
  { op: 'rect', id: 'b', x: 5, y: 5, width: 10, height: 10 },
];

describe('ops/boolean', () => {
  it('union replaces the operands with one path at the first operand’s place', () => {
    const r = run([{ op: 'rect', id: 'under', x: 0, y: 0, width: 1, height: 1 }, ...two, { op: 'boolean', mode: 'union', ids: ['a', 'b'], id: 'u' }]);
    expect(r.doc.root).toEqual(['under', 'u']);
    expect(signedArea((r.doc.nodes.u as PathNode).subpaths)).toBeCloseTo(175, 6);
    expect(r.results[3]).toMatchObject({ id: 'u', bounds: { x: 0, y: 0, width: 15, height: 15 } });
  });

  it('subtract with keep leaves the operands and puts the result just above the first', () => {
    const r = run([...two, { op: 'boolean', mode: 'subtract', ids: ['a', 'b'], keep: true }]);
    expect(r.doc.root).toEqual(['a', 'boolean-1', 'b']);
    expect(signedArea((r.doc.nodes['boolean-1'] as PathNode).subpaths)).toBeCloseTo(75, 6);
  });

  it('may reuse the id of a consumed operand without a warning; inherits the first style', () => {
    const r = run([{ ...two[0], style: { fill: 'red' } }, two[1], { op: 'boolean', mode: 'intersect', ids: ['a', 'b'], id: 'a' }]);
    expect(r.results[2]).toMatchObject({ status: 'ok', id: 'a', warnings: [] });
    expect(r.doc.nodes.a!.style).toEqual({ fill: 'red' });
  });

  it('folds more than two operands left to right, and groups count as their union', () => {
    const r = run([...two, { op: 'rect', id: 'c', x: 20, y: 0, width: 10, height: 10 }, { op: 'group', id: 'g', ids: ['b', 'c'] }, { op: 'boolean', mode: 'union', ids: ['a', 'g'] }]);
    expect(signedArea((r.doc.nodes['boolean-1'] as PathNode).subpaths)).toBeCloseTo(275, 6);
  });

  it('works across transformed parents: the result lands in the first operand’s parent space', () => {
    const doc = docOf([
      groupNode('g', ['a'], { transform: translate(100, 0) }),
      pathNode('a', [square(0, 0, 10)], { parent: 'g' }),
      groupNode('h', ['b'], { transform: scale(2) }),
      pathNode('b', [square(52.5, 2.5, 5)], { parent: 'h' }),
    ]);
    const r = run([{ op: 'boolean', mode: 'union', ids: ['a', 'b'], id: 'u' }], doc);
    expect(r.doc.nodes.u!.parent).toBe('g');
    expect(r.results[0]).toMatchObject({ bounds: { x: 100, y: 0, width: 15, height: 15 } });
  });

  it('an empty result is a warning, not an error', () => {
    const r = run([...two, { op: 'rect', id: 'far', x: 500, y: 500, width: 5, height: 5 }, { op: 'boolean', mode: 'intersect', ids: ['a', 'far'] }]);
    expect(r.results[3]).toMatchObject({ status: 'ok', warnings: [{ code: 'empty_result' }] });
  });

  it('refuses an operand inside another operand, and fewer than two distinct operands', () => {
    expect(run([...two, { op: 'group', id: 'g', ids: ['a', 'b'] }, { op: 'boolean', mode: 'union', ids: ['g', 'a'] }]).results[3]).toMatchObject({ error: { code: 'invalid_structure' } });
    expect(run([...two, { op: 'boolean', mode: 'union', ids: ['a', 'a'] }]).results[2]).toMatchObject({ error: { code: 'invalid_input' } });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run packages/engine/test/ops/boolean.test.ts`
Expected: FAIL. `Cannot find module '../../src/ops/boolean.ts'`.

- [ ] **Step 3: Write `ops/boolean.ts`**

`packages/engine/src/ops/boolean.ts`:

```ts
import { z } from 'zod';
import { EngineError } from '../errors.ts';
import { booleanOp, type Shape } from '../geometry/boolean.ts';
import { applyToSubpaths, IDENTITY, invert } from '../geometry/transform.ts';
import { StyleSchema, type PathNode } from '../scene/model.ts';
import { requireNode, siblings, worldTransform } from '../scene/query.ts';
import { insertNode, removeSubtree } from '../scene/store.ts';
import { resolveIds, shapeOf, topmost } from './common.ts';
import { defineOp } from './registry.ts';

export const boolean = defineOp({
  name: 'boolean',
  domain: 'boolean',
  description:
    'Combines filled shapes: "union", "subtract" (first minus the rest), "intersect" or "exclude". Groups count as the union of their paths. ' +
    'The result is one new path where the first shape was, styled like it; the inputs are removed unless keep is true.',
  schema: z.strictObject({
    mode: z.enum(['union', 'subtract', 'intersect', 'exclude']),
    ids: z.array(z.string()).min(2).max(100),
    id: z.string().optional(),
    keep: z.boolean().optional(),
    style: StyleSchema.optional(),
  }),
  examples: [
    [
      { op: 'ellipse', id: 'plate', cx: 400, cy: 300, rx: 120, style: { fill: '#264653' } },
      { op: 'ellipse', id: 'hole', cx: 400, cy: 300, rx: 50 },
      { op: 'boolean', mode: 'subtract', ids: ['plate', 'hole'], id: 'ring' },
    ],
  ],
  handler(input, ctx) {
    const ids = resolveIds(ctx, input.ids);
    if (ids.length < 2) throw new EngineError('invalid_input', 'boolean needs at least two different shapes', 'List two or more ids.');
    if (topmost(ctx, ids).length !== ids.length) {
      throw new EngineError('invalid_structure', 'one operand sits inside another operand', 'Use the group alone, or the paths inside it, but not both.');
    }
    let acc: Shape = shapeOf(ctx, ids[0]!);
    for (const id of ids.slice(1)) acc = booleanOp(input.mode, acc, shapeOf(ctx, id));
    const first = requireNode(ctx.doc, ids[0]!);
    const P = first.parent === null ? IDENTITY : worldTransform(ctx.doc, first.parent);
    const Pinv = invert(P);
    if (!Pinv) throw new EngineError('invalid_structure', `the group holding "${first.id}" is squashed flat (scale 0)`, 'Give that group a non-zero scale first.');
    if (acc.subpaths.length === 0) ctx.warn('empty_result', `${input.mode} of ${ids.join(', ')} covers no area`);
    const keep = input.keep ?? false;
    const style = ctx.style(input.style ?? (first.type === 'path' ? first.style : {}));
    const consumed = new Set(keep ? [] : ids);
    const id = ctx.newId(input.id, 'boolean', { releasing: consumed, quiet: input.id !== undefined && consumed.has(input.id) });
    const list = siblings(ctx.doc, first);
    const at = list.indexOf(first.id);
    const removedBelow = list.slice(0, at).filter((x) => consumed.has(x)).length;
    const node: PathNode = {
      id,
      type: 'path',
      parent: first.parent,
      transform: IDENTITY,
      style,
      fillRule: 'nonzero',
      subpaths: applyToSubpaths(Pinv, acc.subpaths),
      meta: { source: { kind: 'boolean', mode: input.mode, ids } },
    };
    ctx.update((d) => {
      for (const x of consumed) if (Object.hasOwn(d.nodes, x)) removeSubtree(d, x);
      insertNode(d, node, keep ? at + 1 : at - removedBelow);
    });
    return { id };
  },
});
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run packages/engine/test/ops/boolean.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/ops/boolean.ts packages/engine/test/ops/boolean.test.ts
git commit -m "feat(ops): boolean op (union, subtract, intersect, exclude) across parents" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `transform`

**Files:**
- Create: `packages/engine/src/ops/transform.ts`
- Test: `packages/engine/test/ops/transform.test.ts`

**Interfaces:**
- Consumes:
  - `compose`, `rotate`, `scale`, `skewX`, `skewY`, `translate`, `applyToPoint`, `IDENTITY` from geometry
  - `common.ts` (`AnchorInput`, `PointInput`, `anchorPoint`, `applyWorld`, `point`, `resolveIds`, `selectionBounds`, `topmost`)
  - `worldBounds`, `worldTransform`
- Produces: op `transform { ids, translate?, rotate?, scale?, skew?, matrix?, pivot?, around? }`.

- [ ] **Step 1: Write the failing test**

`packages/engine/test/ops/transform.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { rotate as rot, scale as sc } from '../../src/geometry/transform.ts';
import type { Box } from '../../src/geometry/types.ts';
import { executeBatch, Registry, type BatchResult } from '../../src/ops/registry.ts';
import { rect } from '../../src/ops/shapes.ts';
import { group } from '../../src/ops/structure.ts';
import { transform } from '../../src/ops/transform.ts';
import { createDocument, type Doc } from '../../src/scene/model.ts';
import { worldBounds } from '../../src/scene/query.ts';
import { docOf, expectIntact, groupNode, pathNode } from '../fixtures.ts';
import { square } from '../geometry/helpers.ts';

const registry = new Registry().register(rect, group, transform);
function run(ops: unknown[], doc: Doc = createDocument({ width: 800, height: 600 })): BatchResult {
  const r = executeBatch(registry, doc, ops);
  expectIntact(r.doc);
  return r;
}
const bar = { op: 'rect', id: 'bar', x: 0, y: 0, width: 20, height: 10 };
const close = (b: Box | null, e: Box) => {
  for (const k of ['x', 'y', 'width', 'height'] as const) expect(b![k]).toBeCloseTo(e[k], 9);
};

describe('ops/transform', () => {
  it('translates by canvas units or percent', () => {
    const r = run([bar, { op: 'transform', ids: ['bar'], translate: [10, '1%'] }]);
    expect(r.results[1]).toMatchObject({ id: 'bar', bounds: { x: 10, y: 6, width: 20, height: 10 } });
  });

  it('rotates about the node center by default', () => {
    const r = run([bar, { op: 'transform', ids: ['bar'], rotate: 90 }]);
    close(worldBounds(r.doc, 'bar'), { x: 5, y: -5, width: 10, height: 20 });
  });

  it('scales about a named anchor or an explicit point', () => {
    close(worldBounds(run([bar, { op: 'transform', ids: ['bar'], scale: 2, pivot: 'top-left' }]).doc, 'bar'), { x: 0, y: 0, width: 40, height: 20 });
    close(worldBounds(run([bar, { op: 'transform', ids: ['bar'], scale: [1, -1], pivot: [0, 0] }]).doc, 'bar'), { x: 0, y: -10, width: 20, height: 10 });
  });

  it('around "selection" turns several nodes about their combined center', () => {
    const r = run([bar, { op: 'rect', id: 'b2', x: 30, y: 0, width: 10, height: 10 }, { op: 'transform', ids: ['bar', 'b2'], rotate: 180, around: 'selection' }]);
    close(worldBounds(r.doc, 'b2'), { x: 0, y: 0, width: 10, height: 10 });
    close(worldBounds(r.doc, 'bar'), { x: 20, y: 0, width: 20, height: 10 });
  });

  it('translates a child of a scaled group by canvas units', () => {
    const doc = docOf([groupNode('g', ['p'], { transform: sc(3) }), pathNode('p', [square(0, 0, 10)], { parent: 'g', transform: rot(15) })]);
    const before = worldBounds(doc, 'p')!;
    const after = worldBounds(run([{ op: 'transform', ids: ['p'], translate: [10, 0] }], doc).doc, 'p')!;
    expect(after.x - before.x).toBeCloseTo(10, 9);
    expect(after.width).toBeCloseTo(before.width, 9);
  });

  it('skips nodes whose ancestor is selected, with a warning; nothing to do is a warning', () => {
    const r = run([bar, { op: 'group', id: 'g', ids: ['bar'] }, { op: 'transform', ids: ['g', 'bar'], translate: [5, 0] }]);
    expect(worldBounds(r.doc, 'bar')!.x).toBeCloseTo(5, 9);
    expect(r.results[2]).toMatchObject({ warnings: [{ code: 'skipped_descendants' }] });
    expect(run([bar, { op: 'transform', ids: ['bar'] }]).results[1]).toMatchObject({ warnings: [{ code: 'no_change' }] });
  });

  it('rejects a zero scale', () => {
    expect(run([bar, { op: 'transform', ids: ['bar'], scale: 0 }]).results[1]).toMatchObject({ error: { code: 'invalid_input' } });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run packages/engine/test/ops/transform.test.ts`
Expected: FAIL. `Cannot find module '../../src/ops/transform.ts'`.

- [ ] **Step 3: Write `ops/transform.ts`**

`packages/engine/src/ops/transform.ts`:

```ts
import { z } from 'zod';
import { compose, IDENTITY, rotate, scale, skewX, skewY, translate } from '../geometry/transform.ts';
import type { Box, Mat6, Vec2 } from '../geometry/types.ts';
import { AnchorInput, anchorPoint, applyWorld, boundsOf, point, PointInput, resolveIds, selectionBounds, topmost } from './common.ts';
import { defineOp } from './registry.ts';

const nonZero = z.number().refine((v) => v !== 0, 'scale must not be 0 (that flattens the node)');
const num = z.number();

export const transform = defineOp({
  name: 'transform',
  domain: 'transform',
  description:
    'Moves, rotates (degrees, clockwise), scales, skews (degrees [x, y]) or applies a matrix [a, b, c, d, e, f] to nodes, in canvas space. ' +
    'pivot is an anchor ("center", "top-left", …) or a point [x, y]; around "each" (default) uses each node\'s own bounds, "selection" their combined bounds. ' +
    'Order: matrix, scale, skew, rotate (about the pivot), then translate.',
  schema: z.strictObject({
    ids: z.array(z.string()).min(1).max(1000),
    translate: PointInput.optional(),
    rotate: z.number().optional(),
    scale: z.union([nonZero, z.tuple([nonZero, nonZero])]).optional(),
    skew: z.tuple([num, num]).optional(),
    matrix: z.tuple([num, num, num, num, num, num]).optional(),
    pivot: z.union([AnchorInput, PointInput]).optional(),
    around: z.enum(['each', 'selection']).optional(),
  }),
  examples: [
    [
      { op: 'rect', id: 'card', x: 300, y: 250, width: 200, height: 100, style: { fill: '#e9c46a' } },
      { op: 'transform', ids: ['card'], rotate: -8, translate: [20, 0] },
    ],
  ],
  handler(input, ctx) {
    const all = resolveIds(ctx, input.ids);
    const ids = topmost(ctx, all);
    if (ids.length < all.length) ctx.warn('skipped_descendants', `${all.length - ids.length} node(s) already move with a selected group`);
    const has = input.translate || input.rotate !== undefined || input.scale !== undefined || input.skew || input.matrix;
    if (!has) {
      ctx.warn('no_change', 'transform was given nothing to do');
      return ids.length === 1 ? { id: ids[0]! } : { ids };
    }
    const [sx, sy] = typeof input.scale === 'number' ? [input.scale, input.scale] : (input.scale ?? [1, 1]);
    const [kx, ky] = input.skew ?? [0, 0];
    const t = input.translate ? point(ctx, input.translate) : ([0, 0] as Vec2);
    const pivotOf = (box: Box): Vec2 =>
      Array.isArray(input.pivot) ? point(ctx, input.pivot as [number | string, number | string]) : anchorPoint(box, (input.pivot as Parameters<typeof anchorPoint>[1]) ?? 'center');
    const delta = (p: Vec2): Mat6 =>
      compose(translate(t[0], t[1]), translate(p[0], p[1]), rotate(input.rotate ?? 0), skewX(kx), skewY(ky), scale(sx, sy), translate(-p[0], -p[1]), (input.matrix as Mat6 | undefined) ?? IDENTITY);
    if (input.around === 'selection') {
      const D = delta(pivotOf(selectionBounds(ctx, ids)));
      for (const id of ids) applyWorld(ctx, id, D);
    } else {
      for (const id of ids) applyWorld(ctx, id, delta(pivotOf(boundsOf(ctx, id))));
    }
    return ids.length === 1 ? { id: ids[0]! } : { ids };
  },
});
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run packages/engine/test/ops/transform.test.ts`
Expected: PASS (7 tests). If `pivot: 'center'` on an empty node throws via `boundsOf`, that is intended (`invalid_structure`); the tests do not cover it.

- [ ] **Step 5: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/ops/transform.ts packages/engine/test/ops/transform.test.ts
git commit -m "feat(ops): transform op with anchor or point pivots in canvas space" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Spatial index and layout ops (`place`, `align`, `distribute`, `snap`)

**Files:**
- Modify: `pnpm-workspace.yaml` (catalog `rbush: ^4.0.1`), `packages/engine/package.json` (+ `rbush`)
- Create: `packages/engine/src/analysis/spatial-index.ts`, `packages/engine/src/ops/layout.ts`
- Test: `packages/engine/test/ops/layout.test.ts`

**Interfaces:**
- Consumes: `worldBounds`, `subtreeIds`, the `common.ts` helpers.
- Produces:
  - `type Indexed = { minX; minY; maxX; maxY; id }`
  - `indexBounds(doc, exclude: ReadonlySet<string>): RBush<Indexed>`
  - `bandQuery(tree, axis: 'x' | 'y', from: number, to: number): Indexed[]`
  - ops:
    - `place { ids, relative_to, anchor?, target_anchor?, offset? }`
    - `align { ids, edge, to? }`
    - `distribute { ids, axis, mode? }`
    - `snap { ids, tolerance?, to?, grid?, targets? }`

- [ ] **Step 1: Add the dependency**

Add `rbush: ^4.0.1` to the catalog in `pnpm-workspace.yaml`, after `pino`, and add `"rbush": "catalog:"` to `packages/engine/package.json` dependencies. Then run `pnpm install`.
Expected: exit 0.

- [ ] **Step 2: Write the failing test**

`packages/engine/test/ops/layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { scale, translate } from '../../src/geometry/transform.ts';
import type { Box } from '../../src/geometry/types.ts';
import { align, distribute, place, snap } from '../../src/ops/layout.ts';
import { executeBatch, Registry, type BatchResult } from '../../src/ops/registry.ts';
import { rect } from '../../src/ops/shapes.ts';
import { createDocument, type Doc } from '../../src/scene/model.ts';
import { worldBounds } from '../../src/scene/query.ts';
import { docOf, expectIntact, groupNode, pathNode } from '../fixtures.ts';
import { square } from '../geometry/helpers.ts';

const registry = new Registry().register(rect, place, align, distribute, snap);
function run(ops: unknown[], doc: Doc = createDocument({ width: 800, height: 600 })): BatchResult {
  const r = executeBatch(registry, doc, ops);
  expectIntact(r.doc);
  return r;
}
const box = (id: string, x: number, y: number, w = 20, h = 10) => ({ op: 'rect', id, x, y, width: w, height: h });
const at = (r: BatchResult, id: string) => worldBounds(r.doc, id) as Box;

describe('ops/layout: place', () => {
  it('places an anchor on the canvas with an offset', () => {
    const r = run([box('sun', 0, 0, 40, 40), { op: 'place', ids: ['sun'], relative_to: 'canvas', anchor: 'top-right', offset: [-20, 20] }]);
    expect(r.results[1]).toMatchObject({ id: 'sun', bounds: { x: 740, y: 20, width: 40, height: 40 } });
  });

  it('places relative to another node: my top sits on its bottom', () => {
    const r = run([box('a', 100, 100), box('b', 0, 0), { op: 'place', ids: ['b'], relative_to: 'a', anchor: 'top', target_anchor: 'bottom', offset: [0, 5] }]);
    expect(at(r, 'b')).toEqual({ x: 100, y: 115, width: 20, height: 10 });
  });

  it('place works for a child of a transformed group', () => {
    const doc = docOf([groupNode('g', ['p'], { transform: scale(2) }), pathNode('p', [square(0, 0, 10)], { parent: 'g', transform: translate(5, 5) })]);
    const r = run([{ op: 'place', ids: ['p'], relative_to: 'canvas', anchor: 'center' }], doc);
    const b = at(r, 'p');
    expect(b.x + b.width / 2).toBeCloseTo(400, 9);
    expect(b.y + b.height / 2).toBeCloseTo(300, 9);
  });

  it('rejects placing a node relative to itself', () => {
    expect(run([box('a', 0, 0), { op: 'place', ids: ['a'], relative_to: 'a' }]).results[1]).toMatchObject({ error: { code: 'invalid_input' } });
  });
});

describe('ops/layout: align and distribute', () => {
  it('aligns left edges and centers, to the selection or the canvas', () => {
    const r = run([box('a', 10, 0), box('b', 50, 30, 40), { op: 'align', ids: ['a', 'b'], edge: 'left' }]);
    expect([at(r, 'a').x, at(r, 'b').x]).toEqual([10, 10]);
    const c = run([box('a', 10, 0), { op: 'align', ids: ['a'], edge: 'center-x', to: 'canvas' }]);
    expect(at(c, 'a').x).toBe(390);
  });

  it('distributes equal gaps, keeping the outer nodes', () => {
    const r = run([box('a', 0, 0, 10), box('b', 15, 0, 30), box('c', 90, 0, 10), { op: 'distribute', ids: ['c', 'a', 'b'], axis: 'x' }]);
    expect([at(r, 'a').x, at(r, 'b').x, at(r, 'c').x]).toEqual([0, 35, 90]);
  });

  it('distributes centers evenly', () => {
    const r = run([box('a', 0, 0, 10), box('b', 5, 0, 30), box('c', 90, 0, 10), { op: 'distribute', ids: ['a', 'b', 'c'], axis: 'x', mode: 'center' }]);
    expect(at(r, 'b').x + 15).toBeCloseTo(50, 9);
  });
});

describe('ops/layout: snap', () => {
  it('snaps an edge to a nearby node edge within tolerance', () => {
    const r = run([box('wall', 100, 0, 10, 200), box('door', 113, 50), { op: 'snap', ids: ['door'] }]);
    expect(at(r, 'door').x).toBe(110);
  });

  it('snaps to the canvas and to a grid', () => {
    expect(at(run([box('a', 4, 300), { op: 'snap', ids: ['a'], to: ['canvas'] }]), 'a').x).toBe(0);
    expect(at(run([box('a', 23, 47), { op: 'snap', ids: ['a'], to: ['grid'], grid: 25 }]), 'a')).toMatchObject({ x: 25, y: 50 });
  });

  it('warns when nothing is within tolerance', () => {
    expect(run([box('a', 300, 300), { op: 'snap', ids: ['a'], tolerance: 2 }]).results[1]).toMatchObject({ warnings: [{ code: 'nothing_to_snap' }] });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm exec vitest run packages/engine/test/ops/layout.test.ts`
Expected: FAIL. `Cannot find module '../../src/ops/layout.ts'`.

- [ ] **Step 4: Write `analysis/spatial-index.ts`**

`packages/engine/src/analysis/spatial-index.ts`:

```ts
import RBush from 'rbush';
import type { Doc } from '../scene/model.ts';
import { worldBounds } from '../scene/query.ts';

export type Indexed = { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number; readonly id: string };

/** An R-tree of every node's world bounds, except the excluded ids. */
export function indexBounds(doc: Doc, exclude: ReadonlySet<string>): RBush<Indexed> {
  const items: Indexed[] = [];
  for (const id of Object.keys(doc.nodes)) {
    if (exclude.has(id)) continue;
    const b = worldBounds(doc, id);
    if (b) items.push({ minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height, id });
  }
  const tree = new RBush<Indexed>();
  tree.load(items);
  return tree;
}

/** Every node whose bounds overlap the band from..to across the whole other axis. */
export function bandQuery(tree: RBush<Indexed>, axis: 'x' | 'y', from: number, to: number): Indexed[] {
  return axis === 'x'
    ? tree.search({ minX: from, maxX: to, minY: -Infinity, maxY: Infinity })
    : tree.search({ minX: -Infinity, maxX: Infinity, minY: from, maxY: to });
}
```

- [ ] **Step 5: Write `ops/layout.ts`**

`packages/engine/src/ops/layout.ts`:

```ts
import { z } from 'zod';
import { bandQuery, indexBounds } from '../analysis/spatial-index.ts';
import { EngineError } from '../errors.ts';
import { translate } from '../geometry/transform.ts';
import type { Box } from '../geometry/types.ts';
import { subtreeIds } from '../scene/query.ts';
import { AnchorInput, anchorPoint, applyWorld, boundsOf, point, PointInput, resolveIds, selectionBounds, topmost } from './common.ts';
import { defineOp, type OpContext } from './registry.ts';

const canvasBox = (ctx: OpContext): Box => ({ x: 0, y: 0, width: ctx.doc.canvas.width, height: ctx.doc.canvas.height });
const moveAll = (ctx: OpContext, ids: readonly string[], dx: number, dy: number) => {
  if (dx !== 0 || dy !== 0) for (const id of ids) applyWorld(ctx, id, translate(dx, dy));
};
const result = (ids: readonly string[]) => (ids.length === 1 ? { id: ids[0]! } : { ids });

/** The reference box: "canvas", a node id, or (undefined) the selection itself. */
function referenceBox(ctx: OpContext, ref: string | undefined, ids: readonly string[]): Box {
  if (ref === undefined) return selectionBounds(ctx, ids);
  if (ref === 'canvas') return canvasBox(ctx);
  const id = ctx.node(ref).id;
  if (ids.includes(id)) throw new EngineError('invalid_input', `"${id}" cannot be its own reference`, 'Use another node or "canvas" as the reference.');
  return boundsOf(ctx, id);
}

export const place = defineOp({
  name: 'place',
  domain: 'layout',
  description:
    'Moves nodes (as one unit) so their `anchor` lands on the `target_anchor` of `relative_to` (a node id or "canvas"), plus offset [dx, dy]. ' +
    'Anchors: top-left, top, top-right, left, center, right, bottom-left, bottom, bottom-right; target_anchor defaults to anchor.',
  schema: z.strictObject({
    ids: z.array(z.string()).min(1).max(1000),
    relative_to: z.string(),
    anchor: AnchorInput.optional(),
    target_anchor: AnchorInput.optional(),
    offset: PointInput.optional(),
  }),
  examples: [
    [
      { op: 'ellipse', id: 'sun', cx: 0, cy: 0, rx: 50, style: { fill: '#ffb703' } },
      { op: 'place', ids: ['sun'], relative_to: 'canvas', anchor: 'top-right', offset: [-40, 40] },
    ],
  ],
  handler(input, ctx) {
    const ids = topmost(ctx, resolveIds(ctx, input.ids));
    const ref = referenceBox(ctx, input.relative_to, ids);
    const anchor = input.anchor ?? 'center';
    const from = anchorPoint(selectionBounds(ctx, ids), anchor);
    const to = anchorPoint(ref, input.target_anchor ?? anchor);
    const [ox, oy] = input.offset ? point(ctx, input.offset) : [0, 0];
    moveAll(ctx, ids, to[0] + ox - from[0], to[1] + oy - from[1]);
    return result(ids);
  },
});

const EDGES = ['left', 'right', 'top', 'bottom', 'center-x', 'center-y'] as const;
type Edge = (typeof EDGES)[number];
const edgeValue = (b: Box, e: Edge) =>
  e === 'left' ? b.x : e === 'right' ? b.x + b.width : e === 'top' ? b.y : e === 'bottom' ? b.y + b.height : e === 'center-x' ? b.x + b.width / 2 : b.y + b.height / 2;

export const align = defineOp({
  name: 'align',
  domain: 'layout',
  description: 'Lines nodes up on one edge or center ("left", "right", "top", "bottom", "center-x", "center-y") of `to`: the selection (default), "canvas" or a node id.',
  schema: z.strictObject({ ids: z.array(z.string()).min(1).max(1000), edge: z.enum(EDGES), to: z.string().optional() }),
  examples: [
    [
      { op: 'rect', id: 'a', x: 100, y: 100, width: 80, height: 40 },
      { op: 'rect', id: 'b', x: 140, y: 200, width: 120, height: 40 },
      { op: 'align', ids: ['a', 'b'], edge: 'center-x', to: 'canvas' },
    ],
  ],
  handler(input, ctx) {
    const ids = topmost(ctx, resolveIds(ctx, input.ids));
    const target = edgeValue(referenceBox(ctx, input.to, ids), input.edge);
    const horizontal = input.edge === 'left' || input.edge === 'right' || input.edge === 'center-x';
    for (const id of ids) {
      const d = target - edgeValue(boundsOf(ctx, id), input.edge);
      moveAll(ctx, [id], horizontal ? d : 0, horizontal ? 0 : d);
    }
    return result(ids);
  },
});

export const distribute = defineOp({
  name: 'distribute',
  domain: 'layout',
  description: 'Spreads nodes along an axis ("x" or "y") between the first and last: mode "gap" (default) makes equal gaps, "center" equal center spacing.',
  schema: z.strictObject({ ids: z.array(z.string()).min(3).max(1000), axis: z.enum(['x', 'y']), mode: z.enum(['gap', 'center']).optional() }),
  examples: [
    [
      { op: 'rect', id: 'p1', x: 100, y: 280, width: 40, height: 40 },
      { op: 'rect', id: 'p2', x: 180, y: 280, width: 80, height: 40 },
      { op: 'rect', id: 'p3', x: 600, y: 280, width: 40, height: 40 },
      { op: 'distribute', ids: ['p1', 'p2', 'p3'], axis: 'x' },
    ],
  ],
  handler(input, ctx) {
    const ids = topmost(ctx, resolveIds(ctx, input.ids));
    if (ids.length < 3) throw new EngineError('invalid_input', 'distribute needs at least three different nodes', 'With two nodes, use align or place.');
    const x = input.axis === 'x';
    const items = ids.map((id) => {
      const b = boundsOf(ctx, id);
      return { id, start: x ? b.x : b.y, size: x ? b.width : b.height };
    });
    const mode = input.mode ?? 'gap';
    items.sort((a, b) => (mode === 'gap' ? a.start - b.start : a.start + a.size / 2 - (b.start + b.size / 2)));
    const first = items[0]!, last = items.at(-1)!;
    const n = items.length;
    if (mode === 'gap') {
      const span = last.start + last.size - first.start;
      const gap = (span - items.reduce((s, i) => s + i.size, 0)) / (n - 1);
      let cursor = first.start;
      for (const item of items) {
        const d = cursor - item.start;
        moveAll(ctx, [item.id], x ? d : 0, x ? 0 : d);
        cursor += item.size + gap;
      }
    } else {
      const c0 = first.start + first.size / 2, c1 = last.start + last.size / 2;
      items.forEach((item, k) => {
        const d = c0 + ((c1 - c0) * k) / (n - 1) - (item.start + item.size / 2);
        moveAll(ctx, [item.id], x ? d : 0, x ? 0 : d);
      });
    }
    return { ids };
  },
});

export const snap = defineOp({
  name: 'snap',
  domain: 'layout',
  description:
    'Nudges nodes (as one unit) so a near edge or center lines up with other nodes ("nodes"), the canvas ("canvas") or a grid ("grid", spacing `grid`), within `tolerance` px (default 8).',
  schema: z.strictObject({
    ids: z.array(z.string()).min(1).max(1000),
    tolerance: z.number().positive().optional(),
    to: z.array(z.enum(['nodes', 'canvas', 'grid'])).min(1).optional(),
    grid: z.number().positive().optional(),
    targets: z.array(z.string()).optional(),
  }),
  examples: [
    [
      { op: 'rect', id: 'wall', x: 300, y: 100, width: 20, height: 300 },
      { op: 'rect', id: 'shelf', x: 324, y: 200, width: 120, height: 10 },
      { op: 'snap', ids: ['shelf'] },
    ],
  ],
  handler(input, ctx) {
    const ids = topmost(ctx, resolveIds(ctx, input.ids));
    const tol = input.tolerance ?? 8;
    const to = new Set(input.to ?? ['nodes', 'canvas']);
    if (to.has('grid') && input.grid === undefined) throw new EngineError('invalid_input', 'snapping to the grid needs `grid` spacing', 'Add grid, e.g. 10.');
    const b = selectionBounds(ctx, ids);
    const moving = new Set(ids.flatMap((id) => subtreeIds(ctx.doc, id)));
    const only = input.targets ? new Set(resolveIds(ctx, input.targets)) : undefined;
    const tree = to.has('nodes') ? indexBounds(ctx.doc, moving) : undefined;
    const best = (axis: 'x' | 'y'): number => {
      const lo = axis === 'x' ? b.x : b.y, size = axis === 'x' ? b.width : b.height;
      const features = [lo, lo + size / 2, lo + size];
      const cands: number[] = [];
      if (tree) {
        for (const n of bandQuery(tree, axis, lo - tol, lo + size + tol)) {
          if (only && !only.has(n.id)) continue;
          const [a, z2] = axis === 'x' ? [n.minX, n.maxX] : [n.minY, n.maxY];
          cands.push(a, (a + z2) / 2, z2);
        }
      }
      if (to.has('canvas')) {
        const full = axis === 'x' ? ctx.doc.canvas.width : ctx.doc.canvas.height;
        cands.push(0, full / 2, full);
      }
      if (to.has('grid')) for (const f of features) cands.push(Math.round(f / input.grid!) * input.grid!);
      let shift = Number.NaN;
      for (const f of features) for (const c of cands) if (Math.abs(c - f) <= tol && !(Math.abs(c - f) >= Math.abs(shift))) shift = c - f;
      return Number.isNaN(shift) ? 0 : shift;
    };
    const dx = best('x'), dy = best('y');
    if (dx === 0 && dy === 0) ctx.warn('nothing_to_snap', `no edge or center within ${tol} px`);
    moveAll(ctx, ids, dx, dy);
    return result(ids);
  },
});
```

Notes for the implementer:
- `best` keeps the smallest |shift|. An exact alignment (shift 0) already in place wins, and counts as "nothing to move".
- The test `snaps to the canvas and to a grid` expects x 23 → 25 and y 47 → 50. The features 23, 33 and 43 are each within 8 of a grid line, and the closest shift wins: 23 → 25 (2), 33 → 25 (−8), 43 → 50 (7). That gives +2.

- [ ] **Step 6: Run it to verify it passes**

Run: `pnpm exec vitest run packages/engine/test/ops/layout.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 7: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both exit 0. If `rbush`'s types export the class under a different shape, adjust the import (`import RBush from 'rbush'`) to match its `index.d.ts`, and ledger the change.

- [ ] **Step 8: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml packages/engine/package.json packages/engine/src/analysis/spatial-index.ts packages/engine/src/ops/layout.ts packages/engine/test/ops/layout.test.ts
git commit -m "feat(ops): place, align, distribute and rbush-backed snap" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Structure ops (`reorder`, `duplicate`, `rename`, `ungroup`, `clip`)

**Files:**
- Modify: `packages/engine/src/scene/model.ts` (`ClipShape`, `NodeBase.clip`, schema), `packages/engine/src/scene/query.ts` (bounds respect clip), `packages/engine/src/render/svg.ts` (clipPath), `packages/engine/src/ops/structure.ts`
- Test: `packages/engine/test/ops/structure2.test.ts`

**Interfaces:**
- Consumes: `common.ts`, the store helpers, `shapeOf`, `invert`, `applyToSubpaths`, `pathBounds`.
- Produces:
  - `type ClipShape = { readonly subpaths: readonly Subpath[]; readonly fillRule: FillRule }`
  - `NodeBase.clip?: ClipShape`
  - ops:
    - `reorder { ids, to: 'front' | 'back' | 'forward' | 'backward' | 'above' | 'below', relative? }`
    - `duplicate { ids, offset?, id? }`
    - `rename { id, to }`
    - `ungroup { ids }`
    - `clip { id, shape: string | null, keep? }`

- [ ] **Step 1: Write the failing test**

`packages/engine/test/ops/structure2.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../src/ops/index.ts';
import { executeBatch, type BatchResult } from '../../src/ops/registry.ts';
import { duplicate, rename, reorder, ungroup, clip } from '../../src/ops/structure.ts';
import { rasterize } from '../../src/render/raster.ts';
import { toSvg } from '../../src/render/svg.ts';
import { createDocument, type Doc, type GroupNode } from '../../src/scene/model.ts';
import { worldBounds } from '../../src/scene/query.ts';
import { expectIntact } from '../fixtures.ts';

const registry = createRegistry();
function run(ops: unknown[], doc: Doc = createDocument({ width: 200, height: 100, background: '#ffffff' })): BatchResult {
  const r = executeBatch(registry, doc, ops);
  expectIntact(r.doc);
  return r;
}
const four = ['a', 'b', 'c', 'd'].map((id, i) => ({ op: 'rect', id, x: i * 20, y: 0, width: 10, height: 10 }));

describe('ops/reorder', () => {
  it.each([
    [{ to: 'front', ids: ['a', 'b'] }, ['c', 'd', 'a', 'b']],
    [{ to: 'back', ids: ['d'] }, ['d', 'a', 'b', 'c']],
    [{ to: 'forward', ids: ['a'] }, ['b', 'a', 'c', 'd']],
    [{ to: 'backward', ids: ['c', 'd'] }, ['a', 'c', 'd', 'b']],
    [{ to: 'above', ids: ['a'], relative: 'c' }, ['b', 'c', 'a', 'd']],
    [{ to: 'below', ids: ['d'], relative: 'b' }, ['a', 'd', 'b', 'c']],
  ])('%o', (args, root) => {
    expect(run([...four, { op: 'reorder', ...args }]).doc.root).toEqual(root);
  });
});

describe('ops/duplicate and rename', () => {
  it('duplicate copies a subtree above the original with fresh ids and an offset', () => {
    const r = run([...four, { op: 'group', id: 'g', ids: ['a', 'b'] }, { op: 'duplicate', ids: ['g'], offset: [0, 50] }]);
    expect(r.doc.root).toEqual(['c', 'd', 'g', 'g-2']);
    expect((r.doc.nodes['g-2'] as GroupNode).children).toEqual(['a-2', 'b-2']);
    expect(worldBounds(r.doc, 'a-2')).toEqual({ x: 0, y: 50, width: 10, height: 10 });
    expect(r.results[5]).toMatchObject({ id: 'g-2' });
    expect(run([...four, { op: 'duplicate', ids: ['a'], id: 'twin' }, { op: 'style', ids: ['$last'], style: { fill: 'red' } }]).doc.nodes.twin!.style).toEqual({ fill: 'red' });
  });

  it('rename updates every reference and $last', () => {
    const r = run([...four, { op: 'group', id: 'g', ids: ['a', 'b'] }, { op: 'rename', id: 'g', to: 'pair' }, { op: 'rename', id: 'a', to: 'first' }]);
    expect(r.doc.root).toEqual(['c', 'd', 'pair']);
    expect((r.doc.nodes.pair as GroupNode).children).toEqual(['first', 'b']);
    expect(r.doc.nodes.first!.parent).toBe('pair');
    const last = run([{ op: 'rect', id: 'x', x: 0, y: 0, width: 5, height: 5 }, { op: 'rename', id: 'x', to: 'y' }, { op: 'style', ids: ['$last'], style: { fill: 'red' } }]);
    expect(last.doc.nodes.y!.style).toEqual({ fill: 'red' });
    expect(run([...four, { op: 'rename', id: 'a', to: 'b' }]).results[4]).toMatchObject({ error: { code: 'invalid_input' } });
  });
});

describe('ops/ungroup', () => {
  it('releases children in place, keeping world placement, inherited style and opacity', () => {
    const r = run([
      ...four,
      { op: 'group', id: 'g', ids: ['b', 'c'] },
      { op: 'style', ids: ['g'], style: { fill: 'teal', opacity: 0.5 } },
      { op: 'transform', ids: ['g'], translate: [5, 5] },
      { op: 'ungroup', ids: ['g'] },
    ]);
    expect(r.doc.root).toEqual(['a', 'b', 'c', 'd']);
    expect(worldBounds(r.doc, 'b')).toEqual({ x: 25, y: 5, width: 10, height: 10 });
    expect(r.doc.nodes.b!.style).toEqual({ fill: 'teal', opacity: 0.5 });
    expect(r.results[7]).toMatchObject({ ids: ['b', 'c'] });
  });
});

describe('ops/clip', () => {
  it('clips a node to another shape: bounds shrink, SVG gets a clipPath, pixels outside vanish', () => {
    const r = run([
      { op: 'rect', id: 'photo', x: 0, y: 0, width: 200, height: 100, style: { fill: '#e76f51' } },
      { op: 'ellipse', id: 'frame', cx: 100, cy: 50, rx: 40 },
      { op: 'clip', id: 'photo', shape: 'frame' },
    ]);
    expect(r.doc.nodes.frame).toBeUndefined();
    expect(r.results[2]).toMatchObject({ id: 'photo', bounds: { x: 60, y: 10, width: 80, height: 80 } });
    expect(toSvg(r.doc)).toContain('<clipPath id="__clip_photo">');
    expect(toSvg(r.doc)).toContain('clip-path="url(#__clip_photo)"');
    const img = rasterize(r.doc);
    const px = (x: number, y: number) => Array.from(img.pixels.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));
    expect(px(100, 50)).toEqual([231, 111, 81]);
    expect(px(10, 10)).toEqual([255, 255, 255]);
  });

  it('shape null removes the clip; keep leaves the shape node', () => {
    const r = run([
      { op: 'rect', id: 'photo', x: 0, y: 0, width: 200, height: 100 },
      { op: 'ellipse', id: 'frame', cx: 100, cy: 50, rx: 40 },
      { op: 'clip', id: 'photo', shape: 'frame', keep: true },
      { op: 'clip', id: 'photo', shape: null },
    ]);
    expect(r.doc.nodes.frame).toBeDefined();
    expect(r.doc.nodes.photo!.clip).toBeUndefined();
    expect(worldBounds(r.doc, 'photo')).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });

  it('a clip follows its node when the node moves', () => {
    const r = run([
      { op: 'rect', id: 'photo', x: 0, y: 0, width: 200, height: 100 },
      { op: 'ellipse', id: 'frame', cx: 100, cy: 50, rx: 40 },
      { op: 'clip', id: 'photo', shape: 'frame' },
      { op: 'transform', ids: ['photo'], translate: [10, 0] },
    ]);
    expect(worldBounds(r.doc, 'photo')).toMatchObject({ x: 70, width: 80 });
  });
});

describe('ops: structure exports', () => {
  it('exports the new ops', () => {
    expect([reorder.name, duplicate.name, rename.name, ungroup.name, clip.name]).toEqual(['reorder', 'duplicate', 'rename', 'ungroup', 'clip']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run packages/engine/test/ops/structure2.test.ts`
Expected: FAIL. `reorder` and the other new ops are not exported from `structure.ts` (missing-export `SyntaxError` or undefined).

- [ ] **Step 3: Add `clip` to the model, the bounds and the serializer**

In `packages/engine/src/scene/model.ts`:

```ts
/** A clip region in the node's own coordinates (before its transform), as filled geometry. */
export type ClipShape = { readonly subpaths: readonly Subpath[]; readonly fillRule: FillRule };
```

Add `readonly clip?: ClipShape;` to `NodeBase`. Add `clip: z.strictObject({ subpaths: z.array(SubpathSchema), fillRule: z.enum(['nonzero', 'evenodd']) }).optional(),` to `nodeBase` in the schema.

In `packages/engine/src/scene/query.ts`, wrap the bounds computation: compute the unclipped box as before, then intersect it with the clip's world box when `node.clip` is set. Replace the body of `worldBounds` with:

```ts
export function worldBounds(doc: Doc, id: string): Box | null {
  const node = requireNode(doc, id);
  const box = unclippedBounds(doc, node);
  if (!box || !node.clip) return box;
  const clipBox = pathBounds(applyToSubpaths(worldTransform(doc, id), node.clip.subpaths));
  return clipBox ? intersectBoxes(box, clipBox) : null;
}

function unclippedBounds(doc: Doc, node: SceneNode): Box | null {
  if (node.type === 'group') {
    return unionBoxes(node.children.map((c) => worldBounds(doc, c)).filter((b): b is Box => b !== null));
  }
  const world = worldTransform(doc, node.id);
  const hit = boundsCache.get(node);
  if (hit && sameMatrix(hit.world, world)) return hit.box;
  const box = pathBounds(applyToSubpaths(world, node.subpaths));
  boundsCache.set(node, { world, box });
  return box;
}

function intersectBoxes(a: Box, b: Box): Box | null {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width), y1 = Math.min(a.y + a.height, b.y + b.height);
  return x1 >= x0 && y1 >= y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}
```

In `packages/engine/src/render/svg.ts`, inside `element()`, emit the clip path before the element and add the attribute. After computing `attrs` (before pushing the style attributes), add:

```ts
  let prefix = '';
  if (node.clip) {
    const rule = node.clip.fillRule === 'evenodd' ? ' clip-rule="evenodd"' : '';
    prefix = `<clipPath id="__clip_${node.id}"><path d="${pathData(node.clip.subpaths, n)}"${rule}/></clipPath>`;
    attrs.push(`clip-path="url(#__clip_${node.id})"`);
  }
```

Return `prefix + …` from both return statements (path and group).

- [ ] **Step 4: Write the structure ops**

Append to `packages/engine/src/ops/structure.ts` (and extend its imports with `castDraft` from immer, `applyToSubpaths`, `compose`, `invert` from geometry/transform, `ClipShape`, `GroupNode`, `SceneNode`, `Style` and `isValidId` from the model, `worldTransform` and `requireNode` from query, and `applyWorld`, `point`, `PointInput`, `resolveIds`, `shapeOf`, `topmost` from `./common.ts`):

```ts
const ORDER = ['front', 'back', 'forward', 'backward', 'above', 'below'] as const;

export const reorder = defineOp({
  name: 'reorder',
  domain: 'structure',
  description: 'Changes stacking order among siblings: "front", "back", "forward" (one step up), "backward", or "above"/"below" the `relative` node.',
  schema: z.strictObject({ ids: z.array(z.string()).min(1).max(1000), to: z.enum(ORDER), relative: z.string().optional() }),
  examples: [
    [
      { op: 'rect', id: 'back', x: 100, y: 100, width: 200, height: 200, style: { fill: '#264653' } },
      { op: 'rect', id: 'front', x: 150, y: 150, width: 200, height: 200, style: { fill: '#e9c46a' } },
      { op: 'reorder', ids: ['back'], to: 'front' },
    ],
  ],
  handler(input, ctx) {
    const ids = resolveIds(ctx, input.ids);
    const parent = ctx.node(ids[0]!).parent;
    if (ids.some((id) => ctx.node(id).parent !== parent)) {
      throw new EngineError('invalid_structure', 'reorder works on siblings only', 'Reorder nodes that share one parent; call reorder once per group.');
    }
    let rel: string | undefined;
    if (input.to === 'above' || input.to === 'below') {
      if (input.relative === undefined) throw new EngineError('invalid_input', `to "${input.to}" needs relative`, 'Name the node to go above or below.');
      rel = ctx.node(input.relative).id;
      if (ctx.node(rel).parent !== parent || ids.includes(rel)) {
        throw new EngineError('invalid_structure', `"${rel}" is not a sibling outside the moved set`, 'Pick a sibling that is not being moved.');
      }
    }
    const chosen = new Set(ids);
    ctx.update((d) => {
      const list = parent === null ? d.root : (d.nodes[parent] as Draft<GroupNode>).children;
      const moving = list.filter((x) => chosen.has(x));
      const rest = list.filter((x) => !chosen.has(x));
      let next: string[];
      if (input.to === 'front') next = [...rest, ...moving];
      else if (input.to === 'back') next = [...moving, ...rest];
      else if (input.to === 'above' || input.to === 'below') {
        const at = rest.indexOf(rel!) + (input.to === 'above' ? 1 : 0);
        next = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
      } else {
        next = [...list];
        const step = input.to === 'forward' ? 1 : -1;
        const order = step === 1 ? [...next.keys()].reverse() : [...next.keys()];
        for (const i of order) {
          if (!chosen.has(next[i]!)) continue;
          const j = i + step;
          if (j < 0 || j >= next.length || chosen.has(next[j]!)) continue;
          [next[i], next[j]] = [next[j]!, next[i]!];
        }
      }
      list.splice(0, list.length, ...next);
    });
    return ids.length === 1 ? { id: ids[0]! } : { ids };
  },
});

export const duplicate = defineOp({
  name: 'duplicate',
  domain: 'structure',
  description: 'Copies nodes (with everything inside) just above the originals, moved by offset [dx, dy]. Copies get fresh ids ("tree" → "tree-2"); `id` names a single copy.',
  schema: z.strictObject({ ids: z.array(z.string()).min(1).max(1000), offset: PointInput.optional(), id: z.string().optional() }),
  examples: [
    [
      { op: 'polygon', id: 'tree', cx: 200, cy: 400, radius: 60, sides: 3, style: { fill: '#2d6a4f' } },
      { op: 'duplicate', ids: ['tree'], offset: [140, 0] },
    ],
  ],
  handler(input, ctx) {
    const ids = topmost(ctx, resolveIds(ctx, input.ids));
    if (input.id !== undefined && ids.length !== 1) throw new EngineError('invalid_input', 'id names one copy, but several nodes are being copied', 'Leave id out, or copy one node.');
    const [dx, dy] = input.offset ? point(ctx, input.offset) : [0, 0];
    const copies: string[] = [];
    for (const src of ids) {
      const original = requireNode(ctx.doc, src);
      const map = new Map<string, string>();
      const walkIds = (id: string): void => {
        const n = requireNode(ctx.doc, id);
        if (n.type === 'group') n.children.forEach(walkIds);
        if (id !== src) map.set(id, ctx.newId(id, id, { quiet: true }));
      };
      walkIds(src);
      const rootId = ctx.newId(ids.length === 1 && input.id !== undefined ? input.id : src, src, { quiet: input.id === undefined });
      map.set(src, rootId);
      const cloneOf = (id: string, parent: string | null): SceneNode[] => {
        const n = requireNode(ctx.doc, id);
        const copy = { ...n, id: map.get(id)!, parent } as SceneNode;
        if (n.type === 'group') {
          const kids = n.children.flatMap((c) => cloneOf(c, map.get(id)!));
          return [{ ...(copy as GroupNode), children: n.children.map((c) => map.get(c)!) }, ...kids];
        }
        return [copy];
      };
      const nodes = cloneOf(src, original.parent);
      ctx.update((d) => {
        const list = original.parent === null ? d.root : (d.nodes[original.parent] as Draft<GroupNode>).children;
        const at = list.indexOf(src) + 1;
        for (const n of nodes) d.nodes[n.id] = castDraft(n);
        list.splice(at, 0, rootId);
      });
      if (dx !== 0 || dy !== 0) applyWorld(ctx, rootId, translate(dx, dy));
      copies.push(rootId);
    }
    ctx.last = copies.at(-1);
    return copies.length === 1 ? { id: copies[0]! } : { ids: copies };
  },
});

export const rename = defineOp({
  name: 'rename',
  domain: 'structure',
  description: 'Gives a node a new id; every reference to it follows.',
  schema: z.strictObject({ id: z.string(), to: z.string() }),
  examples: [[{ op: 'rect', id: 'rect-1', x: 10, y: 10, width: 50, height: 50 }, { op: 'rename', id: 'rect-1', to: 'window' }]],
  handler(input, ctx) {
    const node = ctx.node(input.id);
    const to = input.to;
    if (!isValidId(to)) throw new EngineError('invalid_input', `"${to}" is not a usable id`, 'Ids start with a letter or "_" and use letters, digits, "_", "." or "-".');
    if (to !== node.id && Object.hasOwn(ctx.doc.nodes, to)) throw new EngineError('invalid_input', `id "${to}" is already taken`, 'Pick an unused id, or rename the other node first.');
    const from = node.id;
    ctx.update((d) => {
      const n = d.nodes[from]!;
      delete d.nodes[from];
      n.id = to;
      d.nodes[to] = n;
      const list = n.parent === null ? d.root : (d.nodes[n.parent] as Draft<GroupNode>).children;
      list[list.indexOf(from)] = to;
      if (n.type === 'group') for (const c of n.children) d.nodes[c]!.parent = to;
    });
    if (ctx.last === from) ctx.last = to;
    return { id: to };
  },
});

const INHERITED: readonly (keyof Style)[] = ['fill', 'stroke', 'strokeWidth', 'strokeCap', 'strokeJoin', 'strokeDash', 'miterLimit', 'fillOpacity', 'strokeOpacity'];

export const ungroup = defineOp({
  name: 'ungroup',
  domain: 'structure',
  description: 'Dissolves groups: their children move up into the group\'s place and keep their look (position, inherited style, opacity).',
  schema: z.strictObject({ ids: z.array(z.string()).min(1).max(1000) }),
  examples: [
    [
      { op: 'rect', id: 'a', x: 100, y: 100, width: 50, height: 50 },
      { op: 'rect', id: 'b', x: 200, y: 100, width: 50, height: 50 },
      { op: 'group', id: 'pair', ids: ['a', 'b'] },
      { op: 'ungroup', ids: ['pair'] },
    ],
  ],
  handler(input, ctx) {
    const released: string[] = [];
    for (const id of resolveIds(ctx, input.ids)) {
      const g = ctx.node(id);
      if (g.type !== 'group') throw new EngineError('invalid_structure', `"${id}" is not a group`, 'Ungroup works on groups only.');
      if (g.clip) throw new EngineError('invalid_structure', `"${id}" has a clip that would be lost`, 'Remove the clip first with {"op": "clip", "id": …, "shape": null}.');
      const inherited: Record<string, unknown> = {};
      for (const k of INHERITED) if (g.style[k] !== undefined) inherited[k] = g.style[k];
      const groupOpacity = g.style.opacity;
      ctx.update((d) => {
        const list = g.parent === null ? d.root : (d.nodes[g.parent] as Draft<GroupNode>).children;
        const at = list.indexOf(id);
        list.splice(at, 1, ...g.children);
        for (const c of g.children) {
          const child = d.nodes[c]!;
          child.parent = g.parent;
          child.transform = castDraft(compose(g.transform, requireNode(ctx.doc, c).transform));
          const style: Record<string, unknown> = { ...inherited, ...child.style };
          if (groupOpacity !== undefined) style.opacity = groupOpacity * ((child.style.opacity as number | undefined) ?? 1);
          child.style = castDraft(style as Style);
        }
        delete d.nodes[id];
      });
      released.push(...g.children);
    }
    return { ids: released };
  },
});

export const clip = defineOp({
  name: 'clip',
  domain: 'structure',
  description: 'Clips a node to the filled area of another shape (which is removed unless keep is true); the clip moves with the node. shape null removes the clip.',
  schema: z.strictObject({ id: z.string(), shape: z.string().nullable(), keep: z.boolean().optional() }),
  examples: [
    [
      { op: 'rect', id: 'photo', x: 200, y: 150, width: 400, height: 300, style: { fill: '#8ecae6' } },
      { op: 'ellipse', id: 'frame', cx: 400, cy: 300, rx: 140 },
      { op: 'clip', id: 'photo', shape: 'frame' },
    ],
  ],
  handler(input, ctx) {
    const node = ctx.node(input.id);
    if (input.shape === null) {
      ctx.update((d) => {
        delete d.nodes[node.id]!.clip;
      });
      return { id: node.id };
    }
    const shapeId = ctx.node(input.shape).id;
    if (shapeId === node.id || topmost(ctx, [node.id, shapeId]).length < 2) {
      throw new EngineError('invalid_structure', 'a node cannot be clipped by itself or by something inside it, or clip its own parent', 'Use a separate shape as the clip.');
    }
    const inv = invert(worldTransform(ctx.doc, node.id));
    if (!inv) throw new EngineError('invalid_structure', `"${node.id}" is squashed flat (scale 0)`, 'Give it a non-zero scale first.');
    const shape = shapeOf(ctx, shapeId);
    const clipShape: ClipShape = { subpaths: applyToSubpaths(inv, shape.subpaths), fillRule: shape.fillRule };
    ctx.update((d) => {
      d.nodes[node.id]!.clip = castDraft(clipShape);
      if (!input.keep) removeSubtree(d, shapeId);
    });
    return { id: node.id };
  },
});
```

`duplicate` uses `translate` from `../geometry/transform.ts`. Add `type Draft` to the immer import.

- [ ] **Step 5: Run it to verify it passes, along with the earlier structure tests**

Run: `pnpm exec vitest run packages/engine/test/ops/structure2.test.ts packages/engine/test/ops/structure.test.ts packages/engine/test/render packages/engine/test/scene`
Expected: PASS. If `createRegistry` does not yet include the new ops (Task 8 wires them), this run fails on unknown ops. In that case, do Task 8 Step 1 (registry wiring) first, ledger the reordering, and rerun.

- [ ] **Step 6: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/scene/model.ts packages/engine/src/scene/query.ts packages/engine/src/render/svg.ts packages/engine/src/ops/structure.ts packages/engine/test/ops/structure2.test.ts
git commit -m "feat(ops): reorder, duplicate, rename, ungroup and geometry clips" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Register everything, M4 acceptance, docs

**Files:**
- Modify: `packages/engine/src/ops/index.ts`, `packages/mcp-server/package.json` (+ `rbush`)
- Test: `packages/engine/test/acceptance-m4.test.ts`
- Modify: `docs/superpowers/specs/2026-10-07-agent-illustrator-v1-design.md` (A3 clip refinement, mask moved), `docs/superpowers/plans/2026-10-07-v1-roadmap.md`, `packages/mcp-server/README.md` (op list)

- [ ] **Step 1: Register the ops**

`packages/engine/src/ops/index.ts`:

```ts
import { boolean } from './boolean.ts';
import { align, distribute, place, snap } from './layout.ts';
import { pathCommands, pathFromPoints, roundCornersOp } from './paths.ts';
import { Registry } from './registry.ts';
import { ellipse, line, polygon, rect, star } from './shapes.ts';
import { clip, duplicate, group, remove, rename, reorder, ungroup } from './structure.ts';
import { style } from './style.ts';
import { transform } from './transform.ts';

/** A registry holding every built-in op. */
export function createRegistry(): Registry {
  return new Registry().register(
    rect, ellipse, polygon, star, line,
    pathFromPoints, pathCommands, roundCornersOp,
    boolean, transform,
    place, align, distribute, snap,
    style,
    group, ungroup, reorder, duplicate, rename, clip, remove,
  );
}
```

Update the `createRegistry` expectation in `packages/engine/test/ops/structure.test.ts` to this list:

```ts
expect(registry.names()).toEqual([
  'rect', 'ellipse', 'polygon', 'star', 'line', 'path_from_points', 'path_commands', 'round_corners', 'boolean', 'transform',
  'place', 'align', 'distribute', 'snap', 'style', 'group', 'ungroup', 'reorder', 'duplicate', 'rename', 'clip', 'delete',
]);
```

Also rename that test to `registers every built-in op, and every example runs and ends with its op`. Add `"rbush": "catalog:"` to `packages/mcp-server/package.json` dependencies and run `pnpm install`.

- [ ] **Step 2: Write the M4 acceptance test**

`packages/engine/test/acceptance-m4.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createDocument, createRegistry, executeBatch, integrityProblem, toSvg, validateDocument, worldBounds } from '../src/index.ts';

const registry = createRegistry();
const SCENE = [
  { op: 'rect', id: 'sky', x: 0, y: 0, width: '100%', height: '100%', style: { fill: '#8ecae6' } },
  { op: 'path_commands', id: 'hills', d: 'M0 420 Q200 330 400 400 T800 380 V600 H0 Z', style: { fill: '#52b788' } },
  { op: 'star', id: 'sun', cx: 0, cy: 0, outer: 60, inner: 45, points: 12, style: { fill: '#ffb703' } },
  { op: 'place', ids: ['sun'], relative_to: 'canvas', anchor: 'top-right', offset: [-40, 40] },
  { op: 'rect', id: 'wall', x: 300, y: 330, width: 160, height: 110, style: { fill: '#f4f1de' } },
  { op: 'polygon', id: 'roof', cx: 380, cy: 300, radius: 95, sides: 3, style: { fill: '#e76f51' } },
  { op: 'place', ids: ['roof'], relative_to: 'wall', anchor: 'bottom', target_anchor: 'top' },
  { op: 'rect', id: 'door', x: 0, y: 0, width: 36, height: 60, radius: 6, style: { fill: '#6d597a' } },
  { op: 'place', ids: ['door'], relative_to: 'wall', anchor: 'bottom', target_anchor: 'bottom' },
  { op: 'group', id: 'house', ids: ['wall', 'roof', 'door'] },
  { op: 'path_from_points', id: 'cloud_base', points: [[100, 120], [140, 90], [190, 100], [220, 130]], mode: 'smooth', closed: true, style: { fill: '#ffffff' } },
  { op: 'ellipse', id: 'puff', cx: 160, cy: 100, rx: 35 },
  { op: 'boolean', mode: 'union', ids: ['cloud_base', 'puff'], id: 'cloud' },
  { op: 'duplicate', ids: ['cloud'], offset: [380, 40], id: 'cloud_2' },
  { op: 'transform', ids: ['house'], rotate: -2 },
  { op: 'align', ids: ['cloud', 'cloud_2'], edge: 'top' },
];

describe('M4 acceptance', () => {
  it('every op reports ok with exact world bounds where it targets one node', () => {
    const r = executeBatch(registry, createDocument({ width: 800, height: 600, seed: 3 }), SCENE);
    expect(r.ok).toBe(true);
    expect(integrityProblem(r.doc)).toBeNull();
    for (const [i, outcome] of r.results.entries()) {
      if ('id' in outcome && outcome.id) expect(outcome.bounds, `op ${i} (${outcome.op})`).toEqual(worldBounds(r.doc_atStep ?? r.doc, outcome.id) ?? outcome.bounds);
    }
    expect(worldBounds(r.doc, 'door')!.y + worldBounds(r.doc, 'door')!.height).toBeCloseTo(440, 0);
    expect(validateDocument(JSON.parse(JSON.stringify(r.doc)))).toEqual(r.doc);
  });

  it('is deterministic', () => {
    const a = executeBatch(registry, createDocument({ width: 800, height: 600, seed: 3 }), SCENE);
    const b = executeBatch(registry, createDocument({ width: 800, height: 600, seed: 3 }), SCENE);
    expect(toSvg(a.doc)).toBe(toSvg(b.doc));
  });
});
```

The first test compares each outcome's `bounds` with the final document, but later ops can move a node after its outcome was recorded. Simplify that assertion to the property that matters: every outcome with an `id` has a non-null `bounds` object with finite numbers. Replace the loop body with:

```ts
      if ('id' in outcome && outcome.id) {
        const b = outcome.bounds!;
        expect(b, `op ${i} (${outcome.op})`).not.toBeNull();
        for (const v of [b.x, b.y, b.width, b.height]) expect(Number.isFinite(v)).toBe(true);
      }
```

(Write the test with this loop from the start; the snippet above shows why.)

- [ ] **Step 3: Run the engine suite**

Run: `pnpm exec vitest run packages/engine`
Expected: PASS, all files.

- [ ] **Step 4: Docs**

- In the spec's A3 section, add a bullet under "Refinements in M2": `- M4 (2026-10-08): `clip` stores the clip shape's geometry in the node's local space (`{ subpaths, fillRule }`) instead of a node reference; `mask` moves to M5 with gradients.`
- In `packages/mcp-server/README.md`, replace the "Ops so far" line with the 22 op names grouped as shapes, paths, boolean, transform, layout, style and structure.
- In the roadmap, set M4 to `Done YYYY-MM-DD` and M5 to `Next`.

- [ ] **Step 5: Full verification**

Run: `pnpm check && pnpm build && pnpm smoke`
Expected: everything green.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/ops/index.ts packages/engine/test/ops/structure.test.ts packages/engine/test/acceptance-m4.test.ts packages/mcp-server/package.json pnpm-lock.yaml packages/mcp-server/README.md docs/superpowers/specs/2026-10-07-agent-illustrator-v1-design.md docs/superpowers/plans/2026-10-07-v1-roadmap.md
git commit -m "feat(ops): register the M4 ops; acceptance scene; docs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Follow-ups for later plans (not M4 work)

- **M5:** `mask` (with gradient fades), plus the tokens and gradient ops. Gradients become paints (`url(#id)`) via `defs`.
- **M6:** generators reuse `addPath`, `shapeOf` (scatter inside a shape) and `measure` (repeat along a path).
- **M7:** `lint` reuses `indexBounds` for overlap pairs and near-miss alignment (the same band query as snap).

## Execution record (2026-10-08)

Executed on branch `m4-ops` by small Sonnet implementer agents, at the owner's request, each with a self-contained brief. They ran in three waves: Tasks 1 and 2 in parallel; Tasks 3–6 in parallel on separate files, with `rbush` installed up front by the orchestrator; then Tasks 7 and 8 in sequence. The orchestrator committed each task, kept the ledger and re-ran the full suite between waves. One fresh final reviewer (Opus) went over the whole branch.

**Rulings made during execution**, each with its cost if wrong:
- Task 1: the parser rejects non-finite numbers (`1e999`), with "expected a finite number at position N". *Cost if wrong:* none.
- Task 3: `path_from_points` in polyline mode with only identical points is `invalid_input`, instead of an empty path. *Cost if wrong:* none.
- Task 4: `boolean.id` uses `IdInput`, following the Decision. A result over `maxSegmentsPerPath` is `limit_exceeded`. *Cost if wrong:* none.
- Task 5: a singular `matrix` and a skew of ±90° are refused in the schema, because they flatten the node. An explicit point pivot no longer measures bounds, so it works on an empty group. *Cost if wrong:* a legitimate skew close to 90° gets an error with a hint.
- Task 6: `rbush` 4 ships no types, so a local `analysis/rbush-shim.d.ts` was added; the mcp-server tsconfig includes it.
  - The plan's grid-snap test input moved from y 47 to y 48: at 47, the center shift of −2 beats the top shift of +3.
  - Snap skips the moved nodes' own ancestors.
  - `place` and `align` refuse a reference inside the moved subtree.
  - `snap` refuses `grid` or `targets` when `to` leaves them out.
  - *Cost if wrong:* if "center to grid" was meant, the expected y is 45.
- Task 7: the registry wiring (Task 8 Step 1) went into the Task 7 commit, because `structure2.test` needs `createRegistry`.
  - The plan's root-order expectations contradicted `group`, which places the group at its topmost member's slot; they were corrected.
  - `duplicate.id` and `rename.to` use `IdInput`.
  - `clip` refuses a shape with no subpaths, and `$last` follows the clipped node.
  - *Cost if wrong:* none.
- Task 8: `acceptance-m4` is integration over finished ops, so it could not fail first. It was mutation-checked instead (440 → 450 fails).

**Final review: "merge-ready after fixes".** Four findings were rated Important, and one Minor was promoted to Important. All five were fixed, each with a test that failed first and passed after. Suite: 345/345; build and dist smoke OK.
- **Group operand style.** A `boolean` whose first operand is a group produced an unstyled (black) result. It now takes the group's painted look: styles merged from the group down to its first painted leaf, with opacity multiplied along the way.
- **Clips in `shapeOf`.** `shapeOf` ignored clips, so booleans and clips used the unclipped area. It now intersects each clipped node, or clipped descendant, with its world clip.
- **Group union speed.** Unioning a group's children one by one grew without bound: the reviewer measured 12.7 s for 400 circles. Children now union as a balanced tree. One segment cap, `maxSegmentsPerPath`, applies across all operands before paper runs (`limit_exceeded`). The implementer measured 2.3 s → 0.17 s.
- **Raw `strip_ids` export.** It removed `<clipPath>` ids as well as node ids, so clips were lost. It now keeps ids that a `url(#…)` points at, and both export paths are pinned by a test.
- **`$last` after ungroup (promoted).** `ungroup $last` left `$last` on the deleted group, so the next `$last` op failed with a misleading hint. `$last` now moves to the topmost released child.

**Rulings made in the fix pass:**
- A group with no painted leaf falls back to the group's own style.
- The segment cap counts clip segments as well.
- A multi-id `boolean` still folds left to right; it is capped at 100 ids.
- Ungrouping an empty group leaves `$last` alone.

**Deferred minors:**
1. A `boolean` result gets an identity transform, so a scaled first operand loses its stroke scaling.
2. `boolean` hardcodes `fillRule: nonzero`. When an operand is empty and the other passes through unchanged, an `evenodd` ring fills in its hole.
3. `clip` refuses a shape with no subpaths but not one with zero area. A line used as a clip hides the node without a warning.
4. `round_corners` does not re-check `maxSegmentsPerPath`.
5. `transform` measures the pivot before `matrix` is applied, but applies rotate and scale after it. `matrix` combined with `rotate` therefore does not turn in place.
6. `ungroup` multiplies the group's opacity into each child, so overlapping children show through each other. It should warn or refuse.
7. `star` drops the clamped count from `roundCorners`. Past about 0.21 roundness the tips stop changing, and there is no warning.
8. Clipped `worldBounds` intersects two boxes, so it is not exact (FR-5.3) when a clip extends past the node in a non-rectangular way.
9. Grouping siblings that are not adjacent lifts the lower member above the siblings in between, without a warning.
10. Warnings carry no `hint` field, so `empty_result` and `nothing_to_snap` have none.
11. The `round_corners` radius is in local units, so a node scaled 3× gets a corner 3× larger. This goes against the canvas-units decision.

The reviewer declined to judge these; each stands as designed:
- snap matches x and y against nodes anywhere along the other axis
- distribute `gap` follows Appendix A
- paper's behavior on extreme coordinates was not probed
- `group.id` is still `z.string()`, as before M4
