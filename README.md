# agent-illustrator

Vector illustration for AI agents, served over MCP (stdio). The agent says what to draw with high-level ops; the engine owns geometry, layout and rendering.
It returns exact bounds after every batch, PNG previews the agent can look at, text-only checks (`describe_scene`, `measure`, `lint`) for models that cannot see, and clean optimized SVG.
A packaged guide and prompt teach any tool-calling model the workflow: plan, block in, detail, critique, export.

## Install

Requires Node.js 22.18 or newer. No native build step.

```sh
npx -y agent-illustrator --doctor   # checks the bundled fonts and content
```

## Client setup

Claude Code:

```sh
claude mcp add agent-illustrator -- npx -y agent-illustrator
```

Claude Desktop (`claude_desktop_config.json`), Cursor, VS Code and any other client that reads an `mcpServers` block:

```json
{ "mcpServers": { "agent-illustrator": { "command": "npx", "args": ["-y", "agent-illustrator"] } } }
```

Any other MCP client: run `npx -y agent-illustrator` as a stdio server.

## Tools

| Tool | What it does |
|---|---|
| `create_document` | New canvas; returns `doc_id` and the seed |
| `apply_ops` | All-or-nothing batch of drawing ops; returns each op's id and exact bounds, plus `lint` issues for the nodes it touched |
| `render` | PNG of the canvas, with optional id, bounds and grid overlays and a zoom region |
| `describe_scene` | The scene as text: canvas, tokens, and the node tree with bounds and styles |
| `measure` | Exact bounds, area and length of nodes, and the gaps and overlaps between them |
| `lint` | Off-canvas, tiny, misaligned, colliding and low-contrast problems, with ready `fix` ops |
| `history` | Named checkpoints, restore and undo |
| `document_io` | Save, load and list documents on disk |
| `export_svg` | The final SVG, optimized with SVGO |
| `guide` | The drawing guides, style presets and op reference |

Inputs and return values: [packages/mcp-server/README.md](packages/mcp-server/README.md#tool-reference).

## Prompt and guide

- The `illustrate` prompt takes a `brief`, an optional `style` preset (`flat`, `isometric-lite`, `line-art`) and `vision: "no"` for models that cannot see images (it adds the text-only guide).
- `guide` with no topic lists the topics: `workflow`, `color`, `shapes`, `layout`, `generators`, `structure`, `text`, `critique`, `examples`, `text-only`, `ops` (all 36 ops by domain), `op:<name>` (one op in full), `presets` and `preset:<name>`.
- The server instructions (the core contract, under 30 lines) are sent to the client on connect.

## Limits and environment variables

Batch size, node count, render size, the render and document folders and the log level are set with `AGENT_ILLUSTRATOR_*` variables. Exceeding a limit returns an error that names it. The table is in [packages/mcp-server/README.md](packages/mcp-server/README.md#limits).

## Determinism

Generators draw from the document's seed (returned by `create_document`, or pass your own), so the same seed and the same ops give the same drawing. Text is measured and rendered with the bundled Tajawal fonts, never system fonts. The render regression fixtures in `eval/` (committed baselines, compared in CI) catch drift.

## Known limitations

Only Tajawal (Latin and Arabic) is bundled, text has no automatic wrapping or outlines, gradients and filters on flat shapes render nothing, and a few edge cases are open. The list: [docs/superpowers/plans/post-v1-backlog.md](docs/superpowers/plans/post-v1-backlog.md).

## Development

A pnpm workspace: `packages/engine` (geometry, scene, ops, render, analysis), `packages/mcp-server` (the published `agent-illustrator` package), `packages/agent-kit` (guides, presets, prompt) and `eval` (dev-only).

```sh
pnpm install
pnpm check    # lint + typecheck + all tests
pnpm build    # bundle packages/mcp-server/dist
pnpm smoke    # round trip against the built bundle
```

Evaluation: render regression runs in `pnpm test`; the agent-quality harness needs a model and an API key, so run it by hand: `node eval/src/run.ts --model <id>`. See [eval/README.md](eval/README.md).
