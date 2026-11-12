// MCP tool definitions for Ironflow market data.

import { IronflowAPI } from "./api.js";
import { SUMMARY_WINDOWS, WINDOW_MINUTES, summaryOutput, type LiquidationSummaryResponse } from "./liquidations.js";
import { MAX_LIMIT, rankSnapshot, SORT_KEYS, type SortKey } from "./snapshot.js";
import {
  BEHAVIOR_LABELS,
  BEHAVIOR_SORT_KEYS,
  behaviorSQL,
  MAX_BEHAVIOR_LIMIT,
  MAX_VAULT_LEADERBOARD_LIMIT,
  rowsToObjects,
  runQuery,
  VAULT_LEADERBOARD_DAYS,
  vaultLeaderboardSQL,
} from "./query.js";
import { DEFAULT_FUNDING_ROWS, DEFAULT_MARKETS_LIMIT, MAX_MARKETS_LIMIT, shapeMarkets, shapeOutcomeMarkets, shapeUserFunding, shapeWalletLabels } from "./shape.js";

// Tool definition type (used for listing and calling). title is the short
// human name clients show (and the Claude directory requires).
export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: string[]; items?: { type: string; enum?: string[] } }>;
    required: string[];
  };
  handler: (args: Record<string, unknown>, api: IronflowAPI) => Promise<string>;
  // What the tool does beyond reading, for the MCP annotations. Omitted: the
  // tool only reads.
  annotations?: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean };
  // needsKey reports whether a call with these arguments needs an API key.
  // Without one the server answers with how to get a key instead of calling
  // the API. Omitted: the tool works keyless.
  needsKey?: (args: Record<string, unknown>) => boolean;
}

// Alerts and boxes belong to an account, so these tools need a key.
const always = (): boolean => true;

// Ironbox is paper only: simulated funds, never a real order. A client that
// still sends another mode (an old cached schema) gets a plain refusal.
export const PAPER_ONLY = "Ironbox runs on paper only: simulated funds, never a real order. Leave mode out to get a paper box.";

// KEY_PAGE is the free key page, tagged so key requests from MCP are counted.
export const KEY_PAGE = "https://ironflow.sh/key?utm_source=mcp";

// keyRequiredText is the answer to a keyless call of a key-only tool.
export function keyRequiredText(tool: string, args: Record<string, unknown>): string {
  return `${tool} needs an API key (a free key works). Get one in a minute at ${KEY_PAGE}, then connect with the header Authorization: Bearer if_... (or ?key=if_... on the URL).`;
}

// ─── Arg validation helpers ──────────────────────────────────────────────────

function requireString(args: Record<string, unknown>, key: string): string {
  const val = args[key];
  if (typeof val !== "string" || val.trim() === "") {
    throw new Error(`"${key}" is required and must be a non-empty string`);
  }
  return val;
}

function optionalNumber(args: Record<string, unknown>, key: string, defaultVal: number): number {
  const val = args[key];
  if (val === undefined || val === null) return defaultVal;
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`"${key}" must be a positive number`);
  }
  return Math.floor(n);
}

// optionalString also takes a finite number and passes it on as text:
// agents send bucket_size 100 as often as "100" (opencode's first
// get_liquidation_map call failed on it, 2026-11-11).
function optionalString(args: Record<string, unknown>, key: string, defaultVal: string): string {
  const val = args[key];
  if (val === undefined || val === null) return defaultVal;
  if (typeof val === "number" && Number.isFinite(val)) return String(val);
  if (typeof val !== "string") {
    throw new Error(`"${key}" must be a string or a number`);
  }
  return val;
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean {
  const val = args[key];
  if (val === undefined || val === null) return false;
  if (typeof val === "boolean") return val;
  if (val === "true" || val === "false") return val === "true";
  throw new Error(`"${key}" must be true or false`);
}

// optionalTime reads a window bound and passes it on as the caller wrote it:
// the API takes Unix ms, Unix seconds, ISO 8601 (UTC when no zone is given)
// and relative times counted back from now (now, -30m, -24h, -7d, -2w,
// now-7d), so nothing is converted here. "" means not set.
function optionalTime(args: Record<string, unknown>, key: string): string {
  const val = args[key];
  if (val === undefined || val === null || val === 0) return "";
  const invalid = new Error(`"${key}" must be Unix ms, Unix seconds, an ISO 8601 date such as 2026-10-01T00:00:00Z, or a relative time such as -7d, -24h or now`);
  if (typeof val === "number") {
    if (!Number.isFinite(val) || val < 0) throw invalid;
    return String(Math.floor(val));
  }
  if (typeof val !== "string") throw invalid;
  const text = val.trim();
  if (/^\d*$/.test(text)) return Number(text) > 0 ? text : "";
  // Relative to now: now, -30m, -24h, -7d, -2w, now-7d (the API reads them).
  if (/^(now)?(-\d{1,5}[mhdw])?$/i.test(text)) return text.toLowerCase();
  // The API reads 2026-10-01, 2026-10-01T12:00 and RFC 3339 date-times.
  if (!/^\d{4}-\d{2}-\d{2}(T|$)/.test(text) || Number.isNaN(Date.parse(text))) throw invalid;
  return text;
}

// Shared parameter descriptions. The API resolves Hyperliquid names itself.
// alertId reads an alert id: a UUID, so it cannot reach another path.
function alertId(args: Record<string, unknown>): string {
  const id = requireString(args, "id").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    throw new Error("id must be an alert id such as 6f1c2a3b-... (list_liquidation_alerts lists them)");
  }
  return id;
}

