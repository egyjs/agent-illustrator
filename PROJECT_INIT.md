# PROJECT_INIT.md: Vector Illustration Engine for LLM Agents

> Context initiation document for a Claude Code `/plan` session.
> Read it fully before planning. Sections 4 and 5 are binding for v1 scope.
> Library versions and APIs named here were checked during planning (Oct 2026). Verify exact APIs at implementation time and don't trust memory over current docs.

---

## 1. Executive Summary & Product Vision

### 1.1 The problem
LLMs produce poor vector illustrations when they write raw SVG:
- **No spatial awareness.** They work in text tokens, with no geometry engine and no way to see the result.
- **Primitive output.** Basic circles and rectangles, uneven curves, misaligned elements.
- **Cost.** Long SVG strings consume many tokens and are hard to edit incrementally.
- **No feedback loop.** The model never sees what it drew.

### 1.2 The core insight
Moving SVG writing into tool calls (`draw_circle(cx=312, …)`) is not enough. If the model still computes every coordinate, it is still drawing blind.

The tools must reduce how much the model has to compute. The model states intent: what goes where, relative to what, in which style. The engine owns the geometry, the curves, the layout math and the rendering.

### 1.3 The product
A **model-agnostic vector illustration engine**, exposed as an **MCP server** with a **packaged prompt system**. Any tool-calling LLM (Claude, GPT, GLM, Qwen, and others) uses it to produce production-quality SVG illustrations through:
1. **A semantic scene graph.** Every object has a stable, meaningful ID such as `sun` or `hill_back`.
2. **High-level operations instead of raw coordinates:**
   - relative placement, alignment and distribution
   - smooth curves fitted from rough points
   - parametric generators (blobs, scatter, waves, arrays)
   - boolean operations
   - perceptual color
3. **Batched, transactional operations.** Many ops per call, with all-or-nothing rollback.
4. **Rich feedback:**
   - structured scene descriptions and bounds
   - automated lint (overlaps, off-canvas objects, near-miss alignment, contrast)
   - rendered PNG previews with an optional overlay of ID labels, bounding boxes and a grid
5. **A packaged prompt system** that teaches any model the workflow: plan, block in, refine, critique against the render, export.
6. **Clean, optimized SVG export.**

### 1.4 v1 scope (final, evolved)
- **Production-quality but lean.** Ship a robust local MCP server (stdio transport) plus the prompt kit.
- **Lean on proven open-source libraries** instead of reimplementing the geometry math: paper.js, resvg, culori and the others listed in section 2.5.
- **Keep architectural boundaries** so that later additions require no refactor. Planned later additions:
  - HTTP API
  - own agent runner
  - Claude plugin packaging
  - remote hosting
  - constraint solver
  - advanced text

### 1.5 Success criteria for v1
- A tool-calling model, given a short brief such as "flat illustration of a desert sunset with dunes and palm trees", produces a coherent, well-composed illustration within a reasonable number of tool calls.
- It is clearly better than raw SVG output from the same model, judged on the evaluation set (section 5, M10).
- Works in at least two MCP clients (e.g. Claude Desktop and one other) and with at least two model families.
- Exported SVG is valid, optimized, and opens correctly in browsers and in Illustrator/Inkscape.

---

## 2. System Architecture & Tech Stack

### 2.1 Architectural principles
1. **Strict layering. Dependencies point downward only.** The core engine knows nothing about MCP, HTTP, LLMs or prompts.
2. **Separate code into packages only where at least one of these holds:**
   - it has a different rate of change
   - it has heavy or native dependencies
   - it has different scaling or deployment needs
   - it has a realistic chance of being swapped out

   Everything else lives in folders inside a package. Use one file per domain, not one file per function. Do not over-fragment.
3. **One op registry is the single source of truth.** Each op is defined once:
   - Zod schema
   - description
   - handler
   - examples

   MCP tools, documentation and the guide content are all derived from it. Future HTTP routes and provider-specific function schemas will be derived from it too.
4. **The scene is plain, serializable JSON.** Third-party libraries (especially paper.js) are computation services behind thin wrappers. They never own state.
5. **Determinism.** All randomness flows from a per-document seed through one seeded RNG, so sessions can be replayed exactly.
6. **Every mutation returns structured feedback:** `{ id, bounds, warnings[] }`. The model never has to guess what happened.

### 2.2 Layer model (full target architecture)

