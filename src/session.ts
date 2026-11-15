// A keyless allowance per claude.ai conversation (0.20.0).
//
// claude.ai connectors call from Anthropic's pool of IP addresses, a new
// one on almost every request, so the API's per-IP keyless credits say
// nothing about who is asking. The hosted server is stateless, but MCP
// clients echo a Mcp-Session-Id header once the server hands one out at
// initialize. So a keyless claude.ai initialize gets a signed session id,
// and the requests that carry it back pass the session on to the API,
// which gives each conversation a small allowance of its own, with one
// daily total for all of claude.ai (internal/api/keyless_session.go in the
// API repo). The API trusts the session only with a MAC that needs the
// secret this server shares with it, so no public caller can claim one.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// CLAUDE_AI is the app name a claude.ai session's calls go by.
export const CLAUDE_AI = "claude-ai";

// isClaudeAI reports whether an app name is claude.ai's: its connector
// sends clientInfo "Anthropic/ClaudeAI" (logged Anthropic/ClaudeAI/1.0.0),
// and claude-ai is the short form.
export function isClaudeAI(client: string | undefined): boolean {
  const app = (client ?? "").toLowerCase();
  return app.includes("claude-ai") || app.includes("claudeai");
}

const ID_BYTES = 16;
const SIG_BYTES = 16;
const TOKEN_PATTERN = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{22})$/;

const mac = (secret: string, domain: string, value: string): Buffer =>
  createHmac("sha256", secret).update(`${domain}:${value}`).digest();

// issueSession returns a new session id for the Mcp-Session-Id header:
// "<random id>.<signature>", both base64url.
export function issueSession(secret: string): string {
  const id = randomBytes(ID_BYTES).toString("base64url");
  return `${id}.${mac(secret, "mcp-session-id", id).subarray(0, SIG_BYTES).toString("base64url")}`;
}

// readSession returns the random id of a session id this server issued, or
// undefined for a missing, malformed or forged one.
export function readSession(header: string | string[] | undefined, secret: string): string | undefined {
  const value = (Array.isArray(header) ? header[0] : header)?.trim();
  const m = value ? TOKEN_PATTERN.exec(value) : null;
  if (!m) return undefined;
  const want = mac(secret, "mcp-session-id", m[1]).subarray(0, SIG_BYTES);
  const got = Buffer.from(m[2], "base64url");
  // Only the exact encoding we issued: the last base64url character carries
  // unused bits, so other spellings would decode to the same bytes.
  if (got.toString("base64url") !== m[2]) return undefined;
  return got.length === want.length && timingSafeEqual(got, want) ? m[1] : undefined;
}

// McpSession is what the API gets about a claude.ai session: its id and the
// MAC that shows the hosted server sent it.
export interface McpSession {
  id: string;
  auth: string;
}

// sessionForAPI is the session as the API reads it (X-Ironflow-Mcp-Session
// and X-Ironflow-Mcp-Session-Auth): hex HMAC-SHA256 of
// "claude-ai-session:<id>" under the shared secret.
export function sessionForAPI(id: string, secret: string): McpSession {
  return { id, auth: mac(secret, "claude-ai-session", id).toString("hex") };
}
