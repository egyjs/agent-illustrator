# agent-illustrator

Vector illustration tools for AI agents, served over MCP (stdio). The agent describes what to draw with
high-level ops; the engine owns the geometry, renders PNG previews the agent can look at, and exports clean SVG.

## Install

Requires Node.js 22.18 or newer. No native build step (resvg ships prebuilt binaries).

```sh
npx -y agent-illustrator --doctor   # checks the bundled fonts and content
```

## Client setup

Claude Code:

```sh
claude mcp add agent-illustrator -- npx -y agent-illustrator
```

Claude Desktop, Cursor, VS Code and other clients that read an `mcpServers` JSON block:

```json
{ "mcpServers": { "agent-illustrator": { "command": "npx", "args": ["-y", "agent-illustrator"] } } }
```

## Tools

| Tool | What it does |
|---|---|
| `create_document` | New canvas; returns `doc_id` and the seed |
| `apply_ops` | All-or-nothing batch of drawing ops; per-op status, id, exact bounds, errors with hints, and `lint` issues for the nodes it touched; `preview: true` also returns a PNG of the result without changing the document |
| `render` | PNG image (also written to disk), with optional id, bounds and grid overlays |
| `describe_scene` | The scene as text: canvas, tokens, defs and the node tree |
| `measure` | Exact bounds, area and length of nodes; gaps and overlaps between pairs |
| `lint` | Off-canvas, degenerate, tiny, near-miss, colliding and low-contrast problems, with ready `fix` ops |
| `history` | Named checkpoints, restore and undo |
| `document_io` | Save, load and list documents on disk |
| `export_svg` | Final SVG, optimized with SVGO |
| `guide` | The drawing guides, presets and op reference |

Ops (37), by domain:

- shapes: `rect`, `ellipse`, `polygon`, `star`, `line`
- paths: `path_from_points`, `path_commands`, `round_corners`, `trace`
- boolean: `boolean`
- transform: `transform`
- layout: `place`, `align`, `distribute`, `snap`
- style: `style`, `gradient`, `filter`, `mask`
- color: `tokens`, `palette`
- generators: `blob`, `wave`, `roughen`, `scatter`, `repeat_along_path`, `array`
- text: `text`, `text_on_path`, `set_text`
- structure: `group`, `ungroup`, `reorder`, `duplicate`, `rename`, `clip`, `delete`

The `apply_ops` description lists each op's fields; `guide` topic `op:<name>` shows one in full.

## Tool reference

`?` marks an optional input. Every tool takes a `doc_id` except `create_document`, `guide` and `document_io` (which needs one only to `save`).

| Tool | Inputs | Returns |
|---|---|---|
| `create_document` | `width`, `height` (px, up to 16384), `background?` (CSS color; omit for transparent), `seed?` (integer; random when omitted) | `{ doc_id, width, height, seed, closed? }`; `closed` lists the documents closed to make room (see Limits) |
| `apply_ops` | `doc_id`, `ops` (1 to 200 objects `{ "op": name, ... }`; see Limits), `dry_run?` (validate only), `preview?` (run the batch without changing the document and return a PNG of the result; implies `dry_run`) | `{ ok, committed, preview?, doc_id, results[], lint? }`; each result has `op`, `status`, `id`/`ids`, `bounds`, `warnings` or `error`; with `preview` a successful call also returns a PNG image (`committed` is `false`) |
| `render` | `doc_id`, `overlays?` (`ids`, `bounds`, `grid`), `region?` (`{ x, y, width, height }` in canvas px), `scale?` (up to 8; default 1), `grid?` (spacing in px) | A summary (`width`, `height`, `file`) and a PNG image |
| `describe_scene` | `doc_id`, `detail?` (`outline`, `normal`, `full`), `root?` (one subtree), `max_nodes?` (1 to 2000; default 300) | `{ canvas, seed, tokens, defs, nodeCount, shown, truncated, hint?, nodes[] }`; the list also stops at about 256 KB of JSON, or 20000 path segments at `full`, and `hint` then says to use `root` or a lower `detail` |
| `measure` | `doc_id`, `ids` (1 to 50 nodes) | `{ nodes: { id: { bounds, center, area, length } }, pairs[] }`; pairs (`gap`, `overlap`, `overlapArea`, `centerDistance`) for 2 to 12 ids |
| `lint` | `doc_id`, `checks?` (`off_canvas`, `degenerate`, `tiny`, `near_miss`, `text_overlap`, `contrast`, `overlap`; default all but `overlap`), `ids?` (check only these and what is below them), `tolerance?` (near-miss distance, px; default 2), `max_issues?` (1 to 200; default 50) | `{ issues[], truncated, checked[] }`; an issue is `{ code, severity, ids, message, hint, fix? }`, warnings first, then in the order `off_canvas`, `degenerate`, `no_ink`, `text_overlap`, `low_contrast`, `near_miss`, `partly_off_canvas`, `tiny`, `overlap`, `empty_group`; `near_miss` stops at 10 issues, and `overlap` and `text_overlap` at 200 pairs (`truncated` says so) |
| `history` | `doc_id`, `action` (`checkpoint`, `restore`, `undo`, `list`), `label?` (needed by `checkpoint` and `restore`) | `{ doc_id, action, checkpoints, undo_depth, nodes }` |
| `document_io` | `action` (`save`, `load`, `list`), `doc_id?` (for `save`), `name?` (for `save` and `load`; letters, digits, `_`, `-`, `.`; not a path; lowercased, so `Poster` and `poster` are one document) | `save`: `{ name, bytes }`; `load`: a new `doc_id` (and `closed?`, as for `create_document`); `list`: `{ documents[] }`. Files are `<name>.json` in `AGENT_ILLUSTRATOR_DOCS_DIR`; a save writes `<name>.json.tmp` and renames it, and a load is held to the node and segment limits |
| `export_svg` | `doc_id`, `precision?` (0 to 6 decimals; default 2), `optimize?` (SVGO; default true), `strip_ids?` (default false) | The SVG text |
| `guide` | `topic?` (`workflow`, a guide name, `ops`, `op:<name>`, `presets`, `preset:<name>`, `text-only`; omit for the index) | The guide text |

