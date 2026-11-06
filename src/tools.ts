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
import { DEFAULT_FUNDING_ROWS, DEFAULT_MARKETS_LIMIT, MAX_MARKETS_LIMIT, shapeMarkets, shapeUserFunding, shapeWalletLabels } from "./shape.js";

// Tool definition type (used for listing and calling). title is the short
// human name clients show (and the Claude directory requires).
export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
  handler: (args: Record<string, unknown>, api: IronflowAPI) => Promise<string>;
  // What the tool does beyond reading, for the MCP annotations. Omitted: the
  // tool only reads.
  annotations?: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean };
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

function optionalString(args: Record<string, unknown>, key: string, defaultVal: string): string {
  const val = args[key];
  if (val === undefined || val === null) return defaultVal;
  if (typeof val !== "string") {
    throw new Error(`"${key}" must be a string`);
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

const MARKET = "Market: BTC-PERP, xyz:NVDA-PERP, HYPE/USDC, or a Hyperliquid name (BTC, @107, xyz:NVDA)";
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
      "Hyperliquid HIP-4 outcome markets (prediction markets on sports, central bank decisions, IPOs and daily BTC price contracts) over the last 4 hours, 1 day or 1 week: total volume, fills, wallets and active markets, plus the most traded outcomes with their last price (the implied probability, 0 to 1) and last-24-hour volume. Each outcome has a Yes and a No side whose prices sum to 1. For one outcome's trades or candles pass its symbol to get_recent_trades or get_candles; settled outcomes stay queryable. For per-wallet outcome activity use run_query on hl.wallet_daily with market_class = 'prediction'.",
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
      const markets = Array.isArray(data.active_markets) ? (data.active_markets as Record<string, unknown>[]) : [];
      const top = [...markets]
        .sort((a, b) => Number(b.notional_24h ?? 0) - Number(a.notional_24h ?? 0))
        .slice(0, limit);
      return JSON.stringify(
        {
          window_hours: data.window_hours,
          notional_total: data.notional_total,
          fills_total: data.fills_total,
          wallets_total: data.wallets_total,
          markets_active: data.markets_active,
          computed_at: data.computed_at,
          top_markets: top,
        },
        null,
        2,
      );
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
      "Have Ironflow post Hyperliquid liquidations to the user's Discord channel, Slack channel, Telegram chat or HTTPS webhook as they happen (within seconds), filtered by market, side, size and wallet. It keeps running after the conversation: use it when the user wants to be told about liquidations, not just to see them now. Needs an API key (free key: 1 alert; Explorer 5; Builder 20). Give url (a Discord channel webhook from channel settings, Integrations, Webhooks, Copy Webhook URL; a Slack incoming webhook; or any public https URL) or telegram_chat (then tell the user to add the bot named in the result's setup to that chat). A plain webhook gets signed JSON, and its signing_secret appears only in this result, so pass it on. Then call test_liquidation_alert to check that it arrives.",
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
      "The Hyperliquid liquidation alerts on this API key's account: where each posts (host only), its filter, whether it is active, failed deliveries in a row with the last error, liquidations sent so far, and how many alerts the tier allows. An alert is disabled after 20 failed deliveries in a row; test_liquidation_alert re-enables it once the destination works again.",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: async (_args, api) => JSON.stringify(await api.get("/v1/alerts"), null, 2),
  },
  {
    name: "test_liquidation_alert",
    title: "Test liquidation alert",
    description:
      "Send a sample Hyperliquid liquidation, marked as a test, to an alert's destination now and report whether it arrived (delivered true or false, with the destination's answer). A delivered test switches a disabled alert back on. One test per alert every 10 seconds.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Alert id from create_liquidation_alert or list_liquidation_alerts" } },
      required: ["id"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    handler: async (args, api) => {
      const id = alertId(args);
      return JSON.stringify(await api.post(`/v1/alerts/${id}/test`, {}), null, 2);
    },
  },
  {
    name: "delete_liquidation_alert",
    title: "Delete liquidation alert",
    description: "Stop and remove one Hyperliquid liquidation alert from this API key's account; nothing more is sent to its destination.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Alert id from list_liquidation_alerts" } },
      required: ["id"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    handler: async (args, api) => {
      const id = alertId(args);
      await api.del(`/v1/alerts/${id}`);
      return JSON.stringify({ deleted: true, id });
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
        bucket_size: { type: "string", description: "Price bucket width: auto (default, about 0.25% of price, right for any coin) or a fixed 1, 5, 10, 50, 100, 500, 1000 or 5000" },
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
        bucket_size: { type: "string", description: "Price range width: auto (default, about 0.25% of price) or a number in the market's price units" },
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
    description: "Vault deposits, withdrawals and transfers for a Hyperliquid wallet. Positive amounts go into the account. Account deposits and withdrawals are recorded only up to 2026-06-06.",
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
