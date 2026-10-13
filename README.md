# agent-illustrator

Vector illustration for AI agents, served over MCP (stdio). The agent says what to draw with high-level ops (`ellipse`, `wave`, `place`, `boolean`, `trace`…); the engine owns geometry, layout and rendering, and exports clean SVG.

- **Feedback after every batch.** Exact bounds for every node, PNG previews the agent can look at, and text-only checks (`describe_scene`, `measure`, `lint`) for models that cannot see.
- **Intent, not coordinates.** Relative placement and alignment, curves fitted from rough points, generators (blobs, waves, scatter), booleans, gradients, design tokens.
- **Reference images.** `trace` turns a PNG or JPEG into editable vector layers, one path per color, like Illustrator's Image Trace.
- **Model-agnostic.** A packaged prompt and guides teach any tool-calling model the workflow: plan, block in, detail, critique, export.
- **Deterministic.** The same seed and ops give the same drawing; text uses bundled fonts, never system fonts.

## Installation

Requires **Node.js 22.18 or newer** and **pnpm** (`npm install -g pnpm`). No native build step: the renderer ships prebuilt binaries for Windows, macOS and Linux.

The package is not on npm yet, so build it from source:

```sh
git clone https://github.com/egyjs/agent-illustrator.git
cd agent-illustrator
pnpm install
pnpm build
node packages/mcp-server/dist/cli.mjs --doctor   # checks the bundled fonts and content
```

The server is `packages/mcp-server/dist/cli.mjs`. Below, replace `/path/to/agent-illustrator` with the absolute path of your clone. On Windows use forward slashes, for example `C:/src/agent-illustrator`.

### Claude Code

```sh
claude mcp add --scope user agent-illustrator -- node /path/to/agent-illustrator/packages/mcp-server/dist/cli.mjs
```

Drop `--scope user` to add it to the current project only. Check it with `claude mcp list`.

### Claude Desktop, Cursor, VS Code and other clients

