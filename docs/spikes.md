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
