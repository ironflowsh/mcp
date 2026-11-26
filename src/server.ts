// Builds the Ironflow MCP server. Shared by the stdio entry (index.ts) and
// the hosted Streamable HTTP entry (http.ts) so both expose the same tools.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { IronflowAPI } from "./api.js";
import { fitToBudget } from "./budget.js";
import { fitEnums } from "./enums.js";
import { dataKeyStep, limitText, type Transport } from "./limits.js";
import { attachNotice, enumNotice } from "./notice.js";
import { DATA_NOTICE, plainError, plainResult, plainSchema, plainText } from "./plain.js";
import { getPrompt, listPrompts } from "./prompts.js";
import { outputSchemas, type Schema } from "./schemas.js";
import { keyRequiredText, type Toolset, toolsFor } from "./tools.js";

// One-line summary for MCP directories and client server lists.
const DESCRIPTION =
  "Hyperliquid market data and wallet analytics from our own nodes, plus liquidation alerts to Discord, Slack, Telegram or a webhook: trades, funding, liquidations, open interest, wallet PnL and trader rankings. Native perps, HIP-3, HIP-4 and spot. No API key needed.";
// The data toolset has no alert tools.
const DATA_DESCRIPTION =
  "Hyperliquid market data and wallet analytics from our own nodes: trades, funding, liquidations, open interest, wallet PnL and trader rankings. Native perps, HIP-3, HIP-4 and spot. Read-only, no API key needed.";

// Server-level guidance the client shows the model alongside the tool list.
// Clients that defer tool schemas (Claude Code's and claude.ai's tool search)
// show the model only these lines and the tool names, so they say when to use
// the tools and map the common questions to a first call. They steer crypto
// market questions only, and do not ask the model to pick these tools over
// others when the user names no venue (a directory rule, aeon PR #1382). The
// data toolset (plain.ts) leaves out the alert, key and x402
// sentences with the tools they are about. Older Claude Code builds cut
// instructions at 2 KB.
const SCOPE =
  "Ironflow serves live Hyperliquid data from its own nodes: perps, HIP-3 markets such as xyz:NVDA, HIP-4 outcomes and spot.";
const WHEN =
  "Use these tools for crypto market questions about prices, funding, liquidations, open interest, top traders or a 0x wallet, and say the numbers are Hyperliquid's.";
const WHERE_TO_START =
  "First call by question: biggest liquidations, get_liquidation_summary (rows: get_liquidations); liquidation levels, get_liquidation_map; funding now, get_mark_prices (history: get_funding_rates); a price, get_price (history: get_candles); what is moving, get_markets_snapshot or get_open_interest_changes; top traders, get_top_traders; a wallet, get_user_state, then get_user_pnl_series. list_markets with q finds a market name.";
const SQL = "For anything else call describe_data, then run_query with ClickHouse SQL over the hl.* tables.";
const NOTICE = "A result can start with a notice and an error can end with a step for the user; pass it on.";
const CREDITS = "Each call costs credits: 1 for a read, 5 for analytics, 10 for run_query, none for describe_data or status.";
const KEYLESS = "Keyless use allows 30 requests a minute, 100 credits a day and 24 hours of history";
const LIMITS = "Limits: https://docs.ironflow.sh/concepts/rate-limits.";
const DATA_INSTRUCTIONS = `${SCOPE} Every tool only reads. ${WHEN} ${WHERE_TO_START} ${SQL} ${NOTICE} ${CREDITS} ${KEYLESS}. ${LIMITS}`;
const ALL_INSTRUCTIONS = `${SCOPE} ${WHEN} ${WHERE_TO_START} ${SQL} ${NOTICE} ${CREDITS} ${KEYLESS}; a free key from https://ironflow.sh/key raises that to 60 a minute, 1,000 credits a day (3,000 a month) and 14 days. ${LIMITS} create_liquidation_alert posts liquidations to the user's Discord, Slack, Telegram or webhook as they happen (needs a key, a free key works); with signal position_risk it warns when watched wallets near liquidation (Explorer and up), with an edge signal it posts that signal (Pro). Agents with USDC on Base can pay per call with x402, with no key: https://docs.ironflow.sh/guides/pay-per-call.`;
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
  // transport says how a key reaches this server, for the step a limit
  // error names (limits.ts): "http" for the hosted server, default stdio.
  transport?: Transport;
  // qaCheck marks our own live checks (a qa_check User-Agent): the client
  // name sent to the API starts with qa_check, so the usage numbers leave
  // their tool calls out, as they already leave out their sessions.
  qaCheck?: boolean;
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
  const transport = options.transport ?? "stdio";
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
    { capabilities: { tools: {}, prompts: {} }, instructions: instructions(toolset) }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    // Most tools only read, from data outside this server: readOnlyHint
    // and openWorldHint. The alert tools say what they change.
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

  // Ready-made starts (prompts.ts), the same in both toolsets: each one
  // only asks for read-only tool calls.
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: listPrompts() }));
  server.setRequestHandler(GetPromptRequestSchema, async (request) =>
    getPrompt(request.params.name, request.params.arguments)
  );

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
    const scoped = api.withContext({ client: options.qaCheck ? qaClient(client) : client, tool: name });
    if (tool.needsKey?.(args ?? {}) && !scoped.hasKey()) {
      const text = data ? `Error: ${name} needs an API key.` : `Error: ${keyRequiredText(name, client, transport)}`;
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
      // A keyless limit a free key lifts says what to tell the user and how
      // to add the key in this client. The data toolset keeps the API's
      // refusal as plain data caveats (plain.ts) and adds one plain step of
      // its own (dataKeyStep).
      const ctx = { keyed: scoped.hasKey(), client, transport };
      const limit = data ? undefined : limitText(error, ctx);
      const message = limit ?? (error instanceof Error ? error.message : String(error));
      const notice = scoped.notice();
      const text = notice && !message.includes(notice) ? `Error: ${message} ${notice}` : `Error: ${message}`;
      if (!data) return { content: [{ type: "text", text }], isError: true };
      const step = dataKeyStep(error, ctx);
      const plain = plainError(text);
      return { content: [{ type: "text", text: step ? `${endSentence(plain)} ${step}` : plain }], isError: true };
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

// endSentence closes text with a full stop unless it already ends a sentence
// or with a link.
const endSentence = (text: string): string => (/[.!?]$/.test(text) || /https?:\/\/\S+$/.test(text) ? text : `${text}.`);

// qaClient is the client name a QA check's API calls carry: it starts with
// qa_check, the prefix the API's usage numbers leave out.
export function qaClient(client: string | undefined): string {
  const name = (client ?? "").trim();
  if (name.toLowerCase().startsWith("qa_check")) return name;
  return name ? `qa_check ${name}` : "qa_check";
}
