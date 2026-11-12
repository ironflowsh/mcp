// Request helpers for the hosted HTTP server, kept apart from http.ts so
// they can be tested without starting a listener.

import type { IncomingMessage } from "node:http";

import type { Toolset } from "./tools.js";

const KEY_PATTERN = /^if_[A-Za-z0-9_-]{8,128}$/;
const IP_PATTERN = /^[0-9A-Fa-f.:]{2,45}$/;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

// readKey returns the caller's API key, undefined for keyless use, or throws
// when a key was sent but is malformed (a typo should not silently degrade
// to keyless limits).
export function readKey(req: IncomingMessage, url: URL): string | undefined {
  const header = req.headers.authorization?.trim();
  const raw = header ? header.replace(/^Bearer\s+/i, "") : url.searchParams.get("key")?.trim();
  if (!raw) return undefined;
  if (!KEY_PATTERN.test(raw)) {
    throw new HttpError(
      401,
      'Malformed API key: send "Authorization: Bearer if_...", or no key for keyless access. Free keys: https://ironflow.sh/key?utm_source=mcp'
    );
  }
  return raw;
}

// clientIP returns the caller's IP from the proxy's X-Forwarded-For when
// FORWARD_CLIENT_IP is on, otherwise undefined (the API sees this server).
export function clientIP(req: IncomingMessage, trustProxy: boolean): string | undefined {
  if (!trustProxy) return undefined;
  const xff = req.headers["x-forwarded-for"];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
  return first && IP_PATTERN.test(first) ? first : undefined;
}

// DATA_PATH serves the data toolset without a query string. Some
// directories and clients match or call a server by its address without
// the query, so /data is the address to list where only data tools belong.
export const DATA_PATH = "/data";

// readToolset reads the toolset from the MCP URL: the /data path, or
// ?toolset=data on /mcp, serves the read-only data tools (for directory
// listings that take data tools only); /mcp alone or ?toolset=all serves
// every tool. /data never serves more than the data tools. Anything else is
// an error, so a typo cannot list the tools the URL meant to hide.
export function readToolset(url: URL): Toolset {
  const raw = url.searchParams.get("toolset")?.trim().toLowerCase() ?? "";
  if (url.pathname === DATA_PATH) {
    if (raw === "" || raw === "data") return "data";
    throw new HttpError(400, "The /data address serves the data tools only; leave toolset out");
  }
  if (raw === "" || raw === "all") return "all";
  if (raw === "data") return "data";
  throw new HttpError(400, "Unknown toolset: use ?toolset=data for the data tools only, or leave it out for every tool");
}
