// Builds the Ironflow MCP server. Shared by the stdio entry (index.ts) and
// the hosted Streamable HTTP entry (http.ts) so both expose the same tools.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { IronflowAPI } from "./api.js";
import { fitToBudget } from "./budget.js";
import { fitEnums } from "./enums.js";
import { attachNotice, enumNotice } from "./notice.js";
import { DATA_NOTICE, plainError, plainResult, plainSchema, plainText } from "./plain.js";
import { outputSchemas, type Schema } from "./schemas.js";
import { keyRequiredText, type Toolset, toolsFor } from "./tools.js";

// One-line summary for MCP directories and client server lists.
const DESCRIPTION =
  "Hyperliquid market data and wallet analytics from our own nodes, plus liquidation alerts to Discord, Slack, Telegram or a webhook: trades, funding, liquidations, open interest, wallet PnL and trader rankings. Native perps, HIP-3, HIP-4 and spot. No API key needed.";
// The data toolset has no alert tools.
const DATA_DESCRIPTION =
  "Hyperliquid market data and wallet analytics from our own nodes: trades, funding, liquidations, open interest, wallet PnL and trader rankings. Native perps, HIP-3, HIP-4 and spot. Read-only, no API key needed.";

// Server-level guidance the client shows the model alongside the tool list.
// The data toolset (plain.ts) leaves out the alert, Ironbox, key and x402
// sentences with the tools they are about.
const NAMES =
  "Markets take display symbols (BTC-PERP, xyz:NVDA-PERP, HYPE/USDC) or Hyperliquid names (BTC, @107, xyz:NVDA); list_markets with q finds a name. Times take Unix ms, Unix seconds, ISO 8601 or relative times (-7d, -24h, now).";
const WHERE_TO_START =
  "Where to start: liquidations with get_liquidations (rows) or get_liquidation_summary (totals by market and window), and get_liquidation_map for where open positions would be liquidated if the price moved; a wallet with get_user_state (positions), get_user_pnl_series and get_user_funding; market moves with get_markets_snapshot, get_candles and get_open_interest_changes; who trades with get_top_traders and get_market_top_wallets.";
const SQL =
  "For anything the named tools do not cover, call describe_data and then run_query with ClickHouse SQL over the hl.* tables.";
const KEYLESS = "Keyless use allows 30 requests per minute, 300 per day and 24 hours of history";
const DATA_INSTRUCTIONS = `Hyperliquid market data from Ironflow's own nodes: trades, candles, funding, open interest, liquidations, mark prices, market snapshots and wallet analytics for native perps, HIP-3 builder markets, HIP-4 outcomes and spot. Every tool only reads. ${NAMES} ${WHERE_TO_START} A result that starts with a notice says how a market name was read or that the data starts later than asked; pass it on to the user. ${SQL} ${KEYLESS}.`;
const ALL_INSTRUCTIONS = `Hyperliquid market data from Ironflow's own nodes, and liquidation alerts: trades, candles, funding, open interest, liquidations, mark prices, market snapshots and wallet analytics for native perps, HIP-3 builder markets, HIP-4 outcomes and spot. ${NAMES} ${WHERE_TO_START} To have liquidations posted to the user's Discord, Slack, Telegram or webhook as they happen, use create_liquidation_alert, then test_liquidation_alert (the alert tools need an API key, a free key works). An agent can spin up its own Ironbox with create_ironbox to trade on paper next to Hyperliquid. It needs no key; get_ironbox and delete_ironbox need one. A result that starts with a notice says how a market name was read or that the data starts later than asked; pass its next step on to the user. ${SQL} ${KEYLESS}; a free key from https://ironflow.sh/key raises that to 60 per minute and 14 days. Agents with a USDC wallet on Base can also pay per call with x402, from $0.001, with no key: https://docs.ironflow.sh/guides/pay-per-call.`;
export const instructions = (toolset: Toolset): string => (toolset === "data" ? DATA_INSTRUCTIONS : ALL_INSTRUCTIONS);

// Reads the package version from package.json so MCP clients see the real
// version in serverInfo instead of a constant that drifts on every release.
export function packageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    const raw = readFileSync(join(here, "..", "package.json"), "utf-8");
    return (JSON.parse(raw).version as string) ?? "unknown";
  } catch {
    return "unknown";
  }
}

// ServerOptions tunes createServer for its transport.
export interface ServerOptions {
  // fallbackClient names the client app when the MCP session has no
  // initialize to read it from (the stateless hosted server answers each
  // POST with a fresh server, so it passes the request's User-Agent).
  fallbackClient?: string;
  // onToolResult hears how each tool call ended, for the hosted access log.
  onToolResult?: (result: ToolOutcome) => void;
  // toolset "data" serves the read-only data tools only, with no plan, x402
  // or key sign-up lines (tools.ts, plain.ts); default all.
  toolset?: Toolset;
}

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

