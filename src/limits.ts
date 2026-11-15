// What a keyless caller reads when a limit stops a call that a free key
// would let through, worded for the app it uses. Until 0.19.4 a keyless
// daily limit came back as the API's own text, which offers the key page
// and a POST of the user's email. In test sessions (2026-11-15) the model
// passed the key page on but could not say how to add the key in the app
// in use, and offered to send the user's email instead. The server knows
// the app from initialize, so it names the step for that app.

import { ApiError } from "./api.js";

// KEY_PAGE is the free key page, tagged so key requests from MCP are counted.
export const KEY_PAGE = "https://ironflow.sh/key?utm_source=mcp";

const HOSTED_URL = "https://mcp.ironflow.sh/mcp";

// Transport is how the client reaches this server: the hosted HTTP server
// takes a key as a header or ?key=, the stdio server from its env.
export type Transport = "http" | "stdio";

// connectStep says how to connect Ironflow with a key in the app that sent
// initialize (a name such as claude-code/2.1.0, cursor-vscode/1.0.0 or
// claude-ai/0.1.0), with a step any app can follow otherwise.
export function connectStep(client: string | undefined, transport: Transport): string {
  if (transport === "stdio") return "set IRONFLOW_API_KEY=if_... in the Ironflow server's env and restart the app";
  const app = (client ?? "").toLowerCase();
  if (app.includes("claude-code")) {
    return `run claude mcp remove ironflow, then claude mcp add --transport http ironflow ${HOSTED_URL} --header "Authorization: Bearer if_..."`;
  }
  if (app.includes("claude-ai")) return `in Customize > Connectors remove Ironflow and add it again with the URL ${HOSTED_URL}?key=if_...`;
  if (app.includes("cursor")) return `add "headers": {"Authorization": "Bearer if_..."} next to the Ironflow url in .cursor/mcp.json`;
  if (app.includes("visual studio code") || app.includes("vscode")) {
    return `add "headers": {"Authorization": "Bearer if_..."} to the Ironflow server in mcp.json`;
  }
  return `send the header Authorization: Bearer if_... with the Ironflow connection, or use ${HOSTED_URL}?key=if_... as its URL`;
}

// keyHelp is the free key and how to use it, as one clause for the user.
export function keyHelp(client: string | undefined, transport: Transport): string {
  return `get a free key at ${KEY_PAGE} (it takes a minute and gives 1,000 credits a day and 14 days of history), then ${connectStep(client, transport)}`;
}

// The codes a free key lifts for a keyless caller (the API's tierLimitCodes
// and the 401 a keyless write gets).
const KEY_LIFTS = new Set([
  "HISTORY_OUT_OF_RANGE",
  "QUERY_WINDOW_EXCEEDED",
  "QUERY_BUDGET_EXCEEDED",
  "STREAM_LIMIT",
  "TIER_FORBIDDEN",
  "TIER_LIMIT",
  "UNAUTHORIZED",
]);

// ended closes the API's text as a sentence, unless it ends with a link.
const ended = (text: string): string => (/[.!?]$/.test(text) || /https?:\/\/\S+$/.test(text) ? text : `${text}.`);

// waitFor words Retry-After seconds as "about 6 hours".
export function waitFor(seconds: number): string {
  if (seconds < 90) return "about a minute";
  if (seconds < 3600) return `about ${Math.round(seconds / 60)} minutes`;
  const hours = Math.round(seconds / 3600);
  return hours === 1 ? "about an hour" : `about ${hours} hours`;
}

export interface LimitContext {
  keyed: boolean;
  client?: string;
  transport: Transport;
}

// limitText is the error text for a keyless call that a free key would let
// through, or undefined to keep the API's own text (key holders, other
// errors, and the data toolset, which carries no key lines).
export function limitText(error: unknown, ctx: LimitContext): string | undefined {
  if (ctx.keyed || !(error instanceof ApiError) || !error.code) return undefined;
  const help = keyHelp(ctx.client, ctx.transport);
  if (error.code === "KEYLESS_DAILY_LIMIT") {
    const credits = /allows ([\d,]+) credits/.exec(error.message)?.[1] ?? "100";
    // Every tool shares the allowance, so the agent should stop rather than
    // try the next tool (a test session asking why HYPE moved tried three
    // more after the first refusal).
    const back = error.retryAfterS
      ? `Every Ironflow tool fails for ${waitFor(error.retryAfterS)}, so make no more Ironflow calls until then.`
      : "Every Ironflow tool fails for now, so make no more Ironflow calls.";
    // claude.ai and other cloud apps call from shared IP addresses, so their
    // users share one keyless allowance (it counts per IP).
    const shared =
      ctx.transport === "http" && (ctx.client ?? "").toLowerCase().includes("claude-ai")
        ? " claude.ai connects from shared IP addresses, so its users share that allowance."
        : "";
    return `Ironflow API error ${error.status} KEYLESS_DAILY_LIMIT: the keyless allowance for this IP address is used up (${credits} credits in a rolling 24 hours).${shared} ${back} Tell the user: ${help}.`;
  }
  // A per-minute limit passes by itself: the agent waits, and the key is
  // only an option.
  const said = ended(error.message);
  if (error.code === "RATE_LIMIT_EXCEEDED") return `${said} Wait a minute, then call again. For 60 requests a minute, ${help}.`;
  if (KEY_LIFTS.has(error.code)) return `${said} A free key lifts this. Tell the user: ${help}.`;
  return undefined;
}
