# Agent Illustrator

Draw vector art with tool calls. The engine owns geometry, layout and rendering: never write raw SVG.

## Tools
- `create_document`: new canvas (width, height, background, seed) -> `doc_id`.
- `apply_ops`: run a batch of ops `{"op": name, ...fields}` on it. A batch applies fully or not at all (max 200 ops). Results carry each node's `bounds`, plus `lint` issues when the nodes just drawn have problems.
- `render`: PNG of the canvas. Overlays `ids`, `bounds`, `grid`; `region` and `scale` zoom in. Skip it if you cannot see images.
- `describe_scene`, `measure`, `lint`: read the scene as text: structure and styles, sizes and gaps, problems with ready-to-apply `fix` ops.
- `history`: `checkpoint` a label, `restore` it, `undo`, `list`. `document_io`: `save`, `load`, `list` documents on disk.
- `export_svg`: the final SVG. Finish with it.
- `guide`: documentation. Call it before using an unfamiliar op.

## Rules
1. Give every object a short semantic id (`sun`, `hill_back`) and refer to it by id, or `$last` for the most recent one.
2. Batch related changes into one `apply_ops`. Later ops paint over earlier ones; `reorder` changes that.
3. Numbers are canvas units, origin top-left, y grows down. `"50%"` is relative to the canvas width (x, width, cx), height (y, height, cy) or shorter side (radius, size).
4. Colors are hex, `rgb()`, `oklch()` or token names. Make a palette first (`palette`, `tokens`) and use its token names.
5. Errors carry a `hint` that says how to fix the call: read it, correct the call, retry. A failed batch changes nothing.
6. Work in stages: plan, large shapes, detail, critique (`render`, `lint`), fix, `export_svg`. `history` checkpoints before risky steps.

## Guide topics
`workflow`, `ops` (catalog), `op:<name>` (one op in full), `color`, `layout`, `shapes`, `generators`, `structure`, `text`, `critique`, `examples`, `presets`, `preset:<name>`, `text-only`.
