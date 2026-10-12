# Design: `trace` op (reduce a reference image to N colors, then vectorize it)

## Context
Agents can draw vectors but can't use a reference raster. Run B in `todo.md` got its biggest quality gain from a homemade posterize-and-trace script (canopy 6 layers, bark 5). The user wants this built in, Illustrator Image Trace style: **reduce the image to N colors**, then **trace each color into an editable path** (one path per color, recolorable, removable, exportable as SVG that Illustrator opens).

Decisions made with the user (2026-10-12):
- **Input is a file path.** The agent (Claude Code) has the image and passes its path. No names-only rule and no confined folder for images.
- **Tracer:** `@visioncortex/vtracer`, the official package from the VTracer authors. It is WASM (no native binary), MIT OR Apache-2.0, and still alpha `1.0.0-alpha.4`, so it gets an exact pin and sits behind one adapter file, with our own code as the fallback.
- **Color reduction is our code** (seeded k-means), so it stays deterministic.
- **Layering:** `abutting` by default. It uses VTracer's palette cutout mode, whose regions share edges (0 gap pixels in the spike), so the geometry has no gaps; a faint antialiasing line can still show along the shared edges on a light background. `stacked` is an option: each color runs under the colors above it, so lower layers can show as a thin dark ring at antialiased edges. Stacked was the first choice, when abutting was expected to show seams; the owner switched the default on 2026-10-12 after a real logo trace showed those rings.
- **Preview before committing:** `apply_ops(..., preview: true)` returns a render of the result without committing.
- **`todo.md` is updated to match this plan** (it conflicted). See "todo.md changes".
- It is an op, **`trace`**, in the registry (todo.md: "the op registry is the single source of truth"; §3.2 names a "`trace` op"). So it runs inside `apply_ops` batches, `dry_run`, and later `ops_file` (§2.2). No new tool; the count stays 10.

Scope: PNG + JPEG (whatever the resvg decode spike confirms), one op, `preview` on `apply_ops`. Not included: underlay, `sample`, compare render, fixed `palette` input (they stay §3 proposals and build on this).

## Architecture
```
apply_ops({doc_id, ops:[{op:'trace', image:'C:/…/logo.png', colors:6}], preview:true})
  server images.ts  ImageSource.get(path): resolve vs cwd, device-name/stat/size checks, read
     └─ decodeImage(bytes) (engine render/image.ts, resvg) → RasterImage {width,height,pixels}; LRU by pixels
  executeBatch(registry, doc, ops, { images, … })
     op trace (ops/trace.ts) → ctx.image(path)
        crop region → downscale to max_size → quantize (trace/quantize.ts)
        → layerMasks (stacked|abutting) → traceMask per layer (trace/vtracer.ts)
        → insertNew group (meta.source.kind 'trace') + addPath per color (evenodd)
  preview: no commit; rasterize(result doc) → text + image block
```

## Engine
1. **`ops/registry.ts`**: `export type ImageSource = { get(ref: string): RasterImage }`. `BatchOptions.images?: ImageSource`. `OpContext.image(ref)` throws `invalid_input` when there is no source ("library callers pass `images` to executeBatch"). A source's own errors (missing file and so on) pass through as `EngineError`.
2. **`render/image.ts`** (resvg lives in render):
   - `RasterImage = {width, height, pixels}` (straight-alpha RGBA).
   - `imageSize(bytes)` reads the PNG IHDR or the JPEG SOFn header and refuses anything else. It refuses more than `MAX_IMAGE_PIXELS = 36e6` before decoding (stops decompression bombs).
   - `decodeImage(bytes, maxSide?)` renders `<svg width height><image href=…/></svg>` through resvg at 1:1 or downscaled. It un-premultiplies if the spike shows resvg output is premultiplied.
   - If resvg can't decode exactly, the fallback is `pngjs` (catalog, pure JS, PNG only).
3. **`trace/quantize.ts`** (new layer `trace`: may import `geometry`, `random`):
   - `quantize(pixels, colors, rng)`: alpha < 128 is transparent. A 5-bit/channel histogram feeds OKLab (`culori`), then weighted k-means++ (≤ 20 iterations), with k = min(colors, non-empty bins). Palette colors are the weighted sRGB means as hex, merged when equal, sorted by pixel count, largest first.
   - `stackedMask(index, k, into?)`: stacked mask k = rank ≥ k, built one layer at a time into a reusable buffer. Abutting regions come from `traceRegions`.
