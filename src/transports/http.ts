// http entrypoint: Hono + WebStandardStreamableHTTPServerTransport,
// stateless-ready (no session id), bound to loopback only.

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildServer, type BuiltServer } from "../server/buildServer.js";

export const DEFAULT_HTTP_PORT = 3000;
export const HTTP_BIND_HOST = "127.0.0.1";
export const MCP_ENDPOINT = "/mcp";

export interface ServeHttpOptions {
  built?: BuiltServer;
  port?: number;
  hostname?: string;
  endpoint?: string;
}

export interface HttpServerHandle {
  built: BuiltServer;
  port: number;
  close: () => void;
}

export async function serveHttp(opts: ServeHttpOptions = {}): Promise<HttpServerHandle> {
  const built = opts.built ?? buildServer();
  const port = opts.port ?? DEFAULT_HTTP_PORT;
  const hostname = opts.hostname ?? HTTP_BIND_HOST;
  const endpoint = opts.endpoint ?? MCP_ENDPOINT;
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await built.server.connect(transport);
  const app = new Hono();
  const handle = (c: { req: { raw: Request } }) => transport.handleRequest(c.req.raw);
  app.post(endpoint, handle);
  app.get(endpoint, handle);
  app.delete(endpoint, handle);
  const httpServer = serve({ fetch: app.fetch, port, hostname });
  return { built, port, close: () => httpServer.close() };
}
