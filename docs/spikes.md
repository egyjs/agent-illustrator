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
- `insert: false` everywhere leaves `project.isEmpty()` true, so no shared paper state.
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
