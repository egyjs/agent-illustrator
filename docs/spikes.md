# M0 spike findings

Each section records what the in-repo spike tests proved, with the date, OS and Node version, and
links the spec decision it settles. The pre-M0 library check (spec "Outcomes recorded") is the baseline.

## R1: paper.js headless (settles spec S6)
- Tests: `spikes/test/r1-paper.test.ts` (8/8 pass, 2026-10-08, Windows 11, Node 24.13.1).
- Import: `import paper from 'paper/dist/paper-core.js'` plus `spikes/src/paper-shim.d.ts` (`export default paper;` works). No jsdom in the install.
- Data shape: spec A3 subpaths (`start`, `segs` as `[c1x,c1y,c2x,c2y,x,y]`, `closed`). Open and closed paths round-trip exactly.
- Booleans:
  - unite/intersect/subtract/exclude areas are exact (175/25/75/150).
  - An edge-sharing unite gives one subpath.
  - **Finding F3:** exclude returns children with opposite orientation (+75 and -75), so the raw signed `area` cancels to about 0. They still fill correctly under nonzero and even-odd.
  - `reorient(true, true)` normalizes the result.
  - The M1 `paper-adapter` must reorient every boolean result before converting it to the scene, otherwise `measure` area and winding tests are wrong.
- `simplify(2.5)`: 200 noisy points → 13 segments, every input point within 4 units of the fit.
- `smooth({ type: 'catmull-rom', factor: 0.5 })` keeps anchors and adds handles.
- `insert: false` everywhere leaves the scope's `project.isEmpty()` true. **paper still has global state, though (finding F5, from the final review):**
  - `scope.Path` is the same class for every scope. With the default `insert`, new items attach to the most recently created or activated scope, not the one they were built from.
  - Every `PaperScope` stays in the static `PaperScope._scopes` registry, so creating one scope per operation leaks.
  - Tests: `F5: constructors attach…` and `F5: every PaperScope stays…`.
  - **M1 rule:** use one long-lived scope (or a small pool), call `scope.activate()` at the start of every adapter call, and use `insert: false` everywhere. This replaces PROJECT_INIT §2.4's "fresh PaperScope per operation".
- `Path.add()` is typed `Segment | Segment[]`; use `path.lastSegment` after adding.
- 200 successive unites: 417 ms on Windows 11 / Node 24.13.1.
- Result: Confirmed (S6 adopted), plus finding F3.

## R2: resvg-js text (settles spec S2; confirms finding F1)
- Tests: `spikes/test/r2-resvg-text.test.ts` (7/7 pass, 2026-10-08, Windows 11, Node 24.13.1). PNGs in `spikes/out/` (not committed).
- resvg-js 2.6.2 installed the `win32-x64-msvc` prebuild with no compile step.
- Fonts: Tajawal Regular/Bold (OFL, about 60 KB each) in `packages/engine/assets/fonts/`, `loadSystemFonts: false`. An unknown family ("Arial") falls back to the default family.
- `getBBox()` of a single `<text>`: "Hello" at 40px gives x=13.6 y=44.2 w=79.4 h=26.28, a tight ink box. Used for text bounds instead of opentype.js.
  - `BBox` is a native object: `JSON.stringify` gives `{}`, so read the fields explicitly.
- Arabic shaping: joined "بيت" is narrower than the ZWNJ-isolated letters. Visual check passed.
- **F1 confirmed and refined:**
  - `direction="rtl"` is ignored for the paragraph base direction.
  - "مرحبا Hello" renders with the Arabic on the left (wrong). Wrapped in U+2067…U+2069 (RLI…PDI), it renders "Hello" on the left (correct).
  - Arabic followed by digits ("عدد 123") renders correctly either way, because the digits join the RTL run. That makes it a bad test string.
  - Also, `text-anchor` "start" stays at the left x even with `direction="rtl"`.
  - **Engine rules for M8:** wrap RTL text content in RLI…PDI when serializing, and compute RTL anchoring in the engine (from the `getBBox` width) instead of relying on `direction`.
- `textPath` (`xlink:href`) renders along the curve. `toString()` outputs text as paths.
- Result: Confirmed (S2 adopted; F1 confirmed with a discriminating string).

## R3/R4: MCP SDK v2 stdio server (settles spec S1; R3 client matrix in `eval/clients.md`)
- Tests: `spikes/test/r4-mcp.test.ts` (8/8 pass, 2026-10-08, Windows 11, Node 24.13.1). Server: `node spikes/src/mcp-probe-server.ts` (Node type stripping, no build).
- API used, all working as documented in the spec: `new McpServer(info, { instructions })`, `registerTool(name, { inputSchema: z.object(...) }, handler)`, `registerPrompt(name, { argsSchema }, cb)`, `await serveStdio(factory)`. Client: `StdioClientTransport`, `getInstructions()`, `listTools()`, `callTool()`, `getPrompt()`. Differences from the spec: none.
- stdout purity: startup plus `initialize` (protocol 2025-11-25) produce only JSON-RPC lines.
- Image block: `{ type: 'image', data: <base64 PNG>, mimeType: 'image/png' }` arrives intact next to a text block.
- Schema sizes: union `inputSchema` is 14,991 bytes; loose is 638 bytes (about 23× smaller). No `$ref`/`$defs`, even with a shared `point` sub-schema reused 50 times.
- Loose schema behaviour:
  - A malformed op (missing `at`) comes back as `isError` with zod's prettified path `[0].at`.
  - An unknown op name is rejected by the advertised enum.
  - Valid ops pass.
- MCP Inspector 2.9.0 CLI `tools/list`: 3 tools, exit 0.
- **Finding F4:** Inspector's schema-portability check warns on the loose schema. `z.looseObject` emits `additionalProperties: {}` ("accepts any value"), and Inspector suggests `{"type":"object","additionalProperties":true}`. The union schema had no warning.
  - **M3 rule:** advertise the `apply_ops` item schema with an explicit `additionalProperties: true` (post-process the zod JSON Schema or use the SDK's `fromJsonSchema()`), and keep strict per-op zod validation on the server.
- Result: Confirmed (S1 adopted), plus finding F4.

## R3: clients
See `eval/clients.md`. Inspector CLI passes. Claude Desktop and Claude Code rows are pending the owner's run.

## Summary (2026-10-08)
- S1 (loose `apply_ops` schema): Confirmed. Advertise `additionalProperties: true` explicitly (F4).
- S2 (text bounds via resvg getBBox): Confirmed.
- S6 (paper core without jsdom): Confirmed.
- F1 (RTL needs RLI…PDI wrapping): Confirmed. RTL anchoring is also computed by the engine.
- F3 (new): boolean results need `reorient(true, true)` before area/winding use (M1 paper-adapter).
- F4 (new): loose item schema must spell `additionalProperties: true` (M3).
- F5 (new, final review): paper constructors follow the last activated scope and scopes are never released. Use one long-lived scope plus `activate()` per call, not a scope per operation (M1).
- Image delivery in real clients: pending `eval/clients.md` rows (decides how much M3 leans on the FR-11.2 disk fallback).
- Linux confirmation: pending the first CI run.
- Changes the M1–M3 plans must absorb: F3 and F5 (M1), F1 anchoring note (M8), F4 (M3).