// ToolOutcome is how one tool call ended: the tool, whether the result went
// back to the client as an error, and if so the error text.
export interface ToolOutcome {
  tool: string;
  isError: boolean;
  error?: string;
}

// createServer wires the tool list and tool calls to one API client.
export function createServer(api: IronflowAPI, version: string, options: ServerOptions = {}): Server {
  const toolset = options.toolset ?? "all";
  const data = toolset === "data";
  const tools = toolsFor(toolset);
  const outputSchema = (name: string): Schema =>
    data ? dataOutputSchema(name) : outputSchemas[name];
  const server = new Server(
    {
      name: "ironflow",
      title: "Ironflow Hyperliquid",
      version,
      description: data ? DATA_DESCRIPTION : DESCRIPTION,
      websiteUrl: "https://ironflow.sh/#mcp",
      icons: [
        { src: "https://ironflow.sh/apple-touch-icon.png", mimeType: "image/png", sizes: ["256x256"] },
        { src: "https://ironflow.sh/favicon.svg", mimeType: "image/svg+xml", sizes: ["any"] },
      ],
    },
    { capabilities: { tools: {} }, instructions: instructions(toolset) }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    // Most tools only read, from data outside this server: readOnlyHint
    // and openWorldHint. The alert and Ironbox tools say what they change.
    // The title appears at the top level and in the annotations, which
    // older clients read.
    tools: tools.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      outputSchema: outputSchema(t.name),
      annotations: { title: t.title, ...(t.annotations ?? { readOnlyHint: true }), openWorldHint: true },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await callTool(request.params.name, request.params.arguments);
    const isError = result.isError === true;
    options.onToolResult?.({ tool: request.params.name, isError, error: isError ? result.content[0]?.text : undefined });
    return result;
  });

  async function callTool(name: string, args: Record<string, unknown> | undefined): Promise<ToolResult> {
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }
    const info = server.getClientVersion();
    const client = info?.name ? `${info.name}${info.version ? `/${info.version}` : ""}` : options.fallbackClient;
    // One client copy per call, so the notices read below are this call's.
    const scoped = api.withContext({ client, tool: name });
    if (tool.needsKey?.(args ?? {}) && !scoped.hasKey()) {
      const text = data ? `Error: ${name} needs an API key.` : `Error: ${keyRequiredText(name, args ?? {})}`;
      return { content: [{ type: "text", text }], isError: true };
    }
    try {
      // An option value outside the tool's list never reaches the API, which
      // would answer 400: it is read as the allowed value it obviously means
      // or, by a read-only tool, left out for the default, and the notice
      // says which. A tool that changes something (readOnlyHint false)
      // answers with an error instead of acting on a default.
      const strict = tool.annotations?.readOnlyHint === false;
      const { args: fitted, fixes } = fitEnums(tool.inputSchema, args ?? {}, { strict });
      for (const fix of fixes) scoped.addNotice(enumNotice(fix));
      const structured = structuredFrom(await tool.handler(fitted, scoped));
      // Compact JSON, trimmed to fit a client's per-result limit, with the
      // notice (ours, then the API's, if any) first.
      const text = data
        ? fitToBudget(attachNotice(plainResult(name, structured), plainText(scoped.notice())))
        : fitToBudget(attachNotice(structured, scoped.notice()));
      return {
        content: [{ type: "text", text }],
        structuredContent: JSON.parse(text) as Record<string, unknown>,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const notice = scoped.notice();
      const text = notice && !message.includes(notice) ? `Error: ${message} ${notice}` : `Error: ${message}`;
      return { content: [{ type: "text", text: data ? plainError(text) : text }], isError: true };
    }
  }

  return server;
}

// dataOutputSchema is a tool's output schema as the data toolset lists it:
// descriptions plain, and the notice described without its key next step.
function dataOutputSchema(name: string): Schema {
  const schema = plainSchema(outputSchemas[name]);
  const properties = schema.properties as Record<string, Schema> | undefined;
  return properties ? { ...schema, properties: { ...properties, notice: DATA_NOTICE } } : schema;
}

// structuredFrom turns a tool's JSON text into MCP structured output. Every
// tool declares an output schema, and clients reject a successful result
// without structuredContent, so anything that is not a JSON object is
// wrapped as { result }. The schemas mark no field required, so the wrapper
// still validates.
export function structuredFrom(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { result: parsed };
  } catch {
    return { result: text };
  }
}
