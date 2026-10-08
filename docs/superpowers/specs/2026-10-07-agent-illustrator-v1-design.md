# Agent Illustrator v1: Design Deltas

**Base spec:** [`PROJECT_INIT.md`](../../../PROJECT_INIT.md). Its sections 4 (Key Decisions & Constraints) and 5 (Roadmap) stay binding.
This file records only what was decided or proposed after PROJECT_INIT was written. Together they form the v1 spec.

Status legend:
- **Agreed**: decided with the project owner.
- **Proposed**: the default unless the owner objects; confirm before the milestone named.
- **Pending evidence**: decided by an M0 spike or library check; record the outcome here before the M1 plan is written.

---

## A1. Planning decomposition (Agreed, 2026-10-07)
- One v1 spec: PROJECT_INIT.md plus this file.
- One implementation plan per milestone, written when that milestone starts, in `docs/superpowers/plans/`.
- The roadmap index lives in `docs/superpowers/plans/2026-10-07-v1-roadmap.md`.
- M0 spike outcomes update this file (sections S1–S7) before the M1 plan is written.

## A2. Evaluation approach (Agreed, 2026-10-07). Refines M10.
- **Dev-only agent-quality harness** in `/eval`:
  - private workspace package, never published, no public API
  - an MCP SDK client spawns the server over stdio
  - a minimal tool-call loop against one OpenAI-compatible chat-completions endpoint (e.g. OpenRouter), so one code path covers Claude, GPT, GLM and Qwen
- **Raw-SVG baseline:** the same model and the same brief, with no tools, asked to output an SVG document.
- **Report:** a side-by-side HTML page per brief (tools vs raw SVG), scored by a human against a written rubric. An LLM judge is optional later.
- **Why this is not the §4.3 "own agent runner":**
  - it is not shipped
  - it is not exposed through MCP
  - it has no provider abstraction beyond one OpenAI-compatible client
- **Deterministic render regression (CI):** fixed op scripts (JSON) → engine → PNG → `pixelmatch` against committed baseline PNGs. Pixel diffs are used only where output is deterministic, never on model-generated drawings.
- **Client compatibility** (at least 2 MCP clients) is a manual smoke checklist in `eval/clients.md`.

## A4. Repository layout tweaks (Proposed with the M0 plan)
- agent-kit content lives in `packages/agent-kit/content/` (core-contract.md, workflow.md, guides/, presets/, prompts/). The package root keeps only `package.json` and `README.md`, so the build copies one folder.
- Bundled fonts live in `packages/engine/assets/fonts/`. The runtime passes font file paths to the engine, so the engine never guesses install paths.
- A private `spikes/` workspace package holds the M0 learning tests. Each spike test is deleted once the engine module that supersedes it has its own tests: R1 → M1, R4 → M3, R2 → M8.
- M3 note (2026-10-08): the R4 spike stays until the owner moves Claude Desktop/Code from `spikes/src/mcp-probe-server.ts` to the real server; deleting it earlier breaks those registrations.

## A3. Scene model (Adopted as the default with the M2 plan, 2026-10-08; owner may still object)

```ts
type Doc = {
  schema: 1; seed: number;
  canvas: { width: number; height: number; background?: Paint };
  tokens: Record<string, string>;              // "primary" → "oklch(…)" | "#hex"
  defs: Record<string, GradientDef | FilterDef>;
  nodes: Record<string, Node>;                 // flat map keyed by semantic id
  root: string[];                              // top-level z-order, back → front
};
type Base  = { id: string; parent: string | null; transform: Mat6;  // [a,b,c,d,e,f]
               style: Style; clip?: string; mask?: string; meta?: { source?: unknown } };
type Group = Base & { type: 'group'; children: string[] };
type Path  = Base & { type: 'path'; fillRule: 'nonzero' | 'evenodd';
               subpaths: { start: Vec2; segs: Seg[]; closed: boolean }[] }; // Seg = [c1x,c1y,c2x,c2y,x,y]
type Text  = Base & { type: 'text'; content: string; font: FontSpec; anchor: TextAnchor;
               at: Vec2 | { path: string; offset: number } };
```