```
┌────────────────────── Delivery (swappable) ──────────────────────┐
│  MCP server (v1)  │  HTTP API (later)  │  Agent runner (later)    │
│  Claude plugin (later, packaging only)                            │
├───────────────────────────────────────────────────────────────────┤
│  Runtime: sessions, op registry, schema export │ Agent kit        │
├────────────────────── Core engine (pure) ─────────────────────────┤
│  Ops (domain modules, one registry)                               │
│  Render (SVG serializer, PNG raster) │ Analysis │ Text            │
│  Scene graph (nodes, transforms, styles, history)                 │
│  Geometry kernel (pure math, no state)                            │
└───────────────────────────────────────────────────────────────────┘
```

### 2.3 v1 package layout (pnpm monorepo)
Three packages for v1. The internal folders keep the full design's boundaries, so the later split into more packages is mechanical.

```
/packages
  /engine                  # pure core: no MCP, no LLM knowledge
    /src
      /geometry            # ONLY place that imports paper.js / bezier-js
        bezier.ts          # eval, tangent/normal, exact bounds, arc length LUT
        paths.ts           # smooth (centripetal Catmull–Rom), fit (simplify), corner rounding
        boolean.ts         # union/subtract/intersect/exclude via paper.js
        flatten.ts         # Wang's formula flattening, winding number, area
        transform.ts       # affine matrices, compose, decompose
        paper-adapter.ts   # scene geometry ⇄ paper.js conversion, PaperScope lifecycle
      /scene
        model.ts           # Document, Node types, IDs, tokens, defs
        store.ts           # immer-based updates, transactions, checkpoints
        query.ts           # lookup by id, world transforms, world bounds
      /ops                 # one file per domain; each op = schema + handler + docs + examples
        registry.ts
        shapes.ts  paths.ts  boolean.ts  transform.ts  layout.ts
        style.ts   color.ts  generate.ts structure.ts  text.ts
      /analysis
        describe.ts        # structured scene summary for the model
        lint.ts            # off-canvas, overlap, near-miss alignment, contrast
        spatial-index.ts   # rbush
      /render
        svg.ts             # scene → SVG string
        raster.ts          # SVG → PNG via resvg-js, overlays, regions
        export.ts          # SVGO optimization, precision
      /random
        rng.ts             # seeded RNG (alea) + simplex-noise
  /mcp-server              # runtime + MCP transport (stdio in v1)
    /src
      server.ts            # MCP setup, server instructions
      tools.ts             # ~10 exposed tools, generated from the registry where possible
      sessions.ts          # in-memory session store behind an interface
      persistence.ts       # save/load document JSON to disk
      logging.ts           # pino op-call logs
  /agent-kit               # prompt system as content (Markdown/YAML), versioned with the engine
    core-contract.md       # how to use the tools (short; also feeds server instructions)
    workflow.md            # plan → block-in → refine → critique → export
    /guides                # topic guides served by the guide(topic) tool
    /presets               # style presets (flat, line-art, isometric…) as YAML
    /prompts               # MCP prompts, e.g. /illustrate
/eval                      # evaluation set: briefs, transcripts, renders, diff tooling
```

**Dependency rule:**
- `agent-kit` is content only.
- `mcp-server` depends on `engine` and `agent-kit`.
- `engine` depends on nothing internal.
- Inside `engine`: `ops` depends on `scene`, which depends on `geometry`; `analysis` and `render` depend on `scene`.

### 2.4 Data flow (one agent turn)
1. The model calls `apply_ops(doc_id, [ops…])` via MCP.
2. `mcp-server` resolves the session and passes the batch to `engine`.
3. The registry validates every op with Zod. On any failure, nothing is applied and per-op errors are returned.
4. Ops run in order inside one immer transaction:
   - Geometry work goes through the `geometry` wrappers.
   - paper.js runs in a fresh `PaperScope`; data is converted in, computed, and converted out.
5. Batch results are returned: per-op `{ id, bounds, warnings }`, plus document-level warnings from incremental lint.
6. The model calls `render(doc_id, overlays:["ids","bounds"])` and receives a PNG as an MCP image content block.
7. The model inspects, critiques, issues fixes, and finally calls `export_svg`.

### 2.5 Tech stack (agreed)