Any failure comes back as an error result (`isError`) with `{ error: { code, message, hint } }`: `invalid_input`, `unknown_id`, `limit_exceeded` and so on. The hint says how to fix the call. In an `apply_ops` batch the error sits on the failing op, and nothing is applied.

`apply_ops` lints the nodes a committed batch created or changed (the cheap checks only, at most 10 issues) and adds them as `lint`; the field is absent when there is nothing to report. The layers of a `trace` group are skipped there (stacked layers overlap on purpose); the `lint` tool does not skip them.

## Reference images

The `trace` op turns a reference image into editable vectors, like Illustrator's Image Trace: it reduces the image to `colors` colors and traces each into one path, inside one group (`meta.source.kind` `trace`). `image` is the path of a PNG or JPEG file, absolute or relative to the server's working directory; the server reads it, so the agent passes a path, never pixels. Only vectors come back. Other inputs: `method` (`abutting`, the default, whose layers share edges and leave no gaps, or `stacked`), `speckle`, `max_size` (64 to 2048), `region` (a box of the image, in image px) and `x`, `y`, `width`, `height` (where the whole image goes on the canvas). The agent kit has a `trace` guide, and the usual flow is `apply_ops` with `preview: true` first, then the same call for real. Trace only images you have the rights to.

Image files up to 25 MB and 36 megapixels are read (decoded once and kept in a cache of 36 million pixels, one image at the decoder's cap, so the preview and the commit that follows share one decode); a phone photo should be rotated upright first, because EXIF orientation is ignored.

## Prompt

`illustrate` (arguments `brief`, `style?` preset name, `vision?` `yes`/`no`) starts the workflow: plan, block in, detail, critique, export. With `vision: "no"` it adds the text-only guide, which replaces `render` with `describe_scene`, `measure` and `lint`. Style presets: `flat`, `isometric-lite`, `line-art`.

## Limits

Set with environment variables, except the image caps, which are fixed. Exceeding a limit returns an error that says which one; nothing hangs.

| Variable | Default |
|---|---|
| `AGENT_ILLUSTRATOR_MAX_OPS` (ops per batch) | 200 |
| `AGENT_ILLUSTRATOR_MAX_NODES` (nodes per document) | 5000 |
| `AGENT_ILLUSTRATOR_MAX_SEGMENTS` (segments per path) | 20000 |
| `AGENT_ILLUSTRATOR_MAX_GENERATED` (copies or samples per generator op) | 2000 |
| `AGENT_ILLUSTRATOR_MAX_DOCUMENTS` (open documents per server) | 50 |
| `AGENT_ILLUSTRATOR_MAX_RENDER_PIXELS` | 16777216 (4096²) |
| `AGENT_ILLUSTRATOR_RENDER_DIR` (PNG copies) | `<os tmp>/agent-illustrator` |
| `AGENT_ILLUSTRATOR_DOCS_DIR` (`document_io` saves and loads) | `%LOCALAPPDATA%\agent-illustrator\docs` on Windows, else `$XDG_STATE_HOME` or `~/.local/state` + `/agent-illustrator/docs` (a folder for you alone, created with mode 700) |
| `AGENT_ILLUSTRATOR_LOG_LEVEL` (stderr JSON logs) | `info` |
| Image file read by `trace` (fixed) | 25 MB |
| Image size decoded by `trace` (fixed) | 36 megapixels (about 6000×6000) |

Heavy work (booleans, renders) runs synchronously and is bounded by these caps rather than by timeouts.
Documents live in memory for the life of the server process, under random ids (`doc-3f9a1c`). When the
document limit is reached, the least recently used document is closed; `create_document` and `document_io` `load` name it in `closed`, and asking for it later says so.
Each render is also written to `<RENDER_DIR>/<doc_id>-<n>.png` (the last 4 per document) for clients
that do not show images.
