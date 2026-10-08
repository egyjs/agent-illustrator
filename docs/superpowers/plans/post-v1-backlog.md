# Post-v1 backlog: known limits and deferred minors

Collected 2026-10-08 so post-v1 work starts from one list. Product features stay in PROJECT_INIT §5 "Post-v1 backlog (ordered)"; spec S8 (animation as data) is pending an owner decision. Each item names where it was found. Re-check an item before working on it: later milestones may have closed it.

## Known limits (M5, M6, M8)
1. **Scatter inside detailed shapes is slow.** `within` tests each candidate with an O(edges) winding number; a 10k-segment shape with 2000 points takes about 4 s. Fix: an edge bbox index (rbush) or a coarse raster mask before the exact test. (`ops/repeat.ts`)
2. **Gradient angles live in the box's unit square.** On non-square boxes the color bands slant. CSS-style angles need per-node `userSpaceOnUse` defs. (`render/defs-svg.ts`)
3. **Filters clip far effects.** The filter region is ±100% of the box; a blur or shadow reaching past that is cut. Per-node `userSpaceOnUse` regions sized 3σ + |dx|, |dy| would fix it.
4. **Unknown font families fall back to Tajawal silently.** `RasterFonts` carries no family list, so no `font_fallback` warning. Ship a family list with the fonts.
5. **Text measured without bundled fonts is slow.** resvg loads the system fonts on every measurement. The server always passes fonts; library users should too, or cache a font database.
6. **Only Tajawal Regular/Bold are bundled.** Weights snap to 400/700; no italic, serif or mono family.
7. **RTL anchoring is physical.** `anchor: 'end'` puts the right edge of Arabic text at `x`; logical (direction-aware) anchoring is not implemented.
8. **Gradients, filters and masks on flat shapes render nothing** (bounding-box units need area). Ops warn `zero_extent`; a stroke-only gradient on a line needs `userSpaceOnUse`.
9. **Text-to-outlines, HarfBuzz shaping, paragraph wrapping** are out of v1 (PROJECT_INIT §4.3). Text cannot join booleans or act as a clip shape.
10. **The undo stack has no byte budget.** `DocumentStore` keeps the last 50 versions (`MAX_UNDO`) and up to `MAX_CHECKPOINTS` checkpoints by count only. Versions share unchanged nodes, but a session of large documents with sweeping edits can hold much more memory than the 50-document cap suggests. Fix: estimate each version's size when it is committed and drop the oldest versions past a byte budget (a `maxUndoBytes` limit next to `maxNodes`). (`scene/store.ts`)
11. **Region renders past the pixel budget lose layers.** `rasterize` draws a layer whole when it holds other layers (resvg misplaces nested layers, and aborts on one far outside a small render). When the area that takes passes `maxPixels`, the outer node's opacity, filter, mask, clip and blend are dropped for that render. A bigger budget or tiled rendering would keep them. (`render/raster.ts`)

## Deferred minors still open (M1–M4)
Full lists with context: the "Deferred minors" sections of the M1–M4 plans in this folder.
- **M1 geometry:** boolean with an empty operand returns the other one unreoriented; `roundCorners` next to a zero-length edge; tidy epsilons scale with operand size (tiny holes on huge canvases can drop); `decompose` on rank-1 matrices; `signedArea` precision near 1e7; one flatten test does not test a real hole; `docs/spikes.md` cites the old paper-shim path.
- **M2 scene/registry:** an explicit `undefined` in `options.limits` disables that cap; hint for prototype-named ids; caches go stale if called on an immer draft; `$last` can point at a deleted node, and checkpoints do not carry `lastCreated`; set and unset of one style key in one call; `toSvg` does not validate `precision`; documents from `createDocument`/`validateDocument` are not frozen; op ids validated in handlers, not schemas; small hint gaps.
- **M3 MCP slice:** region renders show geometry past the canvas that `export_svg` clips; `create_document` accepts sub-pixel canvases; `rasterize` copies pixels on every render; the `apply_ops` style-field list is hardcoded; an empty `AGENT_ILLUSTRATOR_LOG_LEVEL` throws; publishing needs pnpm (`catalog:`).
- **M4 ops:** boolean result loses a scaled operand's stroke scaling and hardcodes `nonzero`; `clip` with a zero-area shape hides the node silently; `round_corners` skips the segment cap; `transform` with `matrix` plus `rotate` does not turn in place; `ungroup` multiplies opacity into children; `star` roundness past ~0.21 stops changing silently; clipped `worldBounds` is a box intersection; grouping non-adjacent siblings reorders them silently; warnings carry no `hint`; `round_corners` radius is in local units.

Closed since: M2 #1 (non-finite geometry, `MAX_COORD`), M4 `ungroup` dropping filter/blend/mask (now refused).
