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
import { outputSchemas } from "./schemas.js";
import { tools } from "./tools.js";

// One-line summary for MCP directories and client server lists.
const DESCRIPTION =
  "Read-only Hyperliquid market data and wallet analytics from our own nodes: trades, funding, liquidations, open interest, wallet PnL and trader rankings. Native perps, HIP-3, HIP-4 and spot. No API key needed.";

// Server-level guidance the client shows the model alongside the tool list.
const INSTRUCTIONS =
  "Read-only Hyperliquid market data from Ironflow's own nodes: trades, candles, funding, open interest, liquidations, mark prices, market snapshots and wallet analytics for native perps, HIP-3 builder markets and spot. Markets use display symbols such as BTC-PERP or xyz:NVDA-PERP; call list_markets when unsure. Keyless use allows 10 requests per minute and 24 hours of history; a free key from https://ironflow.sh/key raises that to 60 per minute and 30 days.";

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

// createServer wires the tool list and tool calls to one API client.
export function createServer(api: IronflowAPI, version: string): Server {
  const server = new Server(
    {
      name: "ironflow",
      title: "Ironflow Hyperliquid",
      version,
      description: DESCRIPTION,
      websiteUrl: "https://ironflow.sh/api#mcp",
      icons: [
        { src: "https://ironflow.sh/apple-touch-icon.png", mimeType: "image/png", sizes: ["256x256"] },
        { src: "https://ironflow.sh/favicon.svg", mimeType: "image/svg+xml", sizes: ["any"] },
      ],
    },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      outputSchema: outputSchemas[t.name],
      annotations: { readOnlyHint: true, openWorldHint: true },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }
    try {
      const structured = structuredFrom(await tool.handler(args ?? {}, api));
      // Compact JSON, trimmed to fit a client's per-result limit.
      const text = fitToBudget(structured);
      return { content: [{ type: "text", text }], structuredContent: JSON.parse(text) as Record<string, unknown> };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  });

  return server;
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