Any client that reads an `mcpServers` block (for Claude Desktop, `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "agent-illustrator": {
      "command": "node",
      "args": ["/path/to/agent-illustrator/packages/mcp-server/dist/cli.mjs"]
    }
  }
}
```

Any other MCP client: run `node packages/mcp-server/dist/cli.mjs` as a stdio server.

## Usage

### Ask for a drawing

Once the server is connected, ask in plain language:

> Draw a flat sunset landscape, 800×600: a gradient sky, a sun, a cloud and two rolling hills. Export it as SVG.

The agent reads the server's instructions on connect and follows the workflow. To start it explicitly, use the **`illustrate`** prompt (in Claude Code: `/mcp__agent-illustrator__illustrate`). It takes:

- `brief`: what to draw;
- `style` (optional): a preset, one of `flat`, `isometric-lite` or `line-art`;
- `vision: "no"` (optional): for models that cannot see images; it swaps PNG previews for text checks.

### What the agent does

1. **`create_document`** makes a canvas and returns a `doc_id` and a seed.
2. **`apply_ops`** runs a batch of ops all-or-nothing. It returns each op's id and exact bounds, plus `lint` issues for what changed. For example:

   ```json
   [
     {"op": "palette", "base": "#3d5a80", "harmony": "monochrome", "steps": 5},
     {"op": "rect", "id": "sky", "x": 0, "y": 0, "width": "100%", "height": "100%"},
     {"op": "gradient", "id": "sky_fade", "stops": ["#ffe8d6", "#f4a261"], "angle": 90, "ids": ["sky"]},
     {"op": "ellipse", "id": "sun", "cx": "70%", "cy": "55%", "rx": 70, "style": {"fill": "#fff3b0"}},
     {"op": "blob", "id": "cloud", "cx": 190, "cy": 130, "radius": 55, "points": 10, "randomness": 0.25, "seed": 4, "style": {"fill": "#ffffff", "opacity": 0.8}},
     {"op": "wave", "id": "hill_far", "x": 0, "y": 380, "width": "100%", "amplitude": 30, "wavelength": 520, "bottom": "100%", "style": {"fill": "palette.primary.2"}},
     {"op": "wave", "id": "hill_near", "x": 0, "y": 470, "width": "100%", "amplitude": 24, "wavelength": 360, "phase": 120, "bottom": "100%", "style": {"fill": "palette.primary.4"}}
   ]
   ```

3. **`render`**, or `describe_scene`, `measure` and `lint`, shows the agent what it drew so it can fix problems.
4. **`history`** sets checkpoints to undo to, and **`document_io`** saves the document to disk.
5. **`export_svg`** returns the final, optimized SVG.

### Trace a reference image

Give the agent the path of a PNG or JPEG:

> Trace C:/refs/logo.png to 4 colors and clean it up.

The agent first previews the trace (`preview: true` returns a PNG without changing the document), then commits it:

```json
{"op": "trace", "id": "logo", "image": "C:/refs/logo.png", "colors": 4}
```

The result is a group with one editable path per color. Edges are placed to a fraction of a pixel, straight edges become lines and circles become circles, and soft shadows keep their opacity. Trace only images you have the rights to. Details: the [`trace` guide](packages/agent-kit/content/guides/trace.md).

## Tools

| Tool | What it does |
|---|---|
| `create_document` | New canvas; returns `doc_id` and the seed |
| `apply_ops` | All-or-nothing batch of drawing ops; returns each op's id and exact bounds, plus `lint` issues for the nodes it touched; `preview: true` returns a PNG of the result without committing |
| `render` | PNG of the canvas, with optional id, bounds and grid overlays and a zoom region |
| `describe_scene` | The scene as text: canvas, tokens, and the node tree with bounds and styles |
| `measure` | Exact bounds, area and length of nodes, and the gaps and overlaps between them |
| `lint` | Off-canvas, tiny, misaligned, colliding and low-contrast problems, with ready `fix` ops |
| `history` | Named checkpoints, restore and undo |
| `document_io` | Save, load and list documents on disk |
| `export_svg` | The final SVG, optimized with SVGO |
| `guide` | The drawing guides, style presets and op reference |

The 37 ops, by domain:

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

The full reference for inputs and return values is in [packages/mcp-server/README.md](packages/mcp-server/README.md#tool-reference). The `guide` tool lists the topics: `workflow`, `color`, `shapes`, `layout`, `generators`, `structure`, `text`, `critique`, `trace`, `examples`, `text-only`, `ops`, `op:<name>`, `presets` and `preset:<name>`.

## Configuration

Batch size, node count, render size, the render and document folders and the log level are set with `AGENT_ILLUSTRATOR_*` environment variables. Exceeding a limit returns an error that names it. The table is in [packages/mcp-server/README.md](packages/mcp-server/README.md#limits).

## Known limitations

- Only the Tajawal font (Latin and Arabic) is bundled.
- Text does not wrap automatically and cannot be converted to outlines.
- Gradients and filters on flat shapes render nothing.
- A few edge cases are open; see [docs/superpowers/plans/post-v1-backlog.md](docs/superpowers/plans/post-v1-backlog.md).

## Development

A pnpm workspace:

- `packages/engine`: geometry, scene, ops, render, analysis;
- `packages/mcp-server`: the `agent-illustrator` server;
- `packages/agent-kit`: guides, presets, prompt;
- `eval`: dev-only.

```sh
pnpm check    # lint + typecheck + all tests
pnpm build    # bundle packages/mcp-server/dist
pnpm smoke    # round trip against the built bundle
```

Render regression fixtures in `eval/` (committed baselines, compared in CI) catch drift. The agent-quality harness drives Claude Code on your subscription, so run it by hand: `node eval/src/run.ts --model sonnet`. See [eval/README.md](eval/README.md).

## License

[MIT](LICENSE). Bundled Tajawal fonts: SIL Open Font License ([OFL.txt](packages/engine/assets/fonts/OFL.txt)).
