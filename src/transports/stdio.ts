// stdio entrypoint: default transport. Builds via the shared factory
// when no server is provided, then attaches StdioServerTransport.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer, type BuiltServer } from "../server/buildServer.js";

export interface ServeStdioOptions {
  built?: BuiltServer;
}

export async function serveStdio(opts: ServeStdioOptions = {}): Promise<BuiltServer> {
  const built = opts.built ?? buildServer();
  await built.server.connect(new StdioServerTransport());
  return built;
}