| Concern | Library | Role / notes |
|---|---|---|
| Language/runtime | TypeScript, Node.js LTS | |
| Monorepo/build | pnpm workspaces, tsup | |
| MCP | `@modelcontextprotocol/server` (SDK v2, stable line for the 2026-07-28 spec) | Accepts Standard Schema (Zod v4) for tool schemas; can serve 2026- and 2025-era clients. v1 uses the stdio transport. |
| Validation | `zod` v4 | Op schemas; source of truth for the registry |
| Geometry | `paper` + `paper-jsdom` (headless) | Booleans, intersections, bounds, arc length, `smooth()`, `simplify()` (Schneider). Releases are slow; the Kittl fork is a fallback. Always wrapped; new `PaperScope` per operation or session. |
| Curve analysis | `bezier-js` | Curvature, lookup tables, offset/outline when needed |
| Rasterizing | `@resvg/resvg-js` | Native via napi-rs (no node-gyp); custom fonts; bounding box and crop |
| SVG optimization | `svgo` | Export |
| Color | `culori` | OKLab/OKLCH, interpolation, `toGamut`, `wcagContrast` |
| Noise / RNG | `simplex-noise` + `alea` | Seeded; blobs, roughen, jitter |
| Scatter | `poisson-disk-sampling` | Bridson's algorithm, variable density |
| Scene state | `immer` | Immutable updates, rollback, checkpoints |
| Spatial index | `rbush` | Overlap lint, snap candidates |
| Font metrics | `opentype.js` | Latin text measurement |
| Testing | `vitest`, `pixelmatch` (or `odiff`) | Unit tests, render diffs for the evaluation set |
| Logging | `pino` | Op-call logs per session |

**Reserved for later (do not add in v1):**
- `kiwi.js` (Cassowary constraint solver)
- `harfbuzzjs` (Arabic shaping, text-to-outlines)
- Clipper2 JS port (robust boolean fallback)
- Vercel AI SDK (agent runner)

### 2.6 Exposed MCP surface (small on purpose)
Weaker models degrade badly with dozens of tool schemas. Expose about 10 tools. The roughly 50–60 internal ops are reached through `apply_ops` and can be looked up through `guide`.

| Tool | Purpose |
|---|---|
| `create_document(width, height, background?, seed?, units?)` | Create a new document; returns `doc_id` |
| `apply_ops(doc_id, ops[], dry_run?)` | Transactional batch of ops; per-op results and warnings |
| `describe_scene(doc_id, detail?)` | Structured tree: ids, types, world bounds, z-order, styles (summary) |
| `measure(doc_id, query)` | Bounds, distances, lengths, areas, overlaps for given ids |
| `lint(doc_id)` | Full lint report with suggested fixes |
| `render(doc_id, overlays?, region?, scale?)` | PNG preview as an image block; overlays: ids, bounds, grid |
| `export_svg(doc_id, precision?, optimize?)` | Final SVG string (SVGO-optimized) |
| `history(doc_id, action, label?)` | Checkpoint, restore, list |
| `document_io(action, doc_id?, path?)` | Save or load document JSON |
| `guide(topic)` | Returns agent-kit guides (workflow, op catalog, presets, examples) |

Plus:
- **MCP server instructions**: a short core contract.
- **MCP prompt `/illustrate`**: a user-invoked workflow template.

### 2.7 Prompt system delivery (layered, model-agnostic)
Clients handle prompts inconsistently, so use several layers:
1. **Server instructions.** A short contract. Many clients inject it into the system prompt, but don't rely on that alone.
2. **Tool descriptions.** These carry the essential usage rules.
3. **`guide(topic)` tool.** The only universally reliable channel: any model that can call tools can read it. It gives depth on demand.
4. **MCP prompts (`/illustrate`).** User-invoked workflows.
5. **Later: the agent runner** injects the full prompt directly.

The agent-kit is layered:
- core contract
- workflow
- style presets
- model overlays (v1 has a single overlay set: a text-only variant that relies on `describe_scene`, `measure` and `lint` instead of renders)

CI checks that every op name referenced in the prompts exists in the registry.

---

## 3. Core Features & Functional Requirements

### FR-1 Document & scene graph
- **FR-1.1** Create a document with canvas size, background, seed and units (px by default).
- **FR-1.2** Node types: `group`, `path` (all geometry stored as cubic Bézier segments, open or closed), `text`.
  - Optional `meta.source` records generator or primitive parameters for provenance.
