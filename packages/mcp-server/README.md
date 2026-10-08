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
| `create_document(width, height, background?, seed?)` | New canvas; returns `doc_id` and the seed |
| `apply_ops(doc_id, ops[], dry_run?)` | All-or-nothing batch of drawing ops; per-op status, id, exact bounds, errors with hints |
| `render(doc_id, overlays?, region?, scale?, grid?)` | PNG image (also written to disk), with optional id, bounds and grid overlays |
| `export_svg(doc_id, precision?, optimize?, strip_ids?)` | Final SVG, optimized with SVGO |

Ops (22), by domain:

- shapes: `rect`, `ellipse`, `polygon`, `star`, `line`
- paths: `path_from_points`, `path_commands`, `round_corners`
- boolean: `boolean`
- transform: `transform`
- layout: `place`, `align`, `distribute`, `snap`
- style: `style`
- structure: `group`, `ungroup`, `reorder`, `duplicate`, `rename`, `clip`, `delete`

The `apply_ops` description lists each op's fields.

## Limits

Set with environment variables. Exceeding a limit returns an error that says which one; nothing hangs.

| Variable | Default |
|---|---|
| `AGENT_ILLUSTRATOR_MAX_OPS` (ops per batch) | 200 |
| `AGENT_ILLUSTRATOR_MAX_NODES` (nodes per document) | 5000 |
| `AGENT_ILLUSTRATOR_MAX_SEGMENTS` (segments per path) | 20000 |
| `AGENT_ILLUSTRATOR_MAX_DOCUMENTS` (open documents per server) | 50 |
| `AGENT_ILLUSTRATOR_MAX_RENDER_PIXELS` | 16777216 (4096²) |
| `AGENT_ILLUSTRATOR_RENDER_DIR` (PNG copies) | `<os tmp>/agent-illustrator` |
| `AGENT_ILLUSTRATOR_LOG_LEVEL` (stderr JSON logs) | `info` |

Heavy work (booleans, renders) runs synchronously and is bounded by these caps rather than by timeouts.
Documents live in memory for the life of the server process, under random ids (`doc-3f9a1c`). When the
document limit is reached, the least recently used document is closed; asking for it later says so.
Each render is also written to `<RENDER_DIR>/<doc_id>-<n>.png` (the last 4 per document) for clients
that do not show images.
