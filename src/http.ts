#!/usr/bin/env node

// Ironflow MCP Server (Streamable HTTP): the hosted endpoint behind
// https://mcp.ironflow.sh/mcp. Stateless: every POST builds a fresh server
// and transport, so any replica can answer any request.
//
// Connect without installing anything:
//   claude mcp add --transport http ironflow https://mcp.ironflow.sh/mcp
//
// A key is optional. Send it as "Authorization: Bearer if_..." or, for
// clients that cannot set headers, as ?key=if_... on the URL.
//
// Environment:
//   PORT               listen port (default 8080)
//   IRONFLOW_API_URL   REST API base (default https://api.ironflow.sh)
//   FORWARD_CLIENT_IP  "true" only behind a proxy that sets X-Forwarded-For
//                      to the real client IP; the IP is passed to the API so
//                      keyless limits apply per caller

import { createServer as createHttpServer, IncomingMessage, ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { IronflowAPI } from "./api.js";
import { clientIP, HttpError, readKey } from "./request.js";
import { createServer, packageVersion } from "./server.js";

const DEFAULT_PORT = 8080;
const MAX_BODY_BYTES = 1024 * 1024;
const MCP_PATH = "/mcp";
const INFO_URL = "https://ironflow.sh/api#mcp";

const port = Number(process.env.PORT) || DEFAULT_PORT;
const apiUrl = process.env.IRONFLOW_API_URL || "https://api.ironflow.sh";
const forwardClientIP = process.env.FORWARD_CLIENT_IP === "true";
const version = packageVersion();

// setCors allows browser-based MCP clients (inspectors, web agents). No
// cookies are involved, so a wildcard origin is safe.
function setCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID"
  );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

function sendJSON(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// sendRPCError answers with a JSON-RPC error object, the shape MCP clients
// know how to display.
function sendRPCError(res: ServerResponse, status: number, message: string): void {
  sendJSON(res, status, { jsonrpc: "2.0", error: { code: -32000, message }, id: null });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request body too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    throw new HttpError(400, "Request body is not valid JSON");
  }
}

// describeRPC names what a request did for the access log, without keys,
// IPs or arguments.
function describeRPC(body: unknown): string {
  const msgs = Array.isArray(body) ? body : [body];
  return msgs
    .map((m) => {
      const msg = m as { method?: string; params?: { name?: string } };
      return msg.method === "tools/call" ? `tools/call:${msg.params?.name}` : msg.method ?? "?";
    })
    .join(",");
}

async function handleMCP(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const started = Date.now();
  const key = readKey(req, url);
  const body = await readBody(req);
  const api = new IronflowAPI(apiUrl, key, undefined, `${version}-hosted`, clientIP(req, forwardClientIP));
  const server = createServer(api, version);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
    console.log(
      JSON.stringify({ msg: "mcp", rpc: describeRPC(body), keyed: Boolean(key), status: res.statusCode, ms: Date.now() - started })
    );
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  setCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  if (url.pathname === "/healthz") {
    sendJSON(res, 200, { status: "ok", version });
    return;
  }
  if (url.pathname === "/" && (req.method === "GET" || req.method === "HEAD")) {
    res.writeHead(302, { Location: INFO_URL }).end();
    return;
  }
  if (url.pathname !== MCP_PATH) {
    sendJSON(res, 404, { error: "Not found. The MCP endpoint is /mcp" });
    return;
  }
  if (req.method !== "POST") {
    // Stateless server: no standalone SSE stream and no sessions to delete.
    res.setHeader("Allow", "POST, OPTIONS");
    sendRPCError(res, 405, "Method not allowed: this server is stateless, use POST");
    return;
  }
  await handleMCP(req, res, url);
}

const httpServer = createHttpServer((req, res) => {
  route(req, res).catch((err: unknown) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (err instanceof HttpError) {
      sendRPCError(res, err.status, err.message);
      return;
    }
    console.error(JSON.stringify({ msg: "mcp handler failed", error: String(err) }));
    sendRPCError(res, 500, "Internal server error");
  });
});

httpServer.listen(port, () => {
  console.log(JSON.stringify({ msg: "ironflow mcp http listening", port, version, apiUrl, forwardClientIP }));
});

// Graceful shutdown: stop accepting, let in-flight requests finish.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