- **FR-1.3** Every node has a unique, semantic, model-chosen `id`. The engine auto-suffixes on collision and reports it.
- **FR-1.4** Local transform per node as an affine matrix. `world = parent_world · local`, cached.
- **FR-1.5** Styles: fill, stroke (width, cap, join, dash, miter limit), opacity, blend mode, and filters (drop shadow, blur) as SVG defs.
- **FR-1.6** Design tokens: a named palette (`palette.primary`, etc.) referenceable from styles.
- **FR-1.7** Structure: group, ungroup, reorder (front, back, forward, backward, above or below an id), clip path, mask, duplicate, delete, rename.

### FR-2 Operations (via `apply_ops`)
- **FR-2.1 Units.**
  - Numbers are canvas units.
  - Strings like `"50%"` are relative to the canvas (or to a reference node where the op defines one).
- **FR-2.2 References.** Ops target ids. `$last` refers to the most recently created node.
- **FR-2.3 Transactions.** Validate all ops, then apply in order. On any failure, roll back the whole batch and return per-op errors as `{ code, message, hint }`.
- **FR-2.4** `dry_run` returns results without committing.

### FR-3 Shapes & paths
- **FR-3.1 Primitives:** rect (optional corner radius), ellipse/circle, regular polygon, star (outer and inner radius, roundness), line.
- **FR-3.2 `path_from_points(points, mode, closed)`:**
  - `polyline`
  - `smooth`: centripetal Catmull–Rom converted to Bézier (no cusps or self-loops)
  - `fit`: Schneider fitting via `simplify` with a tolerance
- **FR-3.3** `path_commands`: move/line/cubic/quadratic/arc. Quadratics and arcs are converted to cubics internally.
- **FR-3.4** `round_corners(id, radius)`: fillet with the radius clamped to half of each adjacent edge.

### FR-4 Booleans
- **FR-4.1** `union`, `subtract`, `intersect`, `exclude` over two or more ids. Produces a new path node; consuming the inputs is optional.
- **FR-4.2** Epsilon handling for coincident edges and tangent contact. Degenerate results are reported as warnings, not crashes.

### FR-5 Transforms
- **FR-5.1** translate, rotate, scale, skew, or a raw matrix.
- **FR-5.2** Pivot can be a named anchor (9-point) or a point.
- **FR-5.3** Reported bounds are exact world bounds after transform: transform the control points, then compute exact Bézier bounds.

### FR-6 Layout
- **FR-6.1** 9-point anchors on bounding boxes.
- **FR-6.2** `place(id, relative_to, anchor, target_anchor, offset)`. `relative_to` is a node id or `canvas`.
- **FR-6.3** `align(ids, edge|center, to?)`.
- **FR-6.4** `distribute(ids, axis, mode: gap|center)`.
- **FR-6.5** `snap(id, targets?, tolerance?)`: candidates are edges and centers of other nodes, the canvas and the grid.

### FR-7 Generators
All seeded and deterministic.
- **FR-7.1 `blob`:** radius, complexity N, randomness, frequency. Implemented as noise sampled on a circle, then closed centripetal Catmull–Rom.
- **FR-7.2 `wave`:** amplitude, wavelength, phase; open or closed as a band.
- **FR-7.3 `scatter`:** Poisson-disk sampling inside a shape or region, with a minimum distance and an optional density gradient. Places clones of a source node with optional random scale and rotation ranges.
- **FR-7.4 `repeat_along_path`:** count or spacing, with optional alignment to the path tangent.
- **FR-7.5 `array_radial` and `array_grid`.**
- **FR-7.6 `roughen`:** resample by arc length, displace along the normal with noise, refit. Gives a hand-drawn look.

### FR-8 Color
- **FR-8.1 `palette(base, harmony, steps)`** in OKLCH.
  - Harmonies: complementary, analogous, triadic, monochrome.
  - Lightness ramps.
  - Gamut-mapped to sRGB.
- **FR-8.2 Linear and radial gradients**, interpolated in OKLab and emitted as 5–9 SVG stops.
- **FR-8.3** Contrast utility (WCAG ratio), used by lint.

### FR-9 Text (v1, native)
- **FR-9.1** `text`: font family, size, weight, letter spacing, anchor, fill. Uses native SVG `<text>`.
- **FR-9.2** `text_on_path`: native `<textPath>`.
- **FR-9.3** Measurement with opentype.js for Latin text.
- **FR-9.4** Bundled default fonts; custom font files are registered with the renderer.
- **FR-9.5** Arabic and other complex scripts: rely on resvg shaping. Must be verified in an early spike (M0); document the result.

