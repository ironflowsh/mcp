// MCP prompts: ready-made starts that clients show as slash commands or in a
// prompt menu (Claude Code lists them as /mcp__<server>__<name>). Before
// 0.19.2 the server had none, so a client offered no way in but a typed
// question. Each prompt names the read-only tools that answer it, so both
// toolsets serve the same prompts.

import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

export interface PromptArgument {
  name: string;
  description: string;
  required?: boolean;
}

export interface PromptDef {
  name: string;
  title: string;
  description: string;
  arguments: PromptArgument[];
  text: (args: Record<string, string>) => string;
}

// An argument is the user's own text; it is trimmed and kept short.
const MAX_ARG_LEN = 100;
const value = (args: Record<string, string> | undefined, key: string): string =>
  String(args?.[key] ?? "").trim().slice(0, MAX_ARG_LEN);

export const prompts: PromptDef[] = [
  {
    name: "biggest_liquidations",
    title: "Biggest liquidations today",
    description: "The largest Hyperliquid liquidations of the last 24 hours, across every market or on one",
    arguments: [{ name: "market", description: "Optional: one market such as BTC or xyz:NVDA. Leave empty for every market" }],
    text: ({ market }) => {
      const on = market ? ` on ${market}` : "";
      const filter = market ? ` and market ${market}` : "";
      return `Show the biggest Hyperliquid liquidations of the last 24 hours${on}. Call get_liquidation_summary with window 24h${filter} for the totals, longs against shorts, the top markets and the largest single liquidation. For the next largest ones, call describe_data, then run_query on hl.liquidations ordered by notional. Answer with a short summary and a table of the largest liquidations: market, side, size in USD, price and time.`;
    },
  },
  {
    name: "liquidation_map",
    title: "Liquidation map",
    description: "Where open positions on a Hyperliquid perp would be liquidated if the price moved",
    arguments: [{ name: "market", description: "A perp such as BTC, ETH or xyz:NVDA. Default BTC" }],
    text: ({ market }) => {
      const m = market || "BTC";
      return `Where would open ${m} positions on Hyperliquid be liquidated if the price moved? Call get_liquidation_map with market ${m}. Show the current price, the largest long clusters below it and short clusters above it with their distance in percent, and say how old the snapshot is.`;
    },
  },
  {
    name: "market_movers",
    title: "What is moving",
    description: "Hyperliquid markets with the biggest price and open interest moves of the last 24 hours",
    arguments: [],
    text: () =>
      "What is moving on Hyperliquid right now? Call get_markets_snapshot with sort_by abs_change_24h for the biggest price moves, and get_open_interest_changes with window 24h for where money flows in or out. Answer with the top 5 of each and one line on what stands out.",
  },
  {
    name: "wallet_check",
    title: "Check a wallet",
    description: "Open positions, PnL and trading record of one Hyperliquid wallet",
    arguments: [{ name: "address", description: "The wallet address (0x...)", required: true }],
    text: ({ address }) =>
      `Check the Hyperliquid wallet ${address}. Call get_user_state for its open positions and margin, get_user_pnl_series for its PnL over the last 30 days, and get_trader_profile for its win rate, profit factor and drawdown. Summarise what it trades, how it has done and how much risk it carries.`,
  },
];

// listPrompts is the prompts/list answer.
export function listPrompts(): Omit<PromptDef, "text">[] {
  return prompts.map(({ name, title, description, arguments: args }) => ({ name, title, description, arguments: args }));
}

// getPrompt is the prompts/get answer: one user message that asks for the
// calls. An unknown prompt or a missing required argument is an
// invalid-params error, as the MCP spec asks.
export function getPrompt(
  name: string,
  args: Record<string, string> | undefined
): { description: string; messages: { role: "user"; content: { type: "text"; text: string } }[] } {
  const prompt = prompts.find((p) => p.name === name);
  if (!prompt) {
    throw new McpError(ErrorCode.InvalidParams, `Unknown prompt: ${name}. Prompts: ${prompts.map((p) => p.name).join(", ")}`);
  }
  const values: Record<string, string> = {};
  for (const a of prompt.arguments) {
    values[a.name] = value(args, a.name);
    if (a.required && !values[a.name]) {
      throw new McpError(ErrorCode.InvalidParams, `${name} needs ${a.name}: ${a.description}`);
    }
  }
  return {
    description: prompt.description,
    messages: [{ role: "user", content: { type: "text", text: prompt.text(values) } }],
  };
}
