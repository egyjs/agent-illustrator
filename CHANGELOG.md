# Changelog

## Unreleased

- `trace` op: reduces a reference PNG or JPEG to N colors and traces each into an editable path (VTracer, `@visioncortex/vtracer`), stacked or abutting, with `region` and placement. The 37th op.
- `apply_ops` `preview: true` runs a batch without changing the document and returns a PNG of the result.
- Image source: the server reads reference images from a file path (PNG or JPEG, up to 25 MB and 36 megapixels) and caches the decoded pixels. Lint skips the layers of a trace group.
- `--doctor` prints `tracer: ok`, or why the tracer failed to load (exit 1). New agent-kit guide `trace`.
- MIT license (`LICENSE`, `license` fields; the built bundle carries it in `dist/`).
- CI: `pnpm/action-setup@v6` (Node 24); build runs before tests so the eval server tests run in CI.
- README: install from source until the package is on npm.
- `rasterize` without bundled fonts loads the system fonts only when something draws text (text nodes or the `ids` overlay); renders without text no longer pay seconds of font loading on hosts with many fonts.

## 1.0.0 (2026-10-08)

First release: a vector illustration engine for LLM agents, served over MCP stdio.

- **Engine:** cubic-Bézier geometry with exact bounds; paper.js booleans; 36 ops across shapes, paths, booleans, transforms, layout (place, align, distribute, snap), structure, style, color (OKLCH palettes, tokens, OKLab gradients, filters, blend, masks), seeded generators (blob, wave, roughen, scatter, repeat along path, arrays) and native text (Latin and Arabic, text on a path). Transactional batches with `{code, message, hint}` errors; same seed and ops give the same SVG.
- **Server:** 10 tools (`create_document`, `apply_ops`, `render`, `export_svg`, `describe_scene`, `measure`, `lint`, `history`, `document_io`, `guide`) and the `illustrate` prompt. Bundled fonts, PNG renders with overlays, SVGO export, incremental lint after every batch, undo and checkpoints, saves confined to a per-user folder.
- **Agent kit:** core contract (server instructions), workflow, topic guides, three style presets, a text-only overlay; every example in it is run in CI.
- **Evaluation:** render-regression baselines in CI (Linux and Windows); a dev-only harness that drives Claude Code on a subscription; 20 briefs with a raw-SVG baseline. Acceptance: spec A5.
- **Known limits:** `docs/superpowers/plans/post-v1-backlog.md`.