### FR-10 Analysis & feedback
- **FR-10.1** `describe_scene`: hierarchy, ids, types, world bounds, z-order, fill/stroke summary, at configurable detail.
- **FR-10.2** `measure`: bounds, distance between ids, path length, area, overlap pairs.
- **FR-10.3 `lint`:**
  - off-canvas or partially clipped nodes
  - overlapping nodes (rbush broad phase plus geometric check)
  - near-miss alignment: edges or centers within ε but not equal, with a suggested snap
  - low text contrast against what's underneath (sampled from the render)
  - empty or degenerate paths
  - tiny nodes
- **FR-10.4** Incremental lightweight warnings are returned with every `apply_ops` result.

### FR-11 Render & export
- **FR-11.1** `render`: PNG via resvg-js at a given scale. Optional overlays as a separate layer: id labels, bounding boxes, grid. Optional `region` crop and zoom.
- **FR-11.2** Returned as an MCP image content block. Fallback: also save the PNG to disk and return its path for clients that drop images.
- **FR-11.3** `export_svg`: clean SVG with configurable precision, SVGO-optimized, ids preserved by default (option to strip them).

### FR-12 History & persistence
- **FR-12.1** Named checkpoints, restore and list (immer snapshots).
- **FR-12.2** Save and load the document as JSON on disk.
- **FR-12.3** Sessions are held in memory behind a `SessionStore` interface, so a Redis store can be added later.

### FR-13 Agent kit
- **FR-13.1** Core contract: concise rules for tool use, ids, batching and units.
- **FR-13.2** Workflow guide:
  1. Plan: brief, composition zones, focal point, palette.
  2. Block in large shapes.
  3. Add mid-level detail.
  4. Add fine detail.
  5. Critique: render with overlays, plus lint.
  6. Fix.
  7. Export.
- **FR-13.3** Op catalog guide, generated from the registry.
- **FR-13.4** Style presets as YAML: flat, line-art, isometric-lite. Each defines default strokes, fills, shadows and palette rules.
- **FR-13.5** A text-only model overlay.
- **FR-13.6** MCP prompt `/illustrate`.

### Non-functional requirements
- **NFR-1 Limits.**
  - Configurable caps: max nodes per document, max ops per batch, max path segments, max scatter count, render size.
  - Exceeding a cap gives a clear error, never a hang.
- **NFR-2 Timeouts** on heavy ops (booleans, scatter, render).
- **NFR-3 Errors.** Every error has `{ code, message, hint }`, and the hint says how to fix the call.
- **NFR-4 Determinism.** The same seed and the same ops produce an identical SVG.
- **NFR-5 Observability.** Every op call is logged as a JSON line (pino) with session, op, duration and outcome.
- **NFR-6 Install.** One command via `npx`. No native build step (resvg-js ships prebuilt binaries).
- **NFR-7 Tests.**
  - Unit tests on geometry wrappers and ops.
  - Snapshot tests on SVG output.
  - Render-diff tests on the evaluation set.

---

## 4. Key Decisions & Constraints

### 4.1 Decisions and trade-offs

| # | Decision | Rationale | Trade-off accepted |
|---|---|---|---|
| D1 | The LLM orchestrates high-level ops; it does not write SVG or compute most coordinates | Fixes the root problem (no spatial awareness) | More engine work up front |
| D2 | Semantic IDs + query tools + structured feedback on every mutation | Structured spatial data is more reliable for models than images alone | Slightly larger responses |
| D3 | Batched, transactional `apply_ops` with a small exposed tool surface (~10 tools) | Fewer round trips; weaker models cope better with few tools | Ops are discovered via `guide` instead of being individual tools |
| D4 | Internal geometry is cubic Béziers only | One representation keeps all algorithms uniform | Primitives lose their native SVG form (keep `meta.source`) |
| D5 | Use paper.js for booleans, smoothing and fitting instead of writing them | Saves weeks; battle-tested | Slow upstream releases. Mitigated by the wrapper boundary and the Kittl fork / Clipper2 fallback. |
| D6 | Plain-JSON scene + immer; libraries are stateless services | Serialization, undo, determinism, swappability | Conversion overhead at the paper.js boundary |
| D7 | MCP is the primary and only v1 channel | Closest thing to a universal standard; works across model vendors | Apps without MCP clients must wait for the HTTP API |
| D8 | Local stdio transport in v1 | No hosting or auth; works in desktop and IDE clients | Not usable from web-only clients until Streamable HTTP is added |
| D9 | Prompt system delivered in layers, with `guide(topic)` as the universal channel | Clients handle prompts and resources inconsistently | Some duplication between instructions and guides |
| D10 | Anchors/place/align/distribute/snap instead of a constraint solver | Covers about 90% of layout needs at a fraction of the complexity | No declarative constraint rules in v1 |
| D11 | Native SVG text, rendered and shaped by resvg | Fast to ship | No text-to-outlines and no precise Arabic measurement in v1 |
| D12 | OKLCH/OKLab for all color math | Perceptually uniform palettes and gradients | None significant |
| D13 | Seeded randomness everywhere | Replayable sessions, debuggable agent runs | Seed must be threaded through every generator |
| D14 | 3 packages in v1, with folder boundaries mirroring the full 7-package design | Maintainable without over-fragmentation; later split is mechanical | Discipline needed to keep folder dependencies one-way |
| D15 | Evaluation set is mandatory | Without it, prompt and tool changes can't be judged | Upfront effort to curate briefs |