4. **`trace/vtracer.ts`**: the only importer of `@visioncortex/vtracer`, loaded lazily through `createRequire` so a load failure fails only `trace`, never startup.
   - `traceMask(mask, w, h, {speckle}) → Subpath[]` uses `convertPixels(rgba, w, h, {clustering:'bw', mode:'spline', filterSpeckle, cornerThreshold:60, lengthThreshold:4, spliceThreshold:45, maxIterations:10, pathPrecision:3})`. The `<path d transform=translate>` output goes through `parsePathData` (`geometry/pathdata.ts:13`) and `translate` (`geometry/transform.ts:30`).
   - `traceRegions(index, palette, w, h, {speckle})` uses the palette cutout mode (`colorPrecision: 8`, `layerDifference: 0`, so VTracer never merges palette colors). Transparent pixels get a key color: of the 27 colors with channels in {0, 128, 255}, the one farthest from every palette color. A fill that is not in the palette goes to the nearest palette color.
   - `traceAvailable()` for `--doctor`.
   - Use the package's types, or add a shim like `analysis/rbush-shim.d.ts`.
5. **`ops/trace.ts`**: op `trace`, domain `paths`, registered in `ops/index.ts`.
   - Fields: `image` (path string), `region?` `{x,y,width,height}` image px, `colors` 2–32 (default 8), `method` (default `abutting`), `speckle` 0–64 (default 4), `max_size` 64–2048 (default 1024, applied to the region), `x?,y?,width?,height?` (`Length`, placement of the **whole** image; default fits the canvas, centered; one side given derives the other; region traces of one image line up), `id?`, `parent?`.
   - RNG: `rngFor(doc.seed, image, 'trace')`, seeded from the image reference rather than the group id, so a preview and the commit that follows get the same palette even when auto ids differ.
   - Group via `insertNew` (as `ops/repeat.ts:61` does) with `meta.source = {kind:'trace', image, region, colors, method, speckle, size:{w,h}}`. Then `addPath` (`ops/common.ts:104`) per layer, bottom to top: `style.fill = hex`, `fillRule: 'evenodd'`, ids `<group>-1…n`.
   - Stacked layers are traced one at a time and abutting regions in one call; each layer is checked against the limit as soon as it exists, so a stacked call fails at the first offending layer.
   - Over `maxSegmentsPerPath` → `limit_exceeded` with the hint "lower colors or max_size, raise speckle, or trace a smaller region". Fully transparent → `invalid_input`.
   - Returns `{id, ids, data:{layers:[{id,color,share}], image:{width,height}, traced:{width,height}}}`.
   - The description includes "Trace only images you have the rights to." Example: `{op:'trace', id:'logo', image:'logo.png', colors:4}`. The op's test file runs it with a fixture `ImageSource`.
6. **`index.ts`**: export `decodeImage`, `imageSize`, `MAX_IMAGE_PIXELS`, `traceAvailable`, `type ImageSource`, `type RasterImage`.
7. **Deps:** catalog + `packages/engine` + `packages/mcp-server` dependencies: `'@visioncortex/vtracer': 1.0.0-alpha.4` (and `pngjs` only on the fallback path). **`eslint.config.js`**: `LAYER_BANS.trace = ['scene','ops','analysis','render']`.

## MCP server
- **`images.ts`** (new): `imageSource(): ImageSource`.
  - `get(path)`: `resolve(path)` against the server cwd. Refuse Windows device names (export `DEVICE` from `history-tools.ts:46`). `statSync` must be a file. ≤ `MAX_IMAGE_BYTES = 25 MB`.
  - Read, then `decodeImage`, cached in an LRU keyed by resolved path + mtime + size, with a budget of `MAX_IMAGE_PIXELS` (36 million) decoded pixels: one image at the decoder's cap.
  - Errors name the resolved path and the cwd, and never echo file bytes. The hint is "pass an absolute path to a PNG or JPEG".
- **`tools.ts` `apply_ops`**:
  - Pass `images` to `executeBatch`.
  - New optional `preview: boolean`: run the batch, never commit, and return the usual result body plus a `rasterize` PNG of the would-be document (`fonts`, `maxRenderPixels`). It implies `dry_run`.
  - Add `preview` to `applyOpsInputSchema`.
  - `lintTouched` skips ids inside a `meta.source.kind === 'trace'` group (stacked layers overlap by design). Only that lint, in the `apply_ops` reply, skips them; the standalone `lint` tool does not.
- **`cli.ts`**: add `images: imageSource()` to `deps`. `--doctor` prints `tracer: ok` or the reason (exit 1).

## Agent kit and docs
- `guides/trace.md` (≤ 80 lines, topic `trace`):
  - Pass the image's path.
  - `preview` first, compare with the reference, then commit.
  - Picking `colors`: logo 2–6, flat art 6–12, poster or photo 12–24.
  - `region` per object (canopy, bark), so the traces line up.
  - `abutting` when regions get edited one by one.
  - Cleanup: remove the background layer, recolor with `style`/tokens.
  - Rights: trace only images you have the rights to.
  - EXIF: rotate phone photos first.
