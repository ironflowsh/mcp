// Request helpers for the hosted HTTP server, kept apart from http.ts so
// they can be tested without starting a listener.

import type { IncomingMessage } from "node:http";

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
      'Malformed API key: send "Authorization: Bearer if_...", or no key for keyless access. Free keys: https://ironflow.sh/key'
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