### 4.2 Constraints
- `engine` must never import from `mcp-server` or `agent-kit`, and must never mention MCP or LLMs.
- Only `engine/src/geometry/*` may import `paper`, `paper-jsdom` or `bezier-js`.
- No global paper.js state. Use a fresh `PaperScope` per operation or session.
- No unseeded randomness (`Math.random` is banned in `engine`; enforce with a lint rule).
- All op inputs are validated by Zod before any mutation.
- No `node-gyp` or other native build steps for end users.

### 4.3 Explicitly out of scope for v1 (planned later)
- HTTP/REST API and provider-specific function-schema export (OpenAI, Anthropic, Gemini)
- Own agent runner and multi-provider layers (LiteLLM, Vercel AI SDK)
- Claude plugin packaging (about one day of work after v1)
- Remote hosting (Streamable HTTP transport, auth, multi-tenant)
- Redis or persistent session stores, worker pools, horizontal scaling
- Cassowary constraint solver (`kiwi.js`)
- HarfBuzz shaping, text-to-outlines, rich paragraph layout (Knuth–Plass)
- Path offset/outline-stroke (optional late stretch via `bezier-js`)
- Advanced lint: visible-area occlusion, composition and balance scoring, rule-of-thirds checks
- Symbol/component libraries, pattern fills, image embedding
- Per-model prompt overlays beyond the single text-only variant
- Collaboration, user accounts, web UI

### 4.4 Risks and open questions (resolve early)
- **R1** paper.js headless behavior in Node via `paper-jsdom`: verify booleans, `simplify` and `smooth` in a spike.
- **R2** Arabic and RTL shaping and font fallback in resvg: verify in a spike and document the limits.
- **R3** Image content in tool results across MCP clients: verify support and implement the disk-path fallback.
- **R4** MCP SDK v2 API details: confirm against current docs (stdio server, image content, prompts, server instructions).
- **R5** Boolean edge cases (coincident edges, tiny slivers): build a regression suite; Clipper2 is the fallback.

---

## 5. Initial Roadmap / Backlog for `/plan`

Each milestone ends in a working, tested state. Do not start a milestone before the previous one's acceptance criteria pass.

### M0: Scaffold & spikes
- [ ] Set up the pnpm monorepo with `engine`, `mcp-server`, `agent-kit` and `/eval`. Configure TypeScript strict mode, tsup, vitest, ESLint (with the `Math.random` ban and import-boundary rules) and CI.
- [ ] Spike R1: run paper.js booleans, `smooth` and `simplify` headless in Node, converting to and from plain cubic data.
- [ ] Spike R2: render Latin and Arabic text with resvg-js and custom fonts; record findings in `docs/spikes.md`.
- [ ] Spike R3/R4: a minimal MCP SDK v2 stdio server returning an image block; test in Claude Desktop plus one other client.
- **Acceptance:** spikes documented; CI green; import-boundary lint enforced.

### M1: Geometry module
- [ ] `bezier.ts`: evaluation, derivative, normal, exact bounds (derivative roots), arc length (Gauss–Legendre) with a lookup table and its inverse.
- [ ] `flatten.ts`: Wang's formula flattening, winding-number point-in-path (nonzero and even-odd), area.
- [ ] `transform.ts`: affine matrices, compose, pivot rotation, decompose.
- [ ] `paths.ts`:
  - centripetal Catmull–Rom smoothing
  - Schneider fitting (via paper `simplify`)
  - quadratic→cubic and arc→cubic conversion
  - corner rounding
