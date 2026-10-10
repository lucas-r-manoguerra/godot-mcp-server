// server_status tool (design Q2): local-only, no params. Returns the
// capability record plus negotiated mode and the drift flag; it is the
// assertion surface for the negotiated mode alongside the log line.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "../version.js";

export const SERVER_STATUS_TOOL = "server_status";
export const SERVER_STATUS_DESCRIPTION =
  "Reports the negotiated bridge mode and the Godot capability record.";

export interface ServerStatusRecord {
  mode: string;
  addon_version: string;
  godot_version: string;
  project_path: string;
  project_name: string;
  server_version: string;
  protocol_drift_suspected: boolean;
}

// Pre-handshake record: versions unknown until Task 4 negotiates them.
export function defaultStatusRecord(): ServerStatusRecord {
  return {
    mode: "auth",
    addon_version: "unknown",
    godot_version: "unknown",
    project_path: "",
    project_name: "",
    server_version: `${SERVER_NAME}/${SERVER_VERSION}`,
    protocol_drift_suspected: false,
  };
}

// Pinned-SDK registration symbol, verified against 1.32.1: registerTool.
export function registerServerStatusTool(
  server: McpServer,
  getRecord: () => ServerStatusRecord,
): void {
  server.registerTool(
    SERVER_STATUS_TOOL,
    { description: SERVER_STATUS_DESCRIPTION, inputSchema: {} },
    async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(getRecord()) }],
    }),
  );
}