1. **Flat node map plus child-id arrays**, not a nested tree. Lookup by id is O(1), rename and reparent are cheap, and immer diffs stay small.
2. **A path can have several subpaths.** Booleans produce holes; `fillRule` is explicit.
3. **Segments are compact number tuples.** Raw segments reach the model only through `describe_scene` with `detail: "full"`.
4. **Derived data is not stored.** World transforms and exact bounds are computed on demand and cached in a `WeakMap` keyed by node object. Immer structural sharing keeps untouched nodes identical, so caches survive across batches without invalidation code (FR-1.4).
5. **Tokens are live references.** A style color `"palette.primary"` is resolved at render time. `export_svg` writes the resolved colors directly into the SVG.
6. **Randomness is derived per node:** `alea(seed, nodeId, salt?)`, with no shared stream. The same op gives the same result after undo or replay, and editing an earlier op does not reshuffle later generators. Generators accept an optional `seed` override. Satisfies D13 and NFR-4 with no RNG state stored in the document.
7. **Refinements in M2 (2026-10-08):**
   - World-transform caches are validated against the parent's world matrix, because an ancestor can change while a node object stays shared. Point 4 holds for per-node data only.
   - `defs` arrive with M5 (gradients, filters) and `text` with M8.
   - Ids also reject `canvas`, a leading `__`, and Object.prototype names.
   - Paints are CSS colors (via culori), `none`, or token names. SVG output always carries `#rrggbb` or `rgba()`.

## Open suggestions (Pending evidence)
Record each outcome here with a date and the evidence (spike test name or doc link).

| # | Suggestion | Why | Evidence source |
|---|---|---|---|
| S1 | `apply_ops` tool schema = loose item `{ op: enum(names), ... }` with Zod validation per op on the server, instead of exposing a ~50-variant union | Token cost of every tool listing; some clients reject large `oneOf` schemas; the per-op detail is already served by `guide` | Spike R4 schema probe |
| S2 | Text bounds from resvg `getBBox()` on a single-text SVG instead of `opentype.js` | Uses the same shaper as the final render, covers Arabic, removes a dependency | Spike R2 |
| S3 | Drop `bezier-js` from v1 | Its only planned use (offset) is out of scope per §4.3; the Appendix A math is hand-written in M1 | YAGNI. Re-add in post-v1 offset work |
| S4 | Replace `tsup` if it is unmaintained; publish ONE npm package (the server, bundling `engine` and `agent-kit` content) | Clean `npx` (NFR-6); no 3-package publishing | Library check plus M0 Task 1 |
| S5 | Merge op variants: `boolean {mode}`, one `transform {translate?, rotate?, scale?, skew?, matrix?, pivot?}`, `array {kind}`, `gradient {type}` → about 35 ops instead of 60 | Less registry, doc and example boilerplate; smaller catalog for models to learn | **Adopted** in the M2 plan (2026-10-08): merged variants; M2 ops unaffected |
| S6 | Use `paper` core headless without `paper-jsdom`, if booleans, `smooth` and `simplify` work | Drops jsdom: lighter install and faster cold start | Spike R1 |
| S7 | NFR-2 timeouts as input caps plus cooperative deadline checks in loops the engine owns | Synchronous CPU work (paper.js booleans, resvg render) cannot be preempted in-process without worker threads, and worker pools are out of scope per §4.3 | **Adopted** in the M3 plan (2026-10-08): input caps (ops, nodes, segments, render pixels, scale, documents) plus logged durations; no preemption. README documents it. |

### Outcomes recorded (2026-10-07, from the pre-M0 library check in a scratch directory on Node 24.13.1 / Windows 11)
M0 spike tests re-confirm each outcome inside the repo (and on Linux in CI) before the M1 plan is written.