- [ ] `boolean.ts` and `paper-adapter.ts`: the four boolean operations with epsilon handling.
- **Acceptance:** unit tests with known-answer cases (circle bounds, arc lengths, boolean areas); a boolean regression suite.

### M2: Scene model, registry, transactions, SVG out
- [ ] `scene/model.ts`: Document, nodes, ids, tokens, defs, seed.
- [ ] `scene/store.ts`: immer transactions, rollback, checkpoints.
- [ ] `scene/query.ts`: world transforms and world bounds.
- [ ] `ops/registry.ts`: op definition type `{ name, domain, schema, description, examples, handler }`; batch executor; `{ code, message, hint }` errors; `$last` and unit/percent resolution.
- [ ] `render/svg.ts`: scene to SVG.
- [ ] Initial ops: rect, ellipse, polygon, line, style (fill/stroke), group, delete.
- **Acceptance:** batch with a mid-batch failure rolls back fully; SVG snapshot tests pass; same seed and ops give identical output.

### M3: First end-to-end MCP slice
- [ ] `render/raster.ts`: resvg PNG, overlays (ids, bounds, grid), region crop.
- [ ] `render/export.ts`: SVGO and precision.
- [ ] `mcp-server`: stdio server; tools `create_document`, `apply_ops`, `render`, `export_svg`; in-memory `SessionStore`; pino logs; resource limits and timeouts.
- [ ] `npx` entry point and client config docs.
- **Acceptance:** a model in a real MCP client creates a document, draws shapes, sees the render and exports valid SVG.

### M4: Paths, booleans, transforms, layout
- [ ] Ops: `path_from_points` (polyline, smooth, fit), `path_commands`, `round_corners`, star.
- [ ] Ops: union, subtract, intersect, exclude.
- [ ] Ops: translate, rotate, scale, skew, matrix, with anchor or point pivots.
- [ ] Ops: `place`, `align`, `distribute`, `snap` (rbush candidate index).
- [ ] Structure ops: reorder, clip, mask, duplicate, rename, ungroup.
- **Acceptance:** each op has tests, examples, and returns exact world bounds.

### M5: Style & color
- [ ] culori integration: palette (harmonies, lightness ramps, gamut mapping), tokens.
- [ ] Linear and radial gradients interpolated in OKLab, emitted as multiple stops.
- [ ] Filters: drop shadow, blur; opacity and blend modes.
- **Acceptance:** palette and gradient tests; contrast utility tests against WCAG reference values.

### M6: Generators
- [ ] Seeded RNG (`alea`) and simplex noise.
- [ ] blob, wave, `scatter` (Poisson-disk, inside a shape via winding test, density gradient), `repeat_along_path` (arc-length placement with tangent alignment), radial and grid arrays, roughen.
- **Acceptance:** deterministic snapshot tests per generator; performance within limits for maximum counts.

### M7: Analysis & history
- [ ] `describe_scene`, `measure`, `lint` (off-canvas, overlap, near-miss alignment with snap suggestions, text contrast sampled from the render, degenerate and tiny nodes).
- [ ] Incremental warnings in `apply_ops` results.
- [ ] `history` (checkpoint, restore, list) and `document_io` (save and load JSON).
- **Acceptance:** lint catches seeded defects in fixture scenes; restore returns the exact prior SVG.

### M8: Text
- [ ] `text` and `text_on_path` (native SVG), opentype.js measurement for Latin, bundled default fonts, font registration with resvg.
- [ ] Document Arabic support status from M0 in `guide`.
- **Acceptance:** text bounds within tolerance of the rendered result for Latin text; text-on-path renders correctly.

### M9: Agent kit & prompt delivery
- [ ] Write the core contract, workflow guide, style presets (flat, line-art, isometric-lite) and the text-only overlay.
- [ ] Op catalog guide generated from the registry.
- [ ] `guide(topic)` tool; server instructions from the core contract; MCP prompt `/illustrate`.
- [ ] CI check: every op name referenced in agent-kit exists in the registry.
- **Acceptance:** a fresh model session, given only the server, can complete a brief using guides alone.

### M10: Evaluation & hardening
- [ ] `/eval`: about 20 briefs covering landscape, icon set, character-lite, poster with text, pattern/scatter, isometric object, and Arabic text.
- [ ] Runner script that records transcripts, renders and exported SVG per model and client; pixelmatch diffs against the previous baseline.
- [ ] Baseline comparison against raw-SVG output from the same models.
- [ ] Review error messages with real agent transcripts and improve hints where models got stuck.
- [ ] README: install, client setup, tool reference, limits, known limitations.
- **Acceptance:** success criteria in section 1.5 are met on at least two model families.

