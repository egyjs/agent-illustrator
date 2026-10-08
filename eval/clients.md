# MCP client compatibility (manual smoke checklist, spec A2)

Re-run on every milestone that changes the tool surface (M3, M9, M10). Probe prompts:
1. "Call render_probe with color #2a9d8f, then tell me what shape and color you see in the image."
2. "Call ops_loose_probe with ops [{"op":"op_3","id":"x","at":{"x":1,"y":2}}], then call ops_union_probe with the same ops."

## Registering the M0 probe server
- Claude Desktop: add to `claude_desktop_config.json`, then fully quit and restart. Location: `%APPDATA%\Claude\` for the
  classic installer; `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\` for the MSIX/Store
  install (this machine). Settings → Developer → Edit Config opens the right file either way.
  ```json
  { "mcpServers": { "agent-illustrator-spike": { "command": "node",
    "args": ["C:\\Users\\el3za\\Desktop\\work\\agent-illustrator\\spikes\\src\\mcp-probe-server.ts"] } } }
  ```
- Claude Code: `claude mcp add agent-illustrator-spike -- node C:/Users/el3za/Desktop/work/agent-illustrator/spikes/src/mcp-probe-server.ts`
- Headless check (already passing): `npx @modelcontextprotocol/inspector@2.9.0 --cli node spikes/src/mcp-probe-server.ts --method tools/list`

## M0 probe server
| Client (version) | Tools listed | Image visible in UI | Model saw image | ops_loose_probe | ops_union_probe | Notes |
|---|---|---|---|---|---|---|
| MCP Inspector CLI 2.9.0 | yes (3) | n/a | n/a | n/a | n/a | 1 portability warning on loose schema (F4) |
| Claude Desktop 1.4758.0, MSIX (2026-10-08) | yes (3) | yes | yes: teal filled circle on white, matches #2a9d8f | `ok: 1 ops` | `ok: 1 ops` | Model read `additionalProperties: {}` and saw no field rules on the loose schema; suggested per-op shapes on demand |
| Claude Code 2.1.294 (2026-10-08) | yes (3) | not checked | yes: teal filled circle, matches #2a9d8f | `ok: 1 ops` | `ok: 1 ops` | Model noted the union schema takes about 50× more context, and that the loose schema shows no field rules (`id`, `at`) before the call |

Observation (both Claude clients): with the loose schema (S1), the model sees no per-op fields before the call. It
learns them only from the `apply_ops` description, the `guide` op catalog (PROJECT_INIT §2.6) and server error hints.
M3 must point the `apply_ops` description at `guide`, and M9 must make the op catalog list every op's fields. No new tool needed.

## M3 server (re-run when the owner switches clients from the probe to the real server)

Register (from the repo, no build needed):
- Claude Code: `claude mcp add agent-illustrator -- node C:/Users/el3za/Desktop/work/agent-illustrator/packages/mcp-server/src/cli.ts`
- Claude Desktop: `"agent-illustrator": { "command": "node", "args": ["C:\\Users\\el3za\\Desktop\\work\\agent-illustrator\\packages\\mcp-server\\src\\cli.ts"] }`

Prompt: "Create an 800×600 document, draw a simple landscape (sky, ground, sun, a house), render it with ids
overlay, fix anything that looks off, then export the SVG."

| Client (version) | Tools listed | Image visible | Model saw image | Batch errors understood | Export valid | Notes |
|---|---|---|---|---|---|---|
| Owner run, client not recorded (2026-10-08) | yes (4) | not recorded | yes: critiqued the ids render and a 2× zoom of the house | n/a (no failing batch) | yes: SVGO output, ids and `house` group kept (`C:\Users\el3za\tmp\landscape.svg`) | Landscape with sky, ground, sun, house (body, roof, chimney, eave, windows with crossbars, door, knob). Only regular polygons existed, so the model faked a gable roof with a diamond half-hidden behind the body; M4 `path_from_points`/`path_commands` remove that workaround. |

Automated stand-in until then: `packages/mcp-server/test/server.e2e.test.ts` and `pnpm smoke` (SDK client over stdio).
MCP Inspector 2.9.0 `--cli … --method tools/list` against `dist/cli.mjs`: 4 tools, exit 0 (2026-10-08).
