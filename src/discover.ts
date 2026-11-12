// server/discover is the probe newer MCP clients (protocol 2026-07-28, sent
// by Claude Code and the claude.ai connector) send before initialize. This
// server speaks 2025-11-25, and the SDK's stateless transport refused the
// probe with a 400 for its unsupported MCP-Protocol-Version header (262 of
// 289 probes on 2026-11-11 and 11-12). A client remembers a server as one to
// initialize directly only when the probe is answered method not found, so
// that is the answer, as a JSON-RPC error with HTTP 200.

const DISCOVER_METHOD = "server/discover";
const METHOD_NOT_FOUND = -32601;
export const DISCOVER_MESSAGE = "Method not found: server/discover. This server speaks MCP 2025-11-25: send initialize";

type RPCId = string | number | null;

interface RPCRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
}

export interface RPCErrorReply {
  jsonrpc: "2.0";
  id: RPCId;
  error: { code: number; message: string };
}

function isDiscover(m: unknown): m is RPCRequest {
  return typeof m === "object" && m !== null && !Array.isArray(m) && (m as RPCRequest).method === DISCOVER_METHOD;
}

// replyId echoes a request's id; JSON-RPC ids are strings, numbers or null.
function replyId(m: RPCRequest): RPCId {
  const id = m.id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function notFound(m: RPCRequest): RPCErrorReply {
  return { jsonrpc: "2.0", id: replyId(m), error: { code: METHOD_NOT_FOUND, message: DISCOVER_MESSAGE } };
}

// discoverReply returns the answer to a body that is a server/discover
// request, or a batch of nothing but server/discover requests, and undefined
// for anything else, which goes to the MCP transport as before.
export function discoverReply(body: unknown): RPCErrorReply | RPCErrorReply[] | undefined {
  if (Array.isArray(body)) {
    if (body.length === 0 || !body.every(isDiscover)) return undefined;
    return body.map(notFound);
  }
  if (!isDiscover(body)) return undefined;
  return notFound(body);
}
