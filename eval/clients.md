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
