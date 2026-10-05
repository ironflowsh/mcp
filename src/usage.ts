// Usage-tracking helpers: what the hosted server logs about each request and
// what every API call tells the Ironflow API about its caller. Nothing here
// stores an IP or a key.

import { createHmac } from "node:crypto";

const MAX_CLIENT_APP_LEN = 64;
const MAX_ARGS_LEN = 600;
const CALLER_HASH_LEN = 16;
const CLIENT_APP_PATTERN = /^[A-Za-z0-9 ._/@()+:-]*$/;

type RPCMessage = { method?: string; params?: { name?: string; arguments?: unknown; clientInfo?: { name?: string; version?: string } } };

const messages = (body: unknown): RPCMessage[] => (Array.isArray(body) ? body : [body]) as RPCMessage[];

// sanitizeClientApp returns a plain, printable app name of at most 64
// characters, or "" when the value carries anything else. The API applies
// the same rule to the X-Ironflow-Client header.
export function sanitizeClientApp(value: string | undefined): string {
  const v = (value ?? "").trim();
  if (!CLIENT_APP_PATTERN.test(v)) return "";
  return v.slice(0, MAX_CLIENT_APP_LEN);
}

// clientFromInitialize returns "name/version" from an initialize request's
// clientInfo, or "" when the body holds no initialize.
export function clientFromInitialize(body: unknown): string {
  for (const m of messages(body)) {
    if (m.method !== "initialize") continue;
    const info = m.params?.clientInfo;
    if (!info?.name) return "";
    return sanitizeClientApp(info.version ? `${info.name}/${info.version}` : info.name);
  }
  return "";
}

// callerHash is a keyed hash of the caller's IP, so the log can count
// distinct callers without storing addresses. The API uses the same salt and
// algorithm, so a caller hashes the same in both logs.
export function callerHash(ip: string | undefined, salt: string): string {
  if (!ip) return "";
  return createHmac("sha256", salt).update(ip).digest("hex").slice(0, CALLER_HASH_LEN);
}

// summarizeArgs returns a tools/call request's arguments as compact JSON,
// truncated, so the log shows what people ask for (markets, windows, SQL).
export function summarizeArgs(body: unknown): string {
  for (const m of messages(body)) {
    if (m.method !== "tools/call" || m.params?.arguments === undefined) continue;
    const json = JSON.stringify(m.params.arguments);
    return json === "{}" ? "" : json.slice(0, MAX_ARGS_LEN);
  }
  return "";
}