// ironboxId reads an Ironbox id (ibx_...): letters, digits, _ and - only, so
// it cannot reach another path.
function ironboxId(args: Record<string, unknown>): string {
  const id = requireString(args, "id").trim();
  if (!/^ibx_[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new Error("id must be an Ironbox id such as ibx_... (list_ironboxes lists them)");
  }
  return id;
}

// boxSecret reads a paper box's URL or its bare secret and returns the secret,
// so a tool can only ever reach /box/<secret> on the Ironflow API.
function boxSecret(args: Record<string, unknown>): string {
  const match = /(?:^|\/box\/)(ibxs_[0-9a-f]{64})(?:[/?#]|$)/.exec(requireString(args, "box").trim());
  if (!match) {
    throw new Error("box must be the box's base_url from create_ironbox, or its ibxs_ secret");
  }
  return match[1];
}

// strategyId reads a strategy id: hex after a fixed prefix, so it cannot reach
// another path.
function strategyId(args: Record<string, unknown>): string {
  const id = requireString(args, "strategy_id").trim();
  if (!/^strat_[0-9a-f]{16}$/.test(id)) {
    throw new Error("strategy_id must be an id such as strat_9f2c4a7e1b3d5c60 (list_box_strategies lists them)");
  }
  return id;
}

// strategyBody copies the parameters the agent set, and nothing else, into
// the strategy request. The engine refuses anything it does not know.
const STRATEGY_FIELDS = [
  "kind", "market", "side", "size_usd", "leverage", "max_loss_usd", "lower_px", "upper_px", "grids",
  "lookback_bars", "exit_bars", "bar_seconds", "tranche_usd", "budget_usd", "dip_pct",
  "interval_minutes", "take_profit_pct", "repeat",
];

// The engine reads the grid prices as text and the sizes, counts and
// percentages as numbers; agents send either form for both.
const STRATEGY_TEXT_FIELDS = new Set(["kind", "market", "side", "lower_px", "upper_px"]);
const STRATEGY_FLAG_FIELDS = new Set(["repeat"]);

function strategyValue(key: string, val: unknown): unknown {
  if (STRATEGY_TEXT_FIELDS.has(key)) {
    return typeof val === "number" && Number.isFinite(val) ? String(val) : val;
  }
  if (STRATEGY_FLAG_FIELDS.has(key)) {
    return val === "true" ? true : val === "false" ? false : val;
  }
  if (typeof val === "string" && val.trim() !== "" && Number.isFinite(Number(val))) return Number(val);
  return val;
}

function strategyBody(args: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of STRATEGY_FIELDS) {
    if (args[key] !== undefined && args[key] !== "") body[key] = strategyValue(key, args[key]);
  }
  return body;
}

const BOX_ARG = { type: "string", description: "The paper box: its base_url from create_ironbox, or the ibxs_ secret" };

// ironboxMarkets reads markets as a list or a comma-separated string, as
// agents send either, and gives the API a list.
function ironboxMarkets(args: Record<string, unknown>): string[] | undefined {
  const val = args.markets;
  if (val === undefined || val === null || val === "") return undefined;
  const list = typeof val === "string" ? val.split(",") : val;
  if (!Array.isArray(list) || !list.every((m) => typeof m === "string")) {
    throw new Error('"markets" must be a list such as ["perps", "spot"]');
  }
  return list.map((m) => m.trim().toLowerCase()).filter(Boolean);
}

const MARKET ="Market: BTC-PERP, xyz:NVDA-PERP, HYPE/USDC, or a Hyperliquid name (BTC, @107, xyz:NVDA)";
const MARKET_FILTER = "Optional market filter: BTC-PERP or a Hyperliquid name (BTC, xyz:NVDA)";
const time = (bound: "start" | "end", extra = "") =>
  `Window ${bound}: Unix ms or seconds, ISO 8601 (2026-10-01T00:00:00Z), or relative (-7d, -24h, now)${extra ? `. ${extra}` : ""}`;

// ─── Tools ──────────────────────────────────────────────────────────────────

export const tools: ToolDef[] = [
  {
    name: "describe_data",
    title: "Describe SQL tables",
    description:
      "Returns the SQL tables of Ironflow's Hyperliquid data (every fill and trade, per-market hourly volume and liquidation totals, per-wallet daily totals, wallet behaviour labels, funding rates and per-wallet funding payments, mark and oracle prices, open interest, liquidations, builder-code fills, transfers, vault flows), their columns, how far back each goes, query tips, worked examples and your own limits.",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: async (_args, api) => JSON.stringify(await api.get("/v1/query/schema")),
  },
  {
    name: "run_query",
    title: "Run SQL query",
    description:
      "Run one read-only ClickHouse SELECT over Ironflow's Hyperliquid tables (hl.fills, hl.trades, hl.wallet_fills, hl.wallet_daily, hl.wallet_behavior, hl.market_hourly, hl.funding, hl.funding_payments, hl.mark_prices, hl.oracle_prices, hl.open_interest, hl.liquidations, hl.builder_fills, hl.transfers, hl.vault_operations). For volume, taker flow or liquidation totals per market over hours to months read hl.market_hourly, not hl.fills; call describe_data for columns. Aggregate in SQL: results are capped (1,000 rows keyless). Keyless: last 24 hours, 5 s per query, 60 query seconds per hour per IP; a free key from https://ironflow.sh/key gives 30 days of history.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "One ClickHouse SELECT (or WITH ... SELECT) over hl.* tables, without a FORMAT clause" },
        max_rows: { type: "number", description: "Most rows to return (default 200, capped by your tier)" },
      },
      required: ["sql"],
    },
    handler: async (args, api) => {
      const sql = requireString(args, "sql");
      const maxRows = optionalNumber(args, "max_rows", 200);
      return JSON.stringify(await runQuery(api, sql, maxRows));
    },
  },
  {
    name: "get_wallet_behavior",
    title: "Wallet behavior labels",
    description:
      "How Hyperliquid wallets trade, from their last 30 days: labels (market_maker, high_frequency, whale, directional, consistent_winner, big_loser, revenge_sizing, often_liquidated, hip3_trader, spot_trader, prediction_trader) and the numbers behind them (maker share, buy/sell imbalance, fills per day, green-day share, profit factor, liquidations). Look up specific addresses, or list wallets with one label.",
    inputSchema: {
      type: "object",
      properties: {
        addresses: { type: "string", description: "Comma-separated wallet addresses (up to 50). Omit to list wallets instead." },
        label: { type: "string", description: "Only wallets carrying this label", enum: [...BEHAVIOR_LABELS] },
        sort_by: { type: "string", description: "Sort order when listing (default volume)", enum: [...BEHAVIOR_SORT_KEYS] },
        min_volume_usd: { type: "number", description: "Only wallets with at least this 30-day volume" },
        limit: { type: "number", description: `Wallets to return (default 20, max ${MAX_BEHAVIOR_LIMIT})` },
      },
      required: [],
    },
    handler: async (args, api) => {
      const addresses = optionalString(args, "addresses", "")
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      const sortBy = optionalString(args, "sort_by", "volume") as (typeof BEHAVIOR_SORT_KEYS)[number];
      const minVol = args.min_volume_usd === undefined ? 0 : Number(args.min_volume_usd);
      const sql = behaviorSQL({
        addresses,
        label: optionalString(args, "label", ""),
        sortBy,
        limit: optionalNumber(args, "limit", addresses.length || 20),
        minVolumeUsd: minVol,
      });
      const res = (await runQuery(api, sql, MAX_BEHAVIOR_LIMIT)) as { columns: string[]; rows: unknown[][] };
      return JSON.stringify({ window_days: 30, wallets: rowsToObjects(res) });
    },
  },
  {
    name: "get_price",
    title: "Market price",
    description:
      "Latest mark price of one Hyperliquid market as a single number: native perps, HIP-3 builder perps (e.g. xyz:NVDA-PERP) and spot. The quickest answer to 'what is X trading at'. For the oracle price and funding use get_mark_prices; for price history use get_candles; to compare many markets at once use get_markets_snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: MARKET },
      },
      required: ["market"],
    },
    handler: async (args, api) => {
      const market = requireString(args, "market");
      const price = await api.getPrice(market);
      return JSON.stringify({ market, price });
    },
  },
  {
    name: "get_recent_trades",
    title: "Recent trades",
    description: "Latest tick-level trades on a Hyperliquid market from our own nodes: price, size, side and block time. Covers native perps, HIP-3 builder markets, HIP-4 outcomes and spot.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: MARKET },
        limit: { type: "number", description: "Number of trades to return (1-100, default 20)" },
      },
      required: ["market"],
    },
    handler: async (args, api) => {
      const market = requireString(args, "market");
      const limit = optionalNumber(args, "limit", 20);
      const data = await api.getRecentTrades(market, String(limit));
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_candles",
    title: "Candles (OHLCV)",
    description:
      "OHLCV candles for one Hyperliquid market, built from every trade: open, high, low, close, volume and trade count per candle, oldest first. Returns the latest 24 candles by default (up to 500), at 1m to 1d intervals. Use it for price history, ranges and charts. For only the current price use get_price; for individual trades use get_recent_trades.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: MARKET },
        interval: { type: "string", description: "Candle interval (1m, 5m, 15m, 1h, 4h, 1d). Default: 1h", enum: ["1m", "5m", "15m", "1h", "4h", "1d"] },
        limit: { type: "number", description: "Number of candles to return (1-500, default 24)" },
      },
      required: ["market"],
    },
    handler: async (args, api) => {
      const market = requireString(args, "market");
      const interval = optionalString(args, "interval", "1h");
      const limit = optionalNumber(args, "limit", 24);
      const data = await api.getCandles(market, interval, String(limit));
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_funding_rates",
    title: "Funding rate history",
    description: "Hourly funding rate history for a Hyperliquid perp, including HIP-3 builder perps. A positive rate means longs pay shorts.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: MARKET },
        limit: { type: "number", description: "Number of funding rate entries (1-100, default 10)" },
      },
      required: ["market"],
    },
    handler: async (args, api) => {
      const market = requireString(args, "market");
      const limit = optionalNumber(args, "limit", 10);
      const data = await api.getFundingRates(market, String(limit));
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_open_interest",
    title: "Open interest",
    description:
      "Latest open interest of one Hyperliquid perp in units of the base asset (BTC for BTC-PERP), with its 24-hour traded volume in USD and the time of the reading. Multiply by get_price for open interest in USD. To compare open interest across markets use get_markets_snapshot; for its history use run_query (see describe_data).",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: MARKET },
      },
      required: ["market"],
    },
    handler: async (args, api) => {
      const market = requireString(args, "market");
      const data = await api.getOpenInterest(market);
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_open_interest_changes",
    title: "Open interest movers",
    description:
      "Hyperliquid perps ranked by how their open interest moved over the last 1h, 4h, 24h or 7d: open interest at the start and now (in coins), the change in USD at the latest mark and in percent. Sorted by the size of the USD change by default, or by percent. Filter to one HIP-3 dex (xyz) or to native perps only. Markets with less than $100k of open interest at both ends are left out unless you lower min_oi_usd. Use it for 'where is money flowing in or out'. For one market's latest open interest use get_open_interest.",
    inputSchema: {
      type: "object",
      properties: {
        window: { type: "string", enum: ["1h", "4h", "24h", "7d"], description: "Lookback window (default 24h)" },
        sort: { type: "string", enum: ["usd", "pct"], description: "Rank by USD change (default) or percent change" },
        dex: { type: "string", description: "Optional: a HIP-3 dex such as xyz, or native for validator-run perps" },
        min_oi_usd: { type: "number", description: "Leave out markets below this open interest in USD (default 100000)" },
        limit: { type: "number", description: "Number of markets (1-200, default 25)" },
      },
      required: [],
    },
    handler: async (args, api) => {
      const window = optionalString(args, "window", "24h");
      const sort = optionalString(args, "sort", "usd");
      const limit = optionalNumber(args, "limit", 25);
      const dex = optionalString(args, "dex", "");
      const minOi = args.min_oi_usd === undefined ? undefined : String(optionalNumber(args, "min_oi_usd", 100000));
      const data = await api.getOpenInterestChanges(window, sort, String(limit), dex || undefined, minOi);
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_outcome_markets",
    title: "HIP-4 outcome markets overview",
    description:
      "Hyperliquid HIP-4 outcome markets (prediction markets on sports, central bank decisions, IPOs and daily BTC price contracts) over the last 4 hours, 1 day or 1 week: traded volume (each trade counted once), fills, wallets and active markets, plus the most traded outcomes with their last traded price (the implied probability, 0 to 1) and last-24-hour traded volume. Each outcome has a Yes and a No side whose prices sum to 1. For one outcome's trades or candles pass its symbol to get_recent_trades or get_candles; settled outcomes stay queryable. For per-wallet outcome activity use run_query on hl.wallet_daily with market_class = 'prediction'.",
    inputSchema: {
      type: "object",
      properties: {
        window: { type: "string", enum: ["4h", "1d", "1w"], description: "Lookback window for the totals (default 1d)" },
        limit: { type: "number", description: "Number of outcomes to return, most traded first (1-200, default 20)" },
      },
      required: [],
    },
    handler: async (args, api) => {
      const window = optionalString(args, "window", "1d");
      const limit = Math.min(Math.max(optionalNumber(args, "limit", 20), 1), 200);
      const data = (await api.getOutcomeMarkets(window)) as Record<string, unknown>;
      return JSON.stringify(shapeOutcomeMarkets(data, limit), null, 2);
    },
  },
  {
    name: "get_premium",
    title: "Mark against oracle premium",
    description:
      "A Hyperliquid perp's mark price against its oracle price over time, with the premium in basis points ((mark / oracle - 1) x 10,000) per bucket and a summary (latest, mean, min, max). On HIP-3 stock, index and commodity perps such as xyz:NVDA-PERP, xyz:GOLD-PERP or xyz:SP500-PERP the oracle follows the underlying, so this shows how far the perp trades from what it tracks, weekends included. Default 1h buckets over the last 7 days. For funding payments use get_funding_rates.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: MARKET },
        interval: { type: "string", enum: ["1m", "5m", "15m", "1h", "4h", "1d"], description: "Bucket size (default 1h)" },
        days: { type: "number", description: "How many days back (default 7; limited by your key's history window)" },
      },
      required: ["market"],
    },
    handler: async (args, api) => {
      const market = requireString(args, "market");
      const interval = optionalString(args, "interval", "1h");
      const from = args.days === undefined ? undefined : String(Date.now() - Math.max(optionalNumber(args, "days", 7), 0) * 86_400_000);
      const data = await api.getPremium(market, interval, from);
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_liquidations",
    title: "Liquidations",
    description: "Liquidations on a Hyperliquid perp, read from our own nodes: price, size, side and the liquidated wallet. Hyperliquid's public API has no liquidation feed.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: MARKET },
        limit: { type: "number", description: "Number of liquidation events (1-100, default 20)" },
      },
      required: ["market"],
    },
    handler: async (args, api) => {
      const market = requireString(args, "market");
      const limit = optionalNumber(args, "limit", 20);
      const data = await api.getLiquidations(market, String(limit));
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "create_liquidation_alert",
    title: "Create liquidation alert",
    description:
      "Have Ironflow post Hyperliquid liquidations to the user's Discord channel, Slack channel, Telegram chat or HTTPS webhook as they happen (within seconds), filtered by market, side, size and wallet. It keeps running after the conversation: use it when the user wants to be told about liquidations, not just to see them now. Needs an API key (a free key works: 1 alert; Explorer 5; Builder 20). Give url (a Discord channel webhook from channel settings, Integrations, Webhooks, Copy Webhook URL; a Slack incoming webhook; or any public https URL) or telegram_chat (then tell the user to add the bot named in the result's setup to that chat). A plain webhook gets signed JSON, and its signing_secret appears only in this result, so pass it on. Then call test_liquidation_alert to check that it arrives.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Where to post: https://discord.com/api/webhooks/..., https://hooks.slack.com/services/... or a public https URL (or use telegram_chat)" },
        telegram_chat: { type: "string", description: "A Telegram chat instead of url: @channel or group name, or a numeric chat id (-100...)" },
        markets: { type: "string", description: "Comma-separated markets, e.g. BTC,ETH-PERP,xyz:NVDA (Hyperliquid names work); omit for every market" },
        side: { type: "string", enum: ["any", "long", "short"], description: "Which positions: long = longs liquidated (default any)" },
        min_usd: { type: "number", description: "Smallest liquidation to report, in USD (default 0; 100000 keeps a channel readable)" },
        address: { type: "string", description: "Only this wallet's liquidations (0x...)" },
        name: { type: "string", description: "Label shown in each message, e.g. BTC whales" },
      },
      required: [],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    needsKey: always,
    handler: async (args, api) => {
      const url = optionalString(args, "url", "");
      const telegram = optionalString(args, "telegram_chat", "");
      if (!url && !telegram) {
        throw new Error("give url (Discord, Slack or https webhook) or telegram_chat");
      }
      const body: Record<string, unknown> = url ? { url } : { telegram_chat: telegram };
      const markets = optionalString(args, "markets", "");
      if (markets) body.markets = markets;
      const side = optionalString(args, "side", "");
      if (side) body.side = side;
      if (args.min_usd !== undefined) body.min_usd = optionalNumber(args, "min_usd", 0);
      const address = optionalString(args, "address", "");
      if (address) body.address = address;
      const name = optionalString(args, "name", "");
      if (name) body.name = name;
      return JSON.stringify(await api.post("/v1/alerts", body), null, 2);
    },
  },
  {
    name: "list_liquidation_alerts",
    title: "List liquidation alerts",
    description:
      "Needs an API key (a free key works). The Hyperliquid liquidation alerts on this API key's account: where each posts (host only), its filter, whether it is active, failed deliveries in a row with the last error, liquidations sent so far, and how many alerts the tier allows. An alert is disabled after 20 failed deliveries in a row; test_liquidation_alert re-enables it once the destination works again.",
    inputSchema: { type: "object", properties: {}, required: [] },
    needsKey: always,
    handler: async (_args, api) => JSON.stringify(await api.get("/v1/alerts"), null, 2),
  },
  {
    name: "test_liquidation_alert",
    title: "Test liquidation alert",
    description:
      "Needs an API key (a free key works). Send a sample Hyperliquid liquidation, marked as a test, to an alert's destination now and report whether it arrived (delivered true or false, with the destination's answer). A delivered test switches a disabled alert back on. One test per alert every 10 seconds.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Alert id from create_liquidation_alert or list_liquidation_alerts" } },
      required: ["id"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    needsKey: always,
    handler: async (args, api) => {
      const id = alertId(args);
      return JSON.stringify(await api.post(`/v1/alerts/${id}/test`, {}), null, 2);
    },
  },
  {
    name: "delete_liquidation_alert",
    title: "Delete liquidation alert",
    description: "Needs an API key (a free key works). Stop and remove one Hyperliquid liquidation alert from this API key's account; nothing more is sent to its destination.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Alert id from list_liquidation_alerts" } },
      required: ["id"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    needsKey: always,
    handler: async (args, api) => {
      const id = alertId(args);
      await api.del(`/v1/alerts/${id}`);
      return JSON.stringify({ deleted: true, id });
    },
  },
  {
    name: "create_ironbox",
    title: "Spin up an Ironbox",
    description:
      "Spin up an Ironbox: a secure sandbox next to Hyperliquid where an agent trades on paper, with Ironflow data, analytics and alerts built in. No key needed: you get a trial box, the agent's own simulated Hyperliquid account for 24 hours, with base_url and expires_at. It ends sooner after 2 hours with no requests and no strategy running. Point the Hyperliquid SDK's base_url at it, or start a strategy on it with start_box_strategy. A free key keeps a box. A paper box never places a real order.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name for the Ironbox, e.g. btc-funding-bot" },
        size: { type: "string", enum: ["small", "medium", "large"], description: "small (default), medium or large" },
        runtime: { type: "string", enum: ["python", "node"], description: "python (default) or node" },
        markets: {
          type: "array",
          items: { type: "string", enum: ["perps", "outcomes", "spot"] },
          description: "Hyperliquid markets the agent trades: perps, outcomes (HIP-4), spot",
        },
        note: { type: "string", description: "Free text kept with the Ironbox, e.g. what the agent does" },
      },
      required: [],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    handler: async (args, api) => {
      const mode = optionalString(args, "mode", "paper").trim().toLowerCase() || "paper";
      if (mode !== "paper") throw new Error(PAPER_ONLY);
      const body: Record<string, unknown> = { mode: "paper" };
      for (const key of ["name", "size", "runtime", "note"]) {
        const val = optionalString(args, key, "").trim();
        if (val) body[key] = val;
      }
      const markets = ironboxMarkets(args);
      if (markets) body.markets = markets;
      return JSON.stringify(await api.post("/v1/ironbox", body), null, 2);
    },
  },
  {
    name: "list_ironboxes",
    title: "List Ironboxes",
    description:
      "The Ironboxes on this API key's account, the sandboxes where agents trade on paper next to Hyperliquid: id, name, state (creating, running, stopped, deleted or error), size, mode, runtime and markets. Without a key there are no saved boxes, and the answer says how to make a trial box with create_ironbox.",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: async (_args, api) => JSON.stringify(await api.get("/v1/ironbox"), null, 2),
  },
  {
    name: "get_ironbox",
    title: "Get Ironbox",
    description:
      "Needs an API key (a free key works). One Ironbox by id: its state (creating, running, stopped, deleted or error), size, mode, runtime, Hyperliquid markets and region.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Ironbox id (ibx_...) from create_ironbox or list_ironboxes" } },
      required: ["id"],
    },
    needsKey: always,
    handler: async (args, api) => JSON.stringify(await api.get(`/v1/ironbox/${ironboxId(args)}`), null, 2),
  },
  {
    name: "delete_ironbox",
    title: "Delete Ironbox",
    description: "Needs an API key (a free key works). Stop and delete one Ironbox from this API key's account; the agent in it stops running on Hyperliquid.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Ironbox id (ibx_...) from list_ironboxes" } },
      required: ["id"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    needsKey: always,
    handler: async (args, api) => {
      const id = ironboxId(args);
      return JSON.stringify((await api.del(`/v1/ironbox/${id}`)) ?? { id, state: "deleted" }, null, 2);
    },
  },
  {
    name: "start_box_strategy",
    title: "Start a strategy on a paper box",
    description:
      "Start a strategy on a Hyperliquid paper box: it runs around the clock with no client connected, in simulation only. No key needed, the box URL authorises it, so a trial box from create_ironbox works. kind is breakout (size_usd, lookback_bars, exit_bars, bar_seconds), grid (lower_px, upper_px, grids, size_usd) or dca (tranche_usd, budget_usd, dip_pct, interval_minutes, take_profit_pct, repeat). Every kind needs market and max_loss_usd: when the net loss reaches it, the strategy closes its position and stops. At most 3 per box, one per market. Follow it with get_box_activity.",
    inputSchema: {
      type: "object",
      properties: {
        box: BOX_ARG,
        kind: { type: "string", enum: ["breakout", "grid", "dca"], description: "Which strategy" },
        market: { type: "string", description: "A live main perp, by display symbol or Hyperliquid name, e.g. BTC-PERP or BTC" },
        max_loss_usd: { type: "number", description: "Net loss in USD that stops the strategy (required)" },
        side: { type: "string", enum: ["long", "short", "both"], description: "breakout: long, short or both (default both). grid and dca: long (default) or short" },
        size_usd: { type: "number", description: "breakout: notional of each entry. grid: total across the ladder, at least 10 a level" },
        leverage: { type: "number", description: "Cross leverage on this market, default 3" },
        lower_px: { type: "string", description: "grid: bottom of the ladder" },
        upper_px: { type: "string", description: "grid: top of the ladder" },
        grids: { type: "number", description: "grid: rungs, 2 to 25, default 10" },
        lookback_bars: { type: "number", description: "breakout: entry channel, 5 to 120 bars, default 20" },
        exit_bars: { type: "number", description: "breakout: exit channel, default half of lookback_bars" },
        bar_seconds: { type: "number", description: "breakout: 60 (default), 300 or 900" },
        tranche_usd: { type: "number", description: "dca: notional of each entry" },
        budget_usd: { type: "number", description: "dca: total notional across the cycle" },
        dip_pct: { type: "number", description: "dca: move against the last entry that buys the next tranche, default 3" },
        interval_minutes: { type: "number", description: "dca: also buy a tranche after this long" },
        take_profit_pct: { type: "number", description: "dca: close the stack at this gain on the average entry" },
        repeat: { type: "boolean", description: "dca: start a new cycle after a take profit" },
      },
      required: ["box", "kind", "market", "max_loss_usd"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    handler: async (args, api) =>
      JSON.stringify(await api.post(`/box/${boxSecret(args)}/strategies`, strategyBody(args)), null, 2),
  },
  {
    name: "list_box_strategies",
    title: "List a paper box's strategies",
    description: "The strategies on a Hyperliquid paper box, running and recently stopped, each with its status, stop reason and result. Needs only the box URL.",
    inputSchema: { type: "object", properties: { box: BOX_ARG }, required: ["box"] },
    handler: async (args, api) => JSON.stringify(await api.get(`/box/${boxSecret(args)}/strategies`), null, 2),
  },
  {
    name: "stop_box_strategy",
    title: "Stop a strategy on a paper box",
    description:
      "Stop one strategy on a Hyperliquid paper box: its orders are cancelled and its position is closed at the book, unless close_position is false. The answer says stopping until the close fills, then list_box_strategies shows stopped. Needs only the box URL.",
    inputSchema: {
      type: "object",
      properties: {
        box: BOX_ARG,
        strategy_id: { type: "string", description: "strat_... from start_box_strategy or list_box_strategies" },
        close_position: { type: "boolean", description: "false leaves its position open on the box; default true" },
      },
      required: ["box", "strategy_id"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    handler: async (args, api) => {
      const query = args.close_position === false ? "?close_position=false" : "";
      return JSON.stringify(await api.del(`/box/${boxSecret(args)}/strategies/${strategyId(args)}${query}`), null, 2);
    },
  },
  {
    name: "get_box_activity",
    title: "Watch a paper box",
    description:
      "What a Hyperliquid paper box and its strategies really did: strategy started, decisions with their reasons, orders, fills, funding, stops, plus equity, PnL, fees and positions. Call it with no after for the latest events, then pass next_cursor as after. gap true means some events were missed. Needs only the box URL.",
    inputSchema: {
      type: "object",
      properties: {
        box: BOX_ARG,
        after: { type: "number", description: "next_cursor from the previous answer" },
        limit: { type: "number", description: "Events to return, 1 to 200, default 100" },
      },
      required: ["box"],
    },
    handler: async (args, api) => {
      const params: Record<string, string> = {};
      if (args.after !== undefined) params.after = String(optionalNumber(args, "after", 0));
      if (args.limit !== undefined) params.limit = String(optionalNumber(args, "limit", 100));
      return JSON.stringify(await api.get(`/box/${boxSecret(args)}/activity`, params), null, 2);
    },
  },

  {
    name: "get_auto_deleveraging",
    title: "Auto-deleveraging fills",
    description:
      "Hyperliquid auto-deleveraging (ADL) fills, newest first, across all markets or one: profitable positions Hyperliquid closed to cover a liquidation its backstop could not absorb. Per fill: wallet, market, side, price, size, notional, realized PnL, trade id (shared with the liquidated side) and transaction hash. Recorded from 2026-08-01; the default window is the last 7 days. For the liquidated side use get_liquidations.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: MARKET_FILTER },
        days: { type: "number", description: "How many days back (default 7)" },
        limit: { type: "number", description: "Number of fills (1-1000, default 100)" },
      },
      required: [],
    },
    handler: async (args, api) => {
      const market = optionalString(args, "market", "");
      const limit = optionalNumber(args, "limit", 100);
      const from = args.days === undefined ? undefined : String(Date.now() - Math.max(optionalNumber(args, "days", 7), 0) * 86_400_000);
      const data = await api.getAutoDeleveraging(String(limit), market || undefined, from);
      return JSON.stringify(data, null, 2);
    },
  },

  // ─── Additional Market Data ──────────────────────────────────────────

  {
    name: "get_liquidation_summary",
    title: "Liquidation summary",
    description:
      "Liquidations on Hyperliquid over a trailing window, totalled across every market or the ones named: count, wallets, notional, longs vs shorts liquidated, the top markets and the largest single liquidation with its price. Use it for 'who got liquidated in the last hour?' or 'how much was liquidated today?'. For the individual liquidations use get_liquidations; for liquidations grouped by price use get_liquidation_levels; for where open positions would be liquidated next use get_liquidation_map. Windows from 15m to 24h without a key, 7d with one. Totals are computed by the API over every liquidation, not sampled.",
    inputSchema: {
      type: "object",
      properties: {
        window: { type: "string", enum: [...SUMMARY_WINDOWS], description: "Trailing window. Default 1h" },
        market: { type: "string", description: "Optional: one market or a comma list (BTC-PERP,ETH-PERP); Hyperliquid names work (BTC, xyz:NVDA)" },
        minutes: { type: "number", description: "Older form of window, rounded up to the next one (90 becomes 4h)" },
      },
      required: [],
    },
    handler: async (args, api) => {
      let window = optionalString(args, "window", "");
      if (!window) {
        const minutes = optionalNumber(args, "minutes", 60);
        const fit = SUMMARY_WINDOWS.find((w) => WINDOW_MINUTES[w] >= minutes);
        if (!fit) {
          throw new Error(`"minutes" must be at most ${WINDOW_MINUTES["7d"]} (7 days)`);
        }
        window = fit;
      }
      if (!(SUMMARY_WINDOWS as readonly string[]).includes(window)) {
        throw new Error(`"window" must be one of ${SUMMARY_WINDOWS.join(", ")}`);
      }
      const market = optionalString(args, "market", "");
      const params: Record<string, string> = { windows: window };
      if (market) params.market = market;
      const res = (await api.get("/v1/liquidations/summary", params)) as LiquidationSummaryResponse;
      return JSON.stringify(summaryOutput(res, market), null, 2);
    },
  },
  {
    name: "get_fills",
    title: "Wallet fills",
    description: "Every fill for one Hyperliquid wallet, optionally for one market, from indexed history: price, size, side, fee and realized PnL. Hyperliquid's own userFills endpoints stop at the 10,000 most recent fills.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Wallet address (e.g. 0x...)" },
        market: { type: "string", description: MARKET_FILTER },
        limit: { type: "number", description: "Number of fills (1-100, default 20)" },
      },
      required: ["address"],
    },
    handler: async (args, api) => {
      const address = requireString(args, "address");
      const market = optionalString(args, "market", "");
      const limit = optionalNumber(args, "limit", 20);
      const data = await api.getFills(address, market, String(limit));
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_mark_prices",
    title: "Mark and oracle price",
    description:
      "Latest mark price, oracle price and current hourly funding rate of one Hyperliquid perp, with the time of the reading. The funding rate is a fraction per hour (0.0000125 = 0.00125%); positive means longs pay shorts. Use it when you need the oracle price or funding next to the mark, for example for basis or premium. For only the price use get_price, for funding history get_funding_rates, and for many markets at once get_markets_snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: MARKET },
      },
      required: ["market"],
    },
    handler: async (args, api) => {
      const market = requireString(args, "market");
      const data = await api.getMarkPrices(market);
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_vault_operations",
    title: "Vault deposits and withdrawals",
    description:
      "Deposits into and withdrawals from one Hyperliquid vault or one depositor. Pass vault, address, or both; at least one is required (HLP is 0xdfc24b077bc1425ad1dea75bcb6f8158e10df303).",
    inputSchema: {
      type: "object",
      properties: {
        vault: { type: "string", description: "Vault address (vault or address is required)" },
        address: { type: "string", description: "Depositor address (vault or address is required)" },
        limit: { type: "number", description: "Number of events (1-100, default 20)" },
      },
      required: [],
    },
    handler: async (args, api) => {
      // The API stores addresses lowercase and answers 400 when neither
      // filter is set, so check here and say what to pass.
      const vault = optionalString(args, "vault", "").trim().toLowerCase();
      const address = optionalString(args, "address", "").trim().toLowerCase();
      if (!vault && !address) {
        throw new Error(
          'Pass "vault" (a vault address, e.g. HLP 0xdfc24b077bc1425ad1dea75bcb6f8158e10df303) or "address" (a depositor), or both. For flows across all vaults use get_vault_leaderboard.'
        );
      }
      const limit = optionalNumber(args, "limit", 20);
      const data = await api.getVaultOperations(vault, address, String(limit));
      return JSON.stringify(data, null, 2);
    },
  },

  // ─── Analytics ───────────────────────────────────────────────────────

  {
    name: "get_liquidation_levels",
    title: "Liquidation levels",
    description: "Liquidations that happened on a Hyperliquid perp, bucketed by price and side: where longs and shorts were wiped out (side sell = a liquidated long). These are past liquidations; for where open positions would be liquidated next, use get_liquidation_map. Without a key you get the 10 busiest levels of the last 24 hours; any key, including a free one (https://ironflow.sh/key), returns every level.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: MARKET },
        bucket_size: { type: "string", description: "Price bucket width: auto (default, about 0.25% of price, right for any coin) or a fixed 1, 5, 10, 50, 100, 500, 1000 or 5000 (a number works too)" },
      },
      required: ["market"],
    },
    handler: async (args, api) => {
      const market = requireString(args, "market");
      const bucket = optionalString(args, "bucket_size", "auto");
      const data = await api.getLiquidationLevels(market, bucket);
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_liquidation_map",
    title: "Liquidation map",
    description: "Where open positions on a Hyperliquid perp would be liquidated if the price moved: notional (size x liquidation price) by price range, longs below the current price and shorts above, with running totals from the price outward. Built from every open position in our node's latest state snapshot, about every 12 minutes (snapshot.age_s says how old). Cross-margin prices assume the account's other positions stay at mark, so a real move that drags correlated markets liquidates earlier; portfolio-margin accounts use Hyperliquid's own liquidation price. For liquidations that already happened use get_liquidation_levels. Without a key you get the 10 largest ranges within 10% of the price; any key, including a free one (https://ironflow.sh/key), returns every range.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: MARKET },
        bucket_size: { type: "string", description: "Price range width: auto (default, about 0.25% of price) or a number in the market's price units, as text or a number" },
        range_pct: { type: "number", description: "How far from the current price to cover, in percent. Default 20, max 50" },
        side: { type: "string", enum: ["both", "long", "short"], description: "Which side's liquidations. Default both" },
      },
      required: ["market"],
    },
    handler: async (args, api) => {
      const market = requireString(args, "market");
      const bucket = optionalString(args, "bucket_size", "auto");
      const range = optionalNumber(args, "range_pct", 20);
      const side = optionalString(args, "side", "both");
      const data = await api.getLiquidationMap(market, bucket, String(range), side);
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_vault_leaderboard",
    title: "Vault leaderboard",
    description: `Hyperliquid vaults ranked by net deposits (deposits minus withdrawals) over the last ${VAULT_LEADERBOARD_DAYS} days, with depositor counts. Keyless calls see the last 24 hours; a free key from https://ironflow.sh/key gives the full ${VAULT_LEADERBOARD_DAYS} days.`,
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: `Number of vaults (default 10, max ${MAX_VAULT_LEADERBOARD_LIMIT})` },
      },
      required: [],
    },
    handler: async (args, api) => {
      const limit = optionalNumber(args, "limit", 10);
      // GET /v1/analytics/vault-leaderboard needs an API key (any tier;
      // 403 TIER_FORBIDDEN without one). Keyed callers try it first; keyless
      // callers, and any key it refuses, get the same ranking from SQL.
      if (api.hasKey()) {
        try {
          return JSON.stringify(await api.getVaultLeaderboard(String(limit)), null, 2);
        } catch (err) {
          if (!(err instanceof Error && err.message.includes("TIER_FORBIDDEN"))) throw err;
        }
      }
      const res = (await runQuery(api, vaultLeaderboardSQL(limit), MAX_VAULT_LEADERBOARD_LIMIT)) as {
        columns: string[];
        rows: unknown[][];
        limits?: { history_days?: number };
      };
      const historyDays = res.limits?.history_days;
      return JSON.stringify({
        window_days: historyDays ? Math.min(historyDays, VAULT_LEADERBOARD_DAYS) : VAULT_LEADERBOARD_DAYS,
        data: rowsToObjects(res).map((row) => ({ source: "hyperliquid", ...row })),
      });
    },
  },
  {
    name: "get_funding_stats",
    title: "Funding statistics",
    description: "Funding statistics per time bucket for a Hyperliquid perp: average, minimum, maximum and annualized rate.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: MARKET },
        interval: { type: "string", description: "Time interval (1h, 4h, 8h, 1d, 7d). Default: 1d", enum: ["1h", "4h", "8h", "1d", "7d"] },
        limit: { type: "number", description: "Number of data points (default 7)" },
      },
      required: ["market"],
    },
    handler: async (args, api) => {
      const market = requireString(args, "market");
      const interval = optionalString(args, "interval", "1d");
      const limit = optionalNumber(args, "limit", 7);
      const data = await api.getFundingStats(market, interval, String(limit));
      return JSON.stringify(data, null, 2);
    },
  },

  // ─── Per-address wallet analytics (v0.31.0+) ─────────────────────────
  //
  // The four tools below mirror Hyperliquid's `/info` user-scoped
  // surface (clearinghouseState, userFunding, userNonFundingLedgerUpdates)
  // plus one that HL itself doesn't precompute — user_maker_taker. Each
  // tool takes an `address` (0x-prefixed 20-byte hex) and returns a
  // JSON object the agent can reason over.
  {
    name: "get_user_state",
    title: "Wallet positions",
    description: "Open positions and unrealized PnL for a Hyperliquid wallet right now, across native and HIP-3 perps. Use it for questions like 'is this wallet long or short?'",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "0x-prefixed 20-byte hex address" },
      },
      required: ["address"],
    },
    handler: async (args, api) => {
      const address = requireString(args, "address");
      const data = await api.getUserState(address);
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_positions_at",
    title: "Wallet positions at a past time",
    description:
      "Exact perp positions one Hyperliquid wallet held at a past moment, up to 90 days back: market, side, signed size, mark price and notional at that moment, plus today's size and how many fills it made since. Built from Hyperliquid's live positions minus the wallet's fills after that moment, so sizes are exact across native and HIP-3 perps. Needs a free API key; how far back you can go follows the key's history window. Use it for questions like 'what was this wallet holding before the crash'. For positions right now use get_user_state; for trades in between use get_fills.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "0x-prefixed 20-byte hex address" },
        at: { type: "string", description: "The past moment: ISO 8601 (2026-11-01T12:00:00Z), unix seconds or unix milliseconds" },
      },
      required: ["address", "at"],
    },
    handler: async (args, api) => {
      const address = requireString(args, "address");
      const at = requireString(args, "at");
      const data = await api.getPositionsAt(address, at);
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_user_funding",
    title: "Wallet funding payments",
    description: "Funding a Hyperliquid wallet paid or received, per market per bucket: Hyperliquid's own ledger, every hourly payment back to September 2025 (Hyperliquid's API returns only daily totals that far back). Positive means received, negative means paid. bucket=1d gives daily totals, 1h the hourly payments.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "0x-prefixed 20-byte hex address" },
        market: { type: "string", description: MARKET_FILTER },
        from: { type: "string", description: time("start") },
        to: { type: "string", description: time("end") },
        bucket: { type: "string", enum: ["1h", "1d", "raw"], description: "Aggregation bucket; default 1d" },
        limit: { type: "number", description: `Most recent rows to return (default ${DEFAULT_FUNDING_ROWS})` },
      },
      required: ["address"],
    },
    handler: async (args, api) => {
      const address = requireString(args, "address");
      const market = optionalString(args, "market", "");
      const from = optionalTime(args, "from");
      const to = optionalTime(args, "to");
      const bucket = optionalString(args, "bucket", "1d");
      const data = (await api.getUserFunding(address, market, from, to, bucket)) as { data?: Record<string, unknown>[] };
      return JSON.stringify(shapeUserFunding(data, optionalNumber(args, "limit", DEFAULT_FUNDING_ROWS)));
    },
  },
  {
    name: "get_user_maker_taker",
    title: "Wallet maker/taker split",
    description: "Maker vs taker breakdown of a Hyperliquid wallet's fills per market: volume, fees and rebates. A high maker share with negative maker fees marks a market maker.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "0x-prefixed 20-byte hex address" },
        market: { type: "string", description: MARKET_FILTER },
        from: { type: "string", description: time("start") },
        to: { type: "string", description: time("end") },
      },
      required: ["address"],
    },
    handler: async (args, api) => {
      const address = requireString(args, "address");
      const market = optionalString(args, "market", "");
      const from = optionalTime(args, "from");
      const to = optionalTime(args, "to");
      const data = await api.getUserMakerTaker(address, market, from, to);
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_user_ledger",
    title: "Wallet ledger",
    description: "Vault deposits, withdrawals and transfers for a Hyperliquid wallet, including account deposits and withdrawals and transfers the wallet received. Positive amounts go into the account.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "0x-prefixed 20-byte hex address" },
        from: { type: "string", description: time("start") },
        to: { type: "string", description: time("end") },
        event_types: { type: "string", description: "Comma-separated type filter (deposit,withdrawal,vault_deposit,vault_withdraw,vault_transfer_in,vault_transfer_out)" },
        limit: { type: "number", description: "Max entries, default 1000, cap 10000" },
      },
      required: ["address"],
    },
    handler: async (args, api) => {
      const address = requireString(args, "address");
      const from = optionalTime(args, "from");
      const to = optionalTime(args, "to");
      const eventTypes = optionalString(args, "event_types", "");
      const limit = optionalNumber(args, "limit", 1000);
      const data = await api.getUserLedger(address, from, to, eventTypes, limit);
      return JSON.stringify(data, null, 2);
    },
  },

  // ─── Cross-wallet ranking (v0.34+) ─────────────────────────────────────

  {
    name: "get_pnl_leaderboard",
    title: "PnL leaderboard",
    description:
      "Every Hyperliquid wallet ranked by realized PnL, biggest losses or volume over a window. Wallets with fewer than 5 fills in the window are left out.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: time("start", "Default 30 days ago") },
        to: { type: "string", description: time("end", "Default now") },
        limit: { type: "number", description: "Number of rows, max 200, default 50" },
        sort_by: {
          type: "string",
          description: "Ranking metric",
          enum: ["realized_pnl", "loss", "volume"],
        },
      },
      required: [],
    },
    handler: async (args, api) => {
      const from = optionalTime(args, "from");
      const to = optionalTime(args, "to");
      const limit = optionalNumber(args, "limit", 50);
      const sortBy = optionalString(args, "sort_by", "realized_pnl");
      const data = await api.getPnLLeaderboard(from, to, limit, sortBy);
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_market_top_wallets",
    title: "Top wallets in a market",
    description:
      "Top wallets on one Hyperliquid market by volume or realized PnL, up to 200 rows.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: MARKET },
        from: { type: "string", description: time("start", "Default 24 hours ago") },
        to: { type: "string", description: time("end", "Default now") },
        limit: { type: "number", description: "Number of rows, max 200, default 25" },
        sort_by: {
          type: "string",
          description: "Ranking metric",
          enum: ["volume", "realized_pnl"],
        },
      },
      required: ["market"],
    },
    handler: async (args, api) => {
      const market = requireString(args, "market");
      const from = optionalTime(args, "from");
      const to = optionalTime(args, "to");
      const limit = optionalNumber(args, "limit", 25);
      const sortBy = optionalString(args, "sort_by", "volume");
      const data = await api.getMarketTopWallets(market, from, to, limit, sortBy);
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_markets_snapshot",
    title: "Markets snapshot",
    description:
      "Active Hyperliquid markets ranked in one call: mark price, 24h change, 24h volume, open interest and current hourly funding. Sort by abs_funding for the most extreme funding, abs_change_24h for the biggest movers, or volume (default). Use min_volume_usd to skip illiquid markets. Returns the top 25 unless limit is set.",
    inputSchema: {
      type: "object",
      properties: {
        market_class: {
          type: "string",
          description: "Filter to one class",
          enum: ["perp", "spot", "prediction", "option"],
        },
        issuer: {
          type: "string",
          description: "HIP-3 builder code (e.g. 'xyz'). Omit to include every issuer.",
        },
        sort_by: {
          type: "string",
          description: "Ranking key (default volume). funding_rate is hourly; positive means longs pay shorts.",
          enum: [...SORT_KEYS],
        },
        order: { type: "string", description: "desc (default) or asc", enum: ["desc", "asc"] },
        limit: { type: "number", description: `Rows to return (1-${MAX_LIMIT}, default 25)` },
        min_volume_usd: { type: "number", description: "Skip markets with less 24h volume than this (USD)" },
      },
      required: [],
    },
    handler: async (args, api) => {
      const marketClass = optionalString(args, "market_class", "");
      const issuer = optionalString(args, "issuer", "");
      const resp = (await api.getMarketsSnapshot(marketClass, issuer)) as { data?: Record<string, unknown>[] };
      const ranked = rankSnapshot(resp.data ?? [], {
        sortBy: optionalString(args, "sort_by", "volume") as SortKey,
        order: optionalString(args, "order", "desc") === "asc" ? "asc" : "desc",
        limit: optionalNumber(args, "limit", 25),
        minVolumeUsd: args.min_volume_usd === undefined ? 0 : Number(args.min_volume_usd),
      });
      return JSON.stringify(ranked);
    },
  },
  {
    name: "get_user_summary",
    title: "Wallet summary",
    description:
      "Totals for one Hyperliquid wallet over a time range (default the last 24 hours): fill count, volume in USD, realized PnL, fees, wins, losses, win rate and maker versus taker share, plus its current account state (open positions and margin). Use it for questions like 'how much did this wallet trade or make this week'. For a scored record with profit factor, drawdown and a per-market breakdown use get_trader_profile; for PnL over time use get_user_pnl_series.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "0x-prefixed 20-byte hex address" },
        from: { type: "string", description: time("start", "Default 24 hours ago") },
        to: { type: "string", description: time("end", "Default now") },
      },
      required: ["address"],
    },
    handler: async (args, api) => {
      const address = requireString(args, "address");
      const from = optionalTime(args, "from");
      const to = optionalTime(args, "to");
      const data = await api.getUserSummary(address, from, to);
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_wallet_labels",
    title: "Wallet labels",
    description:
      "Labels for notable Hyperliquid wallets: top whales by 24h volume, top traders by 30-day realized PnL, vaults and vault leaders. Pass addresses to check specific wallets; without them it lists the whales and smart money.",
    inputSchema: {
      type: "object",
      properties: {
        addresses: { type: "string", description: "Comma-separated wallet addresses to look up" },
        whale_top_n: { type: "number", description: "Top N whales to include (max 500, default 100)" },
        smart_top_n: { type: "number", description: "Top N smart-money wallets to include (max 500, default 100)" },
      },
      required: [],
    },
    handler: async (args, api) => {
      const whaleN = optionalNumber(args, "whale_top_n", 100);
      const smartN = optionalNumber(args, "smart_top_n", 100);
      const addresses = optionalString(args, "addresses", "")
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      const data = (await api.getWalletLabels(whaleN, smartN)) as Parameters<typeof shapeWalletLabels>[0];
      return JSON.stringify(shapeWalletLabels(data, { addresses: addresses.length ? addresses : undefined }));
    },
  },
  {
    name: "get_user_pnl_series",
    title: "Wallet PnL curve",
    description:
      "Realized PnL of one Hyperliquid wallet over time: buckets with realized PnL and fees paid in each, by default daily over the last 30 days. Add the buckets up for a running PnL curve. Realized only: unrealized PnL on open positions is in get_user_state. For totals over a range use get_user_summary.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "0x-prefixed 20-byte hex address" },
        from: { type: "string", description: time("start", "Default 30 days ago") },
        to: { type: "string", description: time("end", "Default now") },
        bucket_ms: { type: "number", description: "Bucket size in milliseconds: 3600000 for hourly, 86400000 for daily (default)" },
      },
      required: ["address"],
    },
    handler: async (args, api) => {
      const address = requireString(args, "address");
      const from = optionalTime(args, "from");
      const to = optionalTime(args, "to");
      const bucketMs = optionalNumber(args, "bucket_ms", 0);
      const data = await api.getUserPnLSeries(address, from, to, bucketMs);
      return JSON.stringify(data, null, 2);
    },
  },




  // ─── Signals (public endpoints: 60 requests per minute per IP, no key) ──

  {
    name: "get_top_traders",
    title: "Top traders",
    description:
      "Hyperliquid traders ranked across all markets by results over 7, 30 or 90 days: win rate, profit factor, realized PnL, max drawdown and best markets. sort=top ranks by realized PnL, lowrisk by smallest max drawdown, new by most recently first seen.",
    inputSchema: {
      type: "object",
      properties: {
        window: { type: "string", description: "Lookback window. Default 30d", enum: ["7d", "30d", "90d"] },
        sort: { type: "string", description: "Ranking. Default top", enum: ["top", "lowrisk", "new"] },
        limit: { type: "number", description: "Number of traders (1-50, default 20)" },
      },
      required: [],
    },
    handler: async (args, api) => {
      const data = await api.get("/v1/copy-feed", {
        window: optionalString(args, "window", "30d"),
        sort: optionalString(args, "sort", "top"),
        limit: String(optionalNumber(args, "limit", 20)),
      });
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_market_leaders",
    title: "Market leaders",
    description:
      "The best traders on one Hyperliquid market, ranked by profit factor then win rate, among wallets with at least 5 closed trades there.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: MARKET },
        window: { type: "string", description: "Lookback window. Default 30d", enum: ["7d", "30d", "90d"] },
        limit: { type: "number", description: "Number of traders (1-50, default 20)" },
      },
      required: ["market"],
    },
    handler: async (args, api) => {
      const data = await api.get("/v1/asset-leaders", {
        market: requireString(args, "market"),
        window: optionalString(args, "window", "30d"),
        limit: String(optionalNumber(args, "limit", 20)),
      });
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_early_movers",
    title: "Early movers",
    description:
      "Wallets whose large orders (at least $10k) on one Hyperliquid market tended to come before price moved their way within 30 minutes, over the last 7 or 30 days. Per wallet: the number of scored orders, their total notional, a lead score (notional-weighted average 30-minute move in the order's direction, in basis points), a hit rate (share of orders followed by a move their way), the last order time and the share of its large orders cancelled without a fill. Needs at least 5 scored orders per wallet; the response states the formulas. Use it to find wallets worth watching on one market, then check them with get_trader_profile or get_user_state. Past activity does not predict future results.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: MARKET },
        window: { type: "string", description: "Lookback window. Default 30d", enum: ["7d", "30d"] },
        limit: { type: "number", description: "Number of wallets (1-25, default 10)" },
      },
      required: ["market"],
    },
    handler: async (args, api) => {
      const data = await api.get("/v1/whale-signals", {
        market: requireString(args, "market"),
        window: optionalString(args, "window", "30d"),
        limit: String(optionalNumber(args, "limit", 10)),
      });
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_trader_profile",
    title: "Trader profile",
    description:
      "How good and how risky one Hyperliquid trader is over 7, 30 or 90 days, rebuilt from its fills: overall win rate, profit factor, trade count, realized PnL and max drawdown; the same numbers per market; its liquidations; and its trades from open to close with direction, timing and peak size. Use it to vet a wallet before following it. For plain totals over any time range use get_user_summary; for positions open right now use get_user_state; for style labels such as market_maker use get_wallet_behavior. A 90d window on a very active wallet can take several seconds.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "0x-prefixed 20-byte hex address" },
        window: { type: "string", description: "Lookback window. Default 30d", enum: ["7d", "30d", "90d"] },
      },
      required: ["address"],
    },
    handler: async (args, api) => {
      const data = await api.get("/v1/trader-activity", {
        address: requireString(args, "address"),
        window: optionalString(args, "window", "30d"),
      });
      return JSON.stringify(data, null, 2);
    },
  },
  // ─── Cohorts ─────────────────────────────────────────────────────────

  {
    name: "list_cohorts",
    title: "List cohorts",
    description: "List available address cohorts: six predefined groups (top_pnl_30d, high_volume_30d, whale_fills, net_withdrawers_7d, liquidation_prone, vault_whales) plus any custom cohorts the caller has created",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: async (_args, api) => {
      const data = await api.listCohorts();
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_cohort_addresses",
    title: "Cohort addresses",
    description:
      "Wallet addresses in one named cohort: up to 100, each with the value the cohort ranks by (realized PnL in USD for top_pnl_30d, volume in USD for high_volume_30d), and fetched_at, when the cohort was last computed. Call list_cohorts first for the names and what each one selects. Feed the addresses to get_user_summary, get_trader_profile or get_wallet_behavior to look at each wallet.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Cohort name from list_cohorts: top_pnl_30d, high_volume_30d, whale_fills, net_withdrawers_7d, liquidation_prone, vault_whales, or a custom cohort you created" },
      },
      required: ["name"],
    },
    handler: async (args, api) => {
      const name = requireString(args, "name");
      const data = await api.getCohortAddresses(name);
      return JSON.stringify(data, null, 2);
    },
  },

  // ─── Account & Status ────────────────────────────────────────────────

  {
    name: "get_status",
    title: "API status",
    description: "Ironflow service status right now: overall state, data freshness per venue and component health.",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: async (_args, api) => {
      const data = await api.getStatus();
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_status_metrics",
    title: "API performance metrics",
    description: "Ironflow performance over rolling windows: API latency and error rate, ingestion lag and synthetic probe timings.",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: async (_args, api) => {
      const data = await api.getStatusMetrics();
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_status_history",
    title: "API uptime history",
    description:
      "Ironflow's own uptime over the last 24 hours (default) or 7 days: points over the period, each with the service status and how fresh the data was in seconds, plus the overall uptime percent. Use it to check whether a gap or odd value in other results came from an Ironflow outage. For the status right now use get_status; for API latency and error rates use get_status_metrics.",
    inputSchema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          description: "Lookback window. '24h' (default) or '7d'.",
          enum: ["24h", "7d"],
        },
      },
      required: [],
    },
    handler: async (args, api) => {
      const period = optionalString(args, "period", "");
      const data = await api.getStatusHistory(period);
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "list_markets",
    title: "List markets",
    description:
      "Find how a Hyperliquid market is named: perps (native and HIP-3), spot and live HIP-4 outcomes, with symbol, class, issuer, base asset and Hyperliquid coin. Search with q (q=nvda finds xyz:NVDA-PERP and the other NVDA perps). Pages of up to 100 rows; pass pagination.next_cursor as cursor for the next page.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Case-insensitive search over symbol, base asset, Hyperliquid coin and issuer" },
        market_class: {
          type: "string",
          description: "Only this class. 'prediction' is HIP-4 outcomes. Omit for all.",
          enum: ["perp", "spot", "prediction", "option"],
        },
        issuer: {
          type: "string",
          description: "HIP-3 issuer code (e.g. 'xyz'). '' returns native markets only. Omit for every issuer.",
        },
        include_inactive: {
          type: "boolean",
          description: "Also return closed markets (delisted, settled HIP-4 outcomes), which carry active_to_ms. Default false.",
        },
        limit: { type: "number", description: `Rows per page (default ${DEFAULT_MARKETS_LIMIT}, max ${MAX_MARKETS_LIMIT})` },
        cursor: { type: "string", description: "pagination.next_cursor from the previous page, with the same filters" },
        source: { type: "string", description: "Venue. Default 'hyperliquid'." },
      },
      required: [],
    },
    handler: async (args, api) => {
      // Tri-state: present-with-empty-string means "native only".
      const issuer = Object.prototype.hasOwnProperty.call(args, "issuer") ? optionalString(args, "issuer", "") : undefined;
      // search was this tool's name for q before 0.11.0; still accepted.
      const q = optionalString(args, "q", "").trim() || optionalString(args, "search", "").trim();
      const limit = Math.min(optionalNumber(args, "limit", DEFAULT_MARKETS_LIMIT), MAX_MARKETS_LIMIT);
      const data = (await api.listMarkets({
        source: optionalString(args, "source", ""),
        marketClass: optionalString(args, "market_class", ""),
        issuer,
        q,
        includeInactive: optionalBoolean(args, "include_inactive"),
        limit,
        cursor: optionalString(args, "cursor", "").trim(),
      })) as Parameters<typeof shapeMarkets>[0];
      return JSON.stringify(shapeMarkets(data, { search: q, limit }));
    },
  },
];

// A toolset picks the tools a server serves. "data" leaves out the Ironbox
// tools, which run an agent that trades, for directory listings that take
// data tools only (mcp.ironflow.sh/mcp?toolset=data).
export type Toolset = "all" | "data";

export const IRONBOX_TOOLS = [
  "create_ironbox", "list_ironboxes", "get_ironbox", "delete_ironbox",
  "start_box_strategy", "list_box_strategies", "stop_box_strategy", "get_box_activity",
];

export function toolsFor(toolset: Toolset = "all"): ToolDef[] {
  return toolset === "data" ? tools.filter((t) => !IRONBOX_TOOLS.includes(t.name)) : tools;
}
