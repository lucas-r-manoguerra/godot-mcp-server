# godot-mcp-server

Game-agnostic TypeScript MCP server bridging MCP clients (Claude Code,
Claude Desktop, Cursor, cloud) and the running Godot editor.

It maps MCP tools 1:1 onto the `godot_mcp` addon `{id,command,params}` /
`{status,result,error}` envelope, closes the authoring gaps (node lifecycle,
signal connect/disconnect, 3D viewport, import/UID helpers, ClassDB
introspection), and exposes a plugin API so per-project tools stay
project-side.

> Status: v0.1.0 bootstrap. Transports (`stdio`, Streamable HTTP), the Godot
> WebSocket client, builtin tools, and the plugin API land in the following
> slices. See `CHANGELOG.md`.