### Post-v1 backlog (ordered)
1. Claude plugin packaging (MCP server plus agent-kit as a skill)
2. Streamable HTTP transport and hosting
3. HTTP API and provider-specific schema export
4. Own agent runner (`create_illustration(brief)`)
5. Constraint solver (`kiwi.js`)
6. HarfBuzz text shaping and text-to-outlines
7. Offset/outline-stroke
8. Advanced composition lint
9. Symbol libraries and patterns

---

## Appendix A: Algorithm reference (for implementers)

- **Cubic Bézier.** `B(t) = (1−t)³P0 + 3(1−t)²t·P1 + 3(1−t)t²·P2 + t³P3`.
  - The derivative is quadratic in t.
  - Normal: `N = (−B'y, B'x)/|B'|`.
- **Exact bounds.** Per axis, solve `at² + bt + c = 0` with:
  - `a = 3(−P0 + 3P1 − 3P2 + P3)`
  - `b = 6(P0 − 2P1 + P2)`
  - `c = 3(P1 − P0)`

  Keep roots in (0,1) and add the endpoints. Never use the control-point box.
- **Conversions.**
  - Quadratic to cubic: `C1 = P0 + ⅔(Q1−P0)`, `C2 = P2 + ⅔(Q1−P2)`.
  - Arc to cubic: handle length `k = (4/3)·tan(θ/4)·r`; split arcs at ≤90° (quarter circle: k ≈ 0.5523r).
- **Arc length.** 5-point Gauss–Legendre quadrature on `|B'(t)|`. Build a (t, s) lookup table and invert by binary search plus interpolation.
- **Flattening (Wang).** `n = ⌈√(3M / (4·tol))⌉`, with `M = max(|P0−2P1+P2|, |P1−2P2+P3|)`.
- **Catmull–Rom to Bézier (uniform form).**
  - `C1 = Pi + (Pi+1 − Pi−1)/6`
  - `C2 = Pi+1 − (Pi+2 − Pi)/6`
  - Use the centripetal (α = 0.5) knot parameterization to avoid cusps and loops.
- **Schneider fitting.**
  1. Chord-length parameterization.
  2. 2×2 least squares for the handle lengths with fixed end tangents.
  3. Newton–Raphson reparameterization.
  4. Split at the worst point and recurse.
- **Booleans.**
  1. Curve–curve intersections (Bézier clipping or subdivision with box rejection).
  2. Split curves at intersections.
  3. Classify fragments by midpoint winding against the other shape:
     - union keeps outside-other
     - intersect keeps inside-other
     - A−B keeps A-outside-B plus B-inside-A reversed
  4. Chain fragments into loops.
- **Corner fillet.**
  - Tangent distance `d = r / tan(φ/2)`, clamped to half of each adjacent edge.
  - Arc handle `k = (4/3)·tan((π−φ)/4)·r`.
- **Affine transforms.**
  - Pivot rotation: `T(p)·R(θ)·T(−p)`.
  - Transform control points directly (Béziers are affine-invariant), then recompute exact bounds.
- **Anchors.** `anchor(box, u, v) = (x + u·w, y + v·h)` with u, v ∈ {0, 0.5, 1}.
- **Distribute.** `gap = (span − Σsizes)/(n−1)`.
- **Blob.**
  - `θk = 2πk/N`
  - `rk = R·(1 + a·noise(cos θk·f, sin θk·f))`
  - Pass the points through closed centripetal Catmull–Rom. Sampling noise on a circle makes the loop seamless.
- **Poisson disk (Bridson).**
  - Grid cell size `r/√2`.
  - Active list; k = 30 candidates in the annulus [r, 2r].
  - Reject candidates outside the target shape using the winding test.
- **Along-path placement.** Positions at `s_i`, rotation `atan2(B'y, B'x)` at `t(s_i)`.
- **Color.**
  - OKLab: linear sRGB → LMS → cube root → Lab.
  - `C = √(a² + b²)`, `h = atan2(b, a)`.
  - Gamut mapping: reduce chroma until the color is inside sRGB.
  - WCAG contrast: `(L1 + 0.05)/(L2 + 0.05)`; ≥ 4.5 for body text.