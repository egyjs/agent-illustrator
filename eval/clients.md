# MCP client compatibility (manual smoke checklist, spec A2)

Re-run on every milestone that changes the tool surface (M3, M9, M10). Probe prompts:
1. "Call render_probe with color #2a9d8f, then tell me what shape and color you see in the image."
2. "Call ops_loose_probe with ops [{"op":"op_3","id":"x","at":{"x":1,"y":2}}], then call ops_union_probe with the same ops."

## Registering the M0 probe server
- Claude Desktop: add to `%APPDATA%\Claude\claude_desktop_config.json`, then restart:
  ```json
  { "mcpServers": { "agent-illustrator-spike": { "command": "node",
    "args": ["C:\\Users\\el3za\\Desktop\\work\\agent-illustrator\\spikes\\src\\mcp-probe-server.ts"] } } }
  ```
- Claude Code: `claude mcp add agent-illustrator-spike -- node C:/Users/el3za/Desktop/work/agent-illustrator/spikes/src/mcp-probe-server.ts`
- Headless check (already passing): `npx @modelcontextprotocol/inspector@2.9.0 --cli node spikes/src/mcp-probe-server.ts --method tools/list`

## M0 probe server (pending: owner runs the prompts above)
| Client (version) | Tools listed | Image visible in UI | Model saw image | ops_loose_probe | ops_union_probe | Notes |
|---|---|---|---|---|---|---|
| MCP Inspector CLI 2.9.0 | yes (3) | n/a | n/a | n/a | n/a | 1 portability warning on loose schema (F4) |
| Claude Desktop | | | | | | |
| Claude Code | | | | | | |
