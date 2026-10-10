# godot-mcp-server

Game-agnostic TypeScript MCP server bridging MCP clients (Claude Code,
Claude Desktop, Cursor, cloud) and the running Godot editor.

It maps MCP tools 1:1 onto the `godot_mcp` addon `{id,command,params}` /
`{status,result,error}` envelope, closes the authoring gaps (node lifecycle,
signal connect/disconnect, 3D viewport, import/UID helpers, ClassDB
introspection), and exposes a plugin API so per-project tools stay
project-side.

> Status: v0.1.0. Protocol baseline pinned against addon `4.1.11` and
> Godot `4.7.2`. See `CHANGELOG.md`.

## Requirements

- Node.js >= 18.
- A running Godot editor (>= 4.5) with the `godot_mcp` addon enabled.
- The `verify` tool additionally needs a Godot binary on `PATH`
  (discovery order: `godot-mcp.godotBinary` config, `GODOT_BINARY` env,
  `PATH` lookup for `godot`).

## Install

No install needed; run it straight from the registry:

```bash
npx -y godot-mcp-server@0.1.0 --help
```

Or pin it as a project dependency:

```bash
npm install godot-mcp-server@0.1.0
```

## Transports: stdio vs `--http`

`stdio` is the default and fits local clients (Claude Code, Claude Desktop).
`--http` serves Streamable HTTP on loopback for remote clients (Cursor,
cloud). Both entrypoints build the server through the same `buildServer`
factory, so the tool surface is identical.

```bash
# stdio (default)
npx -y godot-mcp-server@0.1.0

# Streamable HTTP on 127.0.0.1:3000
npx -y godot-mcp-server@0.1.0 --http

# HTTP on a custom port (flag > GODOT_MCP_HTTP_PORT env > default 3000)
npx -y godot-mcp-server@0.1.0 --http --port 4000
```

## Auth: `--no-auth` and `GODOT_MCP_TOKEN`

Auth-first is the default. The server resolves the token out of band in
this order: `GODOT_MCP_TOKEN` env (canonical), then
`<project>/.godot/mcp-token.json`, then the editor-log scrape fallback.

```bash
export GODOT_MCP_TOKEN="<token-from-the-editor>"
npx -y godot-mcp-server@0.1.0
```

`--no-auth` exists ONLY for vanilla addons that do not speak auth: it
probes the peer and negotiates a visible no-auth mode instead of failing
silently. Do not use it against auth-capable addons.

```bash
npx -y godot-mcp-server@0.1.0 --no-auth
```

## Plugins: the `godot-mcp.plugins` key

Per-project tools stay project-side. List startup plugin module paths under
the `godot-mcp.plugins` client-config key (or `GODOT_MCP_PLUGINS` env,
comma-separated); a watched plugin dir additionally hot-loads at runtime.
A duplicate tool name fails fast with `DUPLICATE_TOOL`, and builtins can
never be unregistered.

```json
{
  "godot-mcp.plugins": ["./tools/godot-mcp/plugins/infinity_mu_tools.js"]
}
```

## The `verify` tool prerequisites

`verify` runs headless Godot checks (`import`, `check-only`, optional
`playtest-smoke` with `--quit-after 60`) for the repo TDD loop. It needs:

1. A Godot binary discoverable as described under Requirements.
2. Godot >= 4.5 (`--version` gate; versions above the 4.7.2 baseline log a
   protocol-drift warning but still run).
3. A project path (its `project_path` arg, defaulting to the connected
   project).

## Register with your client (pinned)

Claude Code:

```bash
claude mcp add godot-mcp-server -- npx -y godot-mcp-server@0.1.0
```

JSON equivalent (Claude Desktop / Cursor `mcp.json`):

```json
{
  "mcpServers": {
    "godot-mcp-server": {
      "command": "npx",
      "args": ["-y", "godot-mcp-server@0.1.0"],
      "env": {
        "GODOT_MCP_TOKEN": "<token-from-the-editor>"
      }
    }
  }
}
```

## Releases

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds,
packs (`npm pack` → `godot-mcp-server-<version>.tgz`), writes
`checksums.txt`, and attaches both to the GitHub release.

## Non-goals

No Docker images, no cloud hosting, no multi-editor fan-out. This package
bridges one MCP client to one running Godot editor.