**M0 in-repo confirmation (2026-10-08, Windows 11, Node 24.13.1; Linux pending CI; see `docs/spikes.md`):**
- S1, S2 and S6 are confirmed by `spikes/test/r4-mcp.test.ts`, `r2-resvg-text.test.ts` and `r1-paper.test.ts`.
- F1 is confirmed with "مرحبا Hello". "عدد 123" does not show the bug.
- New finding **F3:** paper boolean results can hold children with opposite orientation (exclude: +75/−75, signed area about 0). The M1 `paper-adapter` must call `reorient(true, true)` on every boolean result before converting it to the scene.
- New finding **F5** (final review): paper item constructors attach to the most recently created or activated scope, and every `PaperScope` stays in a static registry. This amends PROJECT_INIT §2.4/§4.2 "fresh PaperScope per operation": use one long-lived scope (or a small pool), call `scope.activate()` at the start of every adapter call, and use `insert: false` everywhere (M1).
- New finding **F4:** `z.looseObject` emits `additionalProperties: {}`, and MCP Inspector's portability check warns on it. M3 advertises `additionalProperties: true` explicitly.

- **S6: Adopted.** `paper/dist/paper-core.js` runs headless with no jsdom: `new PaperScope(); scope.setup(new scope.Size(1,1))` takes about 23 ms.
  - unite/subtract/intersect/exclude/divide, getIntersections, bounds, length, getPointAt/TangentAt/NormalAt/CurvatureAt, `simplify`, `smooth({type:'catmull-rom', factor:0.5})` and `pathData` all work.
  - Boolean fuzz: 9000 rect pairs with coincident edges, 1000 near-tangent circles and 1000 blob pairs gave 0 mismatches and 0 exceptions.
  - `exportSVG`/`importSVG` need a DOM, so we never use them; we use our own converter.
  - Import with the explicit `.js` extension; TypeScript needs a `declare module 'paper/dist/paper-core.js'` shim.
  - `paper-jsdom` is dropped: it pulls jsdom 16.7 (2021), is about 29 MB installed and has audit warnings.
  - Kittl fork (`@kittl/paper@0.12.30`, 2023): based on 0.12.17 plus one null guard, so it is behind upstream. Not adopted.
- **S2: Adopted.** resvg `getBBox()` on an SVG containing a single `<text>` equals the glyph ink bbox. It matched opentype.js `getPath().getBoundingBox()` exactly for Latin and works for Arabic.
  - `opentype.js` is dropped: v2.0 has no bundled types, no bidi, and its Arabic width was off by about 0.6% versus resvg.
  - Bonus: resvg `toString()` returns usvg SVG with text converted to paths, a cheap route to post-v1 text-to-outlines.
- **S3: Adopted.** `bezier-js` is dropped from v1.
- **New finding, F1: resvg-js bidi.** `direction="rtl"` is ignored (the base direction is always LTR), so mixed Arabic + digits/Latin comes out misordered.
  - Wrapping the content in U+2067…U+2069 (RLI…PDI) renders correctly; a bare RLM does not.
  - The engine's text serializer wraps text whose `direction` is `rtl` (or auto-detected RTL) in RLI…PDI. Document the limit in `guide`.
- **New finding, F2: resvg-js is old.** 2.6.2 (2024-03) embeds resvg 0.34; upstream is at 0.48.
  - Bundle only static TTF fonts, since variable fonts are unverified.
  - Fallback: `@resvg/resvg-wasm@2.6.2` works in Node with the same API plus `fontBuffers`.
  - Speed: a 1024² render plus PNG takes about 60 ms.
- **S1: Adopted.** The `apply_ops` input is `{ doc_id, ops: z.array(z.looseObject({ op: z.enum(OP_NAMES) })), dry_run? }`. Each op is validated on the server against its registry schema.
  - Measured with 50 variants: the union schema is about 13.6 KB (about 3.9k tokens); the loose schema is about 0.6 KB (about 170 tokens).
  - The Anthropic API rejects a top-level `oneOf`/`anyOf` with HTTP 400.
  - Several clients break on `$ref`/`$defs`, so tool schemas avoid them and avoid recursion.
  - The `render` tool declares no `outputSchema` (Claude Code issue 31208: images are dropped when one is declared) and returns an image block plus a text block.
  - Claude Desktop collapses tool blocks, so the FR-11.2 disk-path fallback stays.
