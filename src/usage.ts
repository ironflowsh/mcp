// Usage-tracking helpers: what the hosted server logs about each request and
// what every API call tells the Ironflow API about its caller. Nothing here
// stores an IP or a key.

import { createHmac } from "node:crypto";

const MAX_CLIENT_APP_LEN = 64;
const MAX_ARGS_LEN = 600;
const CALLER_HASH_LEN = 16;
const MAX_ERROR_LEN = 160;
const CLIENT_MEMORY_MS = 60 * 60 * 1000;
const MAX_REMEMBERED_CLIENTS = 10_000;
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

// isQACheck reports whether a User-Agent marks one of our own live checks
// (qa_check anywhere in it, as the API's own rule).
export function isQACheck(userAgent: string | string[] | undefined): boolean {
  return /qa_check/i.test(Array.isArray(userAgent) ? userAgent.join(" ") : userAgent ?? "");
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

// SessionRPC is an MCP method that never reaches the API on its own, so the
// hosted server reports it (IronflowAPI.noteRPC): a client opening a session
// or reading the tool list.
export type SessionRPC = "initialize" | "tools/list";

const SESSION_RPCS: readonly SessionRPC[] = ["initialize", "tools/list"];

// sessionRPCs returns the initialize and tools/list calls in a request body
// (one message or a batch), each once.
export function sessionRPCs(body: unknown): SessionRPC[] {
  const found = new Set<SessionRPC>();
  for (const m of messages(body)) {
    const rpc = SESSION_RPCS.find((r) => r === m?.method);
    if (rpc) found.add(rpc);
  }
  return [...found];
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

// toolLogFields adds how a request's tool calls ended to its access-log
// line: isError when any tool result went back as an error (the HTTP status
// stays 200 for those), error with the first error's text (so a failure
// that never reached the API still says why), upstream with the API status
// of each request the tools made, and upstream_error with the API's error
// codes. Empty for requests without tool calls.
export function toolLogFields(
  outcomes: { isError: boolean; error?: string }[],
  upstream: { status: number; code?: string }[]
): { isError?: boolean; error?: string; upstream?: number[]; upstream_error?: string } {
  if (outcomes.length === 0 && upstream.length === 0) return {};
  const codes = [...new Set(upstream.map((u) => u.code).filter(Boolean))];
  const firstError = outcomes.find((o) => o.isError && o.error)?.error;
  return {
    isError: outcomes.length > 0 ? outcomes.some((o) => o.isError) : undefined,
    error: firstError ? firstError.replace(/\s+/g, " ").slice(0, MAX_ERROR_LEN) : undefined,
    upstream: upstream.length > 0 ? upstream.map((u) => u.status) : undefined,
    upstream_error: codes.length > 0 ? codes.join(",") : undefined,
  };
}

// The hosted server is stateless, so a tools/call arrives without the
// clientInfo its client sent at initialize. ClientMemory keeps the app name
// per caller hash for an hour, so later requests from the same caller can be
// attributed to it in the log and in X-Ironflow-Client. Several apps behind
// one IP share a hash; the log marks such names as recalled.
export class ClientMemory {
  private readonly names = new Map<string, { client: string; at: number }>();

  remember(caller: string, client: string, now = Date.now()): void {
    if (!caller || !client) return;
    this.names.delete(caller);
    this.names.set(caller, { client, at: now });
    if (this.names.size > MAX_REMEMBERED_CLIENTS) {
      const oldest = this.names.keys().next().value;
      if (oldest !== undefined) this.names.delete(oldest);
    }
  }

  recall(caller: string, now = Date.now()): string {
    const hit = caller ? this.names.get(caller) : undefined;
    if (!hit) return "";
    if (now - hit.at > CLIENT_MEMORY_MS) {
      this.names.delete(caller);
      return "";
    }
    return hit.client;
  }
}