- `core-contract.md`: add `trace` to the topics line only (stay ≤ 30 lines). `workflow.md`: one line on starting from a reference image.
- `packages/mcp-server/README.md`: `apply_ops` `preview`, the `trace` op, the image size and pixel caps in the limits table. `README.md`: VTracer license note. `CHANGELOG.md` Unreleased.
- Spec copy: `docs/superpowers/specs/2026-10-12-trace-design.md`.

## todo.md changes (untracked file; edit it, don't commit it)
- **Rules:** delete the bullet "File tools take names, never paths, and stay inside the docs folder. Reuse the checks in …history-tools.ts…". Items 1.1, 1.3 and 2.2 keep their own wording (each already says to use document_io's name rules), so they still read correctly.
- **§3.1 Reference image:** replace "Image files go by name, never by path." with: images are read from a path through the server's `ImageSource` (`packages/mcp-server/src/images.ts`) and decoded by `decodeImage` (engine `render/image.ts`, resvg), which the underlay, `sample` and compare build on. The resvg question is answered.
- **§3.2 `trace` op:** mark it implemented on branch `feat/trace` (op `trace`, `apply_ops` `preview`). The proposal covers only follow-ups (fixed `palette` input, rights-notice wording); the rights concern is handled in the op description and `guides/trace.md`.
- **§1.7:** add `trace` to the generator-group kinds whose children lint skips (one summary per group).
- **§4.1 Reference-photo workflow:** add "block in masses with `trace` per region, then refine".

## Tests (TDD; fixture PNG made in-test with resvg `render().asPng()`, plus a tiny committed JPEG under `packages/engine/test/fixtures/`)
- **Spikes first:**
  - `render/image.test.ts`: resvg decodes PNG and JPEG to exact pixels at 1:1, with alpha straight or un-premultiplied. Header sizes. The pixel cap. A non-image is refused. Downscale size.
  - `trace/vtracer.test.ts`: a square traces to 1 closed subpath, ±1 px. A ring gives outer + hole, and an island inside the hole is kept. Identical output twice. No white background path.
- `trace/quantize.test.ts`: exact hexes for a 3-color image. colors > unique colors gives the unique count. Transparent pixels are excluded. Seed determinism. Masks nest (stacked) and partition (abutting).
- `ops/trace.test.ts`: runs the example. Layers, fills, order. Placement (default, one side, box, %). `region` traces line up with a full trace. `parent` inside a transformed group. `limit_exceeded`. No image source. Same seed → same `toSvg`.
- `mcp-server/test/images.test.ts`: relative path resolves against cwd. Missing file, folder, device name, oversize, non-image. The LRU picks up a changed file.
- `tools.test.ts`: `preview` returns an image block and the document doesn't change. A committed trace gives no lint on the layers. `history undo` removes it.
- All existing tests and the render baselines are unchanged.

## Verification
1. `pnpm check` green on each commit. `pnpm build && pnpm smoke`. `node packages/mcp-server/dist/cli.mjs --doctor` shows `tracer: ok`.
2. Manual in Claude Code with the local build: "trace ./logo.png to 4 colors". The agent previews, commits, and `export_svg` gives SVG that opens in Illustrator.
3. CI on Linux and Windows.

## Commits (branch `feat/trace` off `main`, one per item, no push)
1. `docs(spec): trace design` (also edit todo.md, uncommitted)
2. `feat(engine): decode reference images with resvg`
3. `feat(engine): vtracer adapter and color quantizer`
4. `feat(ops): trace op`
5. `feat(server): image source and apply_ops preview`
6. `docs(agent-kit): trace guide`
7. `docs: README, server README, CHANGELOG`

Per the user's fan-out preference: the lead does 1–3 (foundation and spikes). Then two Sonnet agents on disjoint files: **A** does item 4. **B** does item 5, with 6 drafted. The lead integrates; one Sonnet reviewer and one fixer follow.

## Risks
- vtracer is alpha: exact pin, one adapter file, spike tests that pin the behavior we rely on, a doctor check. The fallback is marching squares + `fit()` (`geometry/paths.ts:246`).
- Path input lets the agent point at any local file. Only PNG/JPEG headers are accepted, and nothing but vectors comes back, so the tool can't leak file contents.
- resvg ignores JPEG EXIF orientation (the guide covers it). Big photos can hit the segment cap; the hint points to region, colors, max_size and speckle.

## Open: wavy edges (investigated 2026-10-12, not yet fixed)
Symptom: traced curves and slanted lines have bumps of about ¼ px (worse when the image is enlarged on the canvas).
Root cause, measured on a radius-60 disc and a 600×400 logo:
1. Color reduction snaps each antialiased edge pixel to one palette color, so the tracer sees a 1-pixel staircase.
2. VTracer's cutout mode (`traceRegions`) follows that staircase closely: 65–126 segments for one circle. Its corner, splice, length and iteration thresholds barely change this, and its `simplify` option opens gaps and rounds corners.

Tried and rejected: supersampling (upscale 2–4× before tracing). The bumps get 2–3× smaller but remain as fine scallops when zoomed, and SVGs grow 5–7×.

Chosen fix (owner approved; no supersampling and no `smooth` option):
- Trace **abutting** like stacked: one black-and-white mask per color through `traceMask`.
- The mask is the color's own pixels plus opaque pixels of higher-ranked colors within 1 px of them. Each layer then runs a hidden 1-px strip under the colors drawn above it, so visible edges stay exact and no gaps show.
- Measured: a circle in **7 segments** (wobble 0.117 px, low-frequency), 0 holes at 8× zoom, an exact square, logo 394 segments (cutout gave 660), no rings around shapes (the strip is the real neighbor's color), and the snow cap is kept.
- Remaining nit: an occasional slight kink where two curve segments meet (VTracer corner detection).

Next steps:
1. Tests first:
   - `abuttingMask(index, w, h, k, reach = 1, into?)` in trace/quantize.ts: own pixels plus a strip into higher ranks only, never into lower ranks or transparent pixels.
   - An op test: the default abutting traces the disc in ≤ 16 segments with wobble < 0.15.
2. ops/trace.ts: both methods trace per layer with `traceMask` (stacked uses `stackedMask`, abutting uses `abuttingMask`), with a per-layer segment-limit check.
3. Remove `traceRegions` and its key-color logic. Keep the op-level tests for black on transparent and for a near-black body with a white mark.
4. Docs:
   - The op description, guides/trace.md, the server README and the CHANGELOG say abutting = exact visible edges, each layer a pixel under its neighbors above, no gaps.
   - Drop the "faint antialiasing line" caveat if a 1:1 render shows none.
5. `pnpm check`, `pnpm build && pnpm smoke`, then regenerate the demo in C:\Users\el3za\tmp\agent-illustrator\trace-demo and compare zoomed renders.
Separate issue seen: k-means can give a small distinct color's slot (the 0.5% snow cap) to antialiased in-between pixels, depending on the seed. A possible fix is to weight flat-area pixels above edge pixels in the histogram.

## Resolved (2026-10-13): coverage-field tracing replaces VTracer
Measured with a fidelity harness: each reference is traced at 1:1, the result is re-rendered, and it is compared with pixelmatch (threshold 0.1, antialiased pixels counted) against the input at 1:1, against the vector source at 4×, and within an edge band (pixels within one source pixel of an edge, at 4×).

| | 1:1 | 4× | edge band | palette |
|---|---|---|---|---|
| Logo, VTracer cutout | 99.09% | 99.22% | 86.23% | 5 colors, the white snow lost |
| Logo, coverage tracing | **100.00%** | **99.95%** | **98.38%** | the 6 exact source colors |
| Mark, VTracer cutout | 99.05% | 99.54% | 89.53% | |
| Mark, coverage tracing | **99.98%** | **99.95%** | **98.95%** | |

Pipeline (engine `trace/`, no tracing dependency; the approach follows open-vectorizer's published description):
1. **Palette from interior pixels** (`coverage.ts` `interiorPixels`, `quantize`). Edge pixels are blends and would win phantom slots. A second round adds pixels no blend explains (`unexplained`), so hairlines and dots keep their color.
2. **Coverage** (`coverage.ts`). Each edge pixel is solved as pixel = t·A + (1 − t)·B in premultiplied RGBA. The pair is searched among the colors of its 3×3 neighborhood, with all pairs as the fallback. Anchoring on the nearest color picked green+white for a navy/sky blend and put the edge 0.16 px off.
3. **Layer fields** (`contour.ts` `layerField`). Abutting = own coverage, plus colors drawn above within 2 px (a hidden strip). Stacked = own coverage plus every color above.
4. **Isolines at ½** (`contour.ts`). Marching squares places each crossing from the edge distance its partly covered pixel implies, given the local edge normal. Raw outline error is about 0.035 px RMS against 0.06 px for linear interpolation.
5. **Fitting** (`fit.ts`):
   - corners where the outline turns more than 35° over ±2.5 px;
   - straight runs become lines, with each corner where its neighboring lines meet (this undoes the marching-squares chamfer);
   - a corner-free loop within 0.06 px RMS of a circle becomes an exact circle (Kåsa fit plus Gauss–Newton refinement);
   - everything else gets Taubin smoothing (60 passes, no shrinking), then a Bézier fit at 0.04 px.
   - A circle is now 4 segments; VTracer used 65–126.

Left: the edge band stops short of 99% because of per-pixel noise from the input's antialiasing (about 0.03 px), small glyph details, and pixels where three colors meet.