- **S4: Adopted.** `tsup` is unmaintained (its README points to tsdown), so we use `tsdown`, pinned exact at `0.23.0` (pre-1.0).
  - Published package name: `agent-illustrator` (free on npm, 2026-10-07).
  - It lists `engine` and `agent-kit` as `devDependencies: workspace:*`, so they are bundled.
  - Third-party runtime deps go in its `dependencies` and stay external.
  - agent-kit content is copied into `dist/` and resolved relative to the bundle via `import.meta.url`, with a dev fallback.
  - tsdown 0.23 replaced `external`/`noExternal` with `deps.neverBundle`/`deps.alwaysBundle`.
- **Toolchain pins:**
  - Node: `engines.node: ">=22.18"`. Floor set by tsdown `^22.18 || ^24.11 || >=26`, vitest 5, ESLint 10 and pnpm 11+. Also unflags type stripping. Node 20 is EOL.
  - Develop on Node 24. CI runs Node 22 and 24 on Linux, and Node 24 on Windows.
  - TypeScript `~6.0.3`. TS 7 is npm `latest`, but `typescript-eslint` peers `>=4.8.4 <6.1.0`.
  - `@types/node ^22.20.5` (matches the runtime floor).
  - pnpm `9.15.2` via `packageManager` (the owner's installed version), with versions in a `catalog:`.
    - pnpm 9's `manage-package-manager-versions` cannot launch pnpm 12 (bin layout changed), and a global upgrade would affect the owner's other projects.
    - Bump to 12.x after the owner upgrades pnpm globally (M0 ruling, 2026-10-08).
  - vitest `^5.0.3` (`test.projects`).
  - ESLint `^10.12.0` flat config with built-in `no-restricted-imports` / `no-restricted-properties`. No boundaries plugin; pnpm strict `node_modules` enforces package edges.
  - zod `^4.6.5` (the SDK needs 4.2 or later).
  - `@modelcontextprotocol/server` and `@modelcontextprotocol/client` `^2.3.1`.
  - MCP Inspector `2.9.0`, pinned.
- **MCP SDK v2 API (from docs plus local probes):**
  - Server and tools:
    - `new McpServer({ name, version }, { instructions })`
    - `server.registerTool(name, { title, description, inputSchema: z.object(...), outputSchema?, annotations? }, handler)`
    - `server.registerPrompt(name, { description, argsSchema: z.object(...) }, cb)`
  - stdio:
    - server: `serveStdio(factory)` from `@modelcontextprotocol/server/stdio`
    - tests: `StdioClientTransport` from `@modelcontextprotocol/client/stdio`
  - Protocol versions: a v2 stdio server negotiated 2025-03-26, 2025-06-18 and 2025-11-25 clients.
- **Fonts:** bundle Tajawal Regular and Bold (OFL, Arabic + Latin, about 60 KB each). Optional: Amiri Regular (OFL, Arabic serif, 431 KB).
- **svgo 4.1:** to preserve ids, override `cleanupIds: false` and `collapseGroups: false`. Precision is set through `floatPrecision`.
- **pixelmatch 8.0.0** was released 2026-10-06 and changed its metric to OKLab+HyAB, which breaks thresholds. Pin `pixelmatch@7.2.0` for M10 unless v8 is re-evaluated then.
- **Library status:**
  - unmaintained but working: `alea` (seeded with simplex-noise, verified deterministic), `poisson-disk-sampling` (custom rng is the 2nd constructor argument)
  - fine: `rbush@4` (ESM-only), `immer@11` (5000-node flat map, single edit about 2 ms), `culori@4`, and `pino` to stderr via `pino.destination({ dest: 2 })`, all verified
