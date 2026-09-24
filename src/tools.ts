// MCP tool definitions for Ironflow market data.

import { IronflowAPI } from "./api.js";

// Tool definition type (used for listing and calling).
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
  handler: (args: Record<string, unknown>, api: IronflowAPI) => Promise<string>;
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

// ─── Tools ──────────────────────────────────────────────────────────────────

export const tools: ToolDef[] = [
  {
    name: "get_price",
    description: "Latest mark price of a Hyperliquid market: native perps, HIP-3 builder perps (e.g. xyz:NVDA-PERP) and spot.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: 'Market symbol — native HL perp (e.g. "BTC-PERP", "ETH-PERP") or HIP-3 builder market namespaced as "<issuer>:<base>-PERP" (e.g. "flx:GAS-PERP", "xyz:NVDA-PERP")' },
      },
      required: ["market"],
    },
    handler: async (args, api) => {
      const market = requireString(args, "market");
      const price = await api.getPrice(market);
      return `${market}: $${price}`;
    },
  },
  {
    name: "get_recent_trades",
    description: "Latest tick-level trades on a Hyperliquid market from our own nodes: price, size, side and block time. Covers native perps, HIP-3 builder markets, HIP-4 outcomes and spot.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: 'Market symbol — native HL perp (e.g. "BTC-PERP", "ETH-PERP") or HIP-3 builder market namespaced as "<issuer>:<base>-PERP" (e.g. "flx:GAS-PERP", "xyz:NVDA-PERP")' },
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
    description: "OHLCV candles for a Hyperliquid market, computed from tick-level trades.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: 'Market symbol — native HL perp (e.g. "BTC-PERP", "ETH-PERP") or HIP-3 builder market namespaced as "<issuer>:<base>-PERP" (e.g. "flx:GAS-PERP", "xyz:NVDA-PERP")' },
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
    description: "Hourly funding rate history for a Hyperliquid perp, including HIP-3 builder perps. A positive rate means longs pay shorts.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: 'Market symbol — native HL perp (e.g. "BTC-PERP", "ETH-PERP") or HIP-3 builder market namespaced as "<issuer>:<base>-PERP" (e.g. "flx:GAS-PERP", "xyz:NVDA-PERP")' },
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
    description: "Latest open interest for a Hyperliquid perp.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: 'Market symbol — native HL perp (e.g. "BTC-PERP", "ETH-PERP") or HIP-3 builder market namespaced as "<issuer>:<base>-PERP" (e.g. "flx:GAS-PERP", "xyz:NVDA-PERP")' },
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
    name: "get_liquidations",
    description: "Liquidations on a Hyperliquid perp, read from our own nodes: price, size, side and the liquidated wallet. Hyperliquid's public API has no liquidation feed.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: 'Market symbol — native HL perp (e.g. "BTC-PERP", "ETH-PERP") or HIP-3 builder market namespaced as "<issuer>:<base>-PERP" (e.g. "flx:GAS-PERP", "xyz:NVDA-PERP")' },
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

  // ─── Additional Market Data ──────────────────────────────────────────

  {
    name: "get_fills",
    description: "Every fill for one Hyperliquid wallet, optionally for one market, from indexed history: price, size, side, fee and realized PnL. Hyperliquid's own userFills endpoints stop at the 10,000 most recent fills.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Wallet address (e.g. 0x...)" },
        market: { type: "string", description: 'Optional market filter — native HL (e.g. "BTC-PERP") or HIP-3 builder market "<issuer>:<base>-PERP" (e.g. "flx:GAS-PERP")' },
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
    description: "Mark price and oracle price series for a Hyperliquid perp.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: 'Market symbol — native HL perp (e.g. "BTC-PERP") or HIP-3 builder market "<issuer>:<base>-PERP" (e.g. "flx:GAS-PERP")' },
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
    description: "Deposits into and withdrawals from Hyperliquid vaults. Pass a vault address, a depositor address, or both; one is required.",
    inputSchema: {
      type: "object",
      properties: {
        vault: { type: "string", description: "Vault address" },
        address: { type: "string", description: "User address" },
        limit: { type: "number", description: "Number of events (1-100, default 20)" },
      },
      required: [],
    },
    handler: async (args, api) => {
      const vault = optionalString(args, "vault", "");
      const address = optionalString(args, "address", "");
      const limit = optionalNumber(args, "limit", 20);
      const data = await api.getVaultOperations(vault, address, String(limit));
      return JSON.stringify(data, null, 2);
    },
  },

  // ─── Analytics ───────────────────────────────────────────────────────

  {
    name: "get_liquidation_levels",
    description: "Liquidated notional on a Hyperliquid perp bucketed by price: where longs and shorts were wiped out. Needs a Builder or Enterprise key; keyless and free-key calls return 403.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: 'Market symbol — native HL perp (e.g. "BTC-PERP") or HIP-3 builder market "<issuer>:<base>-PERP" (e.g. "flx:GAS-PERP")' },
        bucket_size: { type: "string", description: "Price bucket size (1, 5, 10, 50, 100, 500, 1000, 5000). Default: 100" },
      },
      required: ["market"],
    },
    handler: async (args, api) => {
      const market = requireString(args, "market");
      const bucket = optionalString(args, "bucket_size", "100");
      const data = await api.getLiquidationLevels(market, bucket);
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_vault_leaderboard",
    description: "Hyperliquid vaults ranked by net deposits. Needs a Builder or Enterprise key; keyless and free-key calls return 403.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of vaults (default 10)" },
      },
      required: [],
    },
    handler: async (args, api) => {
      const limit = optionalNumber(args, "limit", 10);
      const data = await api.getVaultLeaderboard(String(limit));
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_funding_stats",
    description: "Funding statistics per time bucket for a Hyperliquid perp: average, minimum, maximum and annualized rate.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: 'Market symbol — native HL perp (e.g. "BTC-PERP") or HIP-3 builder market "<issuer>:<base>-PERP" (e.g. "flx:GAS-PERP")' },
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
    name: "get_user_funding",
    description: "Funding a Hyperliquid wallet paid or received, per market per bucket. Positive means received, negative means paid. bucket=1d gives daily totals, 1h the raw hourly payments.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "0x-prefixed 20-byte hex address" },
        market: { type: "string", description: "Optional market filter (e.g. BTC-PERP)" },
        from: { type: "number", description: "Unix ms window start (inclusive)" },
        to: { type: "number", description: "Unix ms window end (exclusive)" },
        bucket: { type: "string", enum: ["1h", "1d", "raw"], description: "Aggregation bucket; default 1d" },
      },
      required: ["address"],
    },
    handler: async (args, api) => {
      const address = requireString(args, "address");
      const market = optionalString(args, "market", "");
      const from = optionalNumber(args, "from", 0);
      const to = optionalNumber(args, "to", 0);
      const bucket = optionalString(args, "bucket", "1d");
      const data = await api.getUserFunding(address, market, from, to, bucket);
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_user_maker_taker",
    description: "Maker vs taker breakdown of a Hyperliquid wallet's fills per market: volume, fees and rebates. A high maker share with negative maker fees marks a market maker.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "0x-prefixed 20-byte hex address" },
        market: { type: "string", description: "Optional market filter" },
        from: { type: "number", description: "Unix ms window start" },
        to: { type: "number", description: "Unix ms window end" },
      },
      required: ["address"],
    },
    handler: async (args, api) => {
      const address = requireString(args, "address");
      const market = optionalString(args, "market", "");
      const from = optionalNumber(args, "from", 0);
      const to = optionalNumber(args, "to", 0);
      const data = await api.getUserMakerTaker(address, market, from, to);
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_user_ledger",
    description: "Vault deposits, withdrawals and transfers for a Hyperliquid wallet. Positive amounts go into the account. Account deposits and withdrawals are recorded only up to 2026-06-06.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "0x-prefixed 20-byte hex address" },
        from: { type: "number", description: "Unix ms window start" },
        to: { type: "number", description: "Unix ms window end" },
        event_types: { type: "string", description: "Comma-separated type filter (deposit,withdrawal,vault_deposit,vault_withdraw,vault_transfer_in,vault_transfer_out)" },
        limit: { type: "number", description: "Max entries, default 1000, cap 10000" },
      },
      required: ["address"],
    },
    handler: async (args, api) => {
      const address = requireString(args, "address");
      const from = optionalNumber(args, "from", 0);
      const to = optionalNumber(args, "to", 0);
      const eventTypes = optionalString(args, "event_types", "");
      const limit = optionalNumber(args, "limit", 1000);
      const data = await api.getUserLedger(address, from, to, eventTypes, limit);
      return JSON.stringify(data, null, 2);
    },
  },

  // ─── Cross-wallet ranking (v0.34+) ─────────────────────────────────────

  {
    name: "get_pnl_leaderboard",
    description:
      "Every Hyperliquid wallet ranked by realized PnL, biggest losses or volume over a window. Wallets with fewer than 5 fills in the window are left out.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "number", description: "Unix ms window start (default 30d ago)" },
        to: { type: "number", description: "Unix ms window end (default now)" },
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
      const from = optionalNumber(args, "from", 0);
      const to = optionalNumber(args, "to", 0);
      const limit = optionalNumber(args, "limit", 50);
      const sortBy = optionalString(args, "sort_by", "realized_pnl");
      const data = await api.getPnLLeaderboard(from, to, limit, sortBy);
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_market_top_wallets",
    description:
      "Top wallets on one Hyperliquid market by volume or realized PnL, up to 200 rows.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: "Market symbol (e.g. 'BTC-PERP' or 'flx:GAS-PERP')" },
        from: { type: "number", description: "Unix ms window start (default 24h ago)" },
        to: { type: "number", description: "Unix ms window end (default now)" },
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
      const from = optionalNumber(args, "from", 0);
      const to = optionalNumber(args, "to", 0);
      const limit = optionalNumber(args, "limit", 25);
      const sortBy = optionalString(args, "sort_by", "volume");
      const data = await api.getMarketTopWallets(market, from, to, limit, sortBy);
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_markets_snapshot",
    description:
      "Every active Hyperliquid market in one call: mark price, 24h change, open interest and latest funding. Use it to scan for funding extremes or big movers. Filter by market_class or HIP-3 issuer.",
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
          description: "HIP-3 builder code (e.g. 'flx'). Omit to include every issuer.",
        },
      },
      required: [],
    },
    handler: async (args, api) => {
      const marketClass = optionalString(args, "market_class", "");
      const issuer = optionalString(args, "issuer", "");
      const data = await api.getMarketsSnapshot(marketClass, issuer);
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_user_summary",
    description:
      "One Hyperliquid wallet's stats over a window: volume, realized PnL, fill count, win rate, maker share and markets traded.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "0x-prefixed 20-byte hex address" },
        from: { type: "number", description: "Unix ms window start (default 24h ago)" },
        to: { type: "number", description: "Unix ms window end (default now)" },
      },
      required: ["address"],
    },
    handler: async (args, api) => {
      const address = requireString(args, "address");
      const from = optionalNumber(args, "from", 0);
      const to = optionalNumber(args, "to", 0);
      const data = await api.getUserSummary(address, from, to);
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_wallet_labels",
    description:
      "Labels for notable Hyperliquid wallets: top whales by 24h volume, top traders by 30-day realized PnL, vaults and vault leaders. Returns a map of address to labels; fetch once and look addresses up locally.",
    inputSchema: {
      type: "object",
      properties: {
        whale_top_n: { type: "number", description: "Top N whales to include (max 500, default 100)" },
        smart_top_n: { type: "number", description: "Top N smart-money wallets to include (max 500, default 100)" },
      },
      required: [],
    },
    handler: async (args, api) => {
      const whaleN = optionalNumber(args, "whale_top_n", 100);
      const smartN = optionalNumber(args, "smart_top_n", 100);
      const data = await api.getWalletLabels(whaleN, smartN);
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_user_pnl_series",
    description:
      "Realized PnL curve of a Hyperliquid wallet over time, bucketed (for example hourly or daily).",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "0x-prefixed 20-byte hex address" },
        from: { type: "number", description: "Unix ms window start" },
        to: { type: "number", description: "Unix ms window end (default now)" },
        bucket_ms: { type: "number", description: "Bucket size in ms (e.g. 3600000 for 1h)" },
      },
      required: ["address"],
    },
    handler: async (args, api) => {
      const address = requireString(args, "address");
      const from = optionalNumber(args, "from", 0);
      const to = optionalNumber(args, "to", 0);
      const bucketMs = optionalNumber(args, "bucket_ms", 0);
      const data = await api.getUserPnLSeries(address, from, to, bucketMs);
      return JSON.stringify(data, null, 2);
    },
  },




  // ─── Signals (public endpoints: 60 requests per minute per IP, no key) ──

  {
    name: "get_top_traders",
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
    description:
      "The best traders on one Hyperliquid market, ranked by profit factor then win rate, among wallets with at least 5 closed trades there.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: 'Market symbol (e.g. "BTC-PERP", "xyz:NVDA-PERP")' },
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
    description:
      "Wallets whose large orders (at least $10k) on a Hyperliquid market were followed by a price move in their direction within 30 minutes. Returns a lead score in basis points and a hit rate per wallet. Past activity does not predict future results.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: 'Market symbol (e.g. "BTC-PERP", "xyz:SKHX-PERP")' },
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
    description:
      "A Hyperliquid wallet's trading record over 7, 30 or 90 days: win rate, profit factor, realized PnL, max drawdown and its best markets.",
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
    description: "List available address cohorts: six predefined groups (top_pnl_30d, high_volume_30d, whale_fills, net_withdrawers_7d, liquidation_prone, vault_whales) plus any custom cohorts the caller has created",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: async (_args, api) => {
      const data = await api.listCohorts();
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_cohort_addresses",
    description: "Get the wallet addresses in a specific cohort",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Cohort name (e.g. top_pnl_30d, high_volume_30d, whale_fills, or a custom cohort name)" },
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
    description: "Get system status, data freshness, and venue health (unauthenticated)",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: async (_args, api) => {
      const data = await api.getStatus();
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_status_metrics",
    description: "Get rolling-window API + pipeline + synthetic performance metrics (unauthenticated)",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: async (_args, api) => {
      const data = await api.getStatusMetrics();
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_status_history",
    description:
      "Get an uptime / freshness timeline. period: '24h' (default) or '7d' (unauthenticated)",
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
    description:
      "Every active Hyperliquid market with its display symbol, class (perp, spot, prediction), HIP-3 issuer and base asset. Call it when unsure how a market is named.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "Venue. Defaults to 'hyperliquid'." },
        market_class: {
          type: "string",
          description: "Market class. Omit to return perp + spot + prediction. 'prediction' filters to HIP-4 outcome contracts.",
          enum: ["perp", "spot", "prediction", "option"],
        },
        issuer: {
          type: "string",
          description:
            "HIP-3 issuer code (e.g. 'flx'). Pass empty string '' to return only native non-builder markets. Omit to include every issuer.",
        },
      },
      required: [],
    },
    handler: async (args, api) => {
      const source = optionalString(args, "source", "");
      const market_class = optionalString(args, "market_class", "");
      // Tri-state: present-with-empty-string means "native only".
      const issuer =
        Object.prototype.hasOwnProperty.call(args, "issuer")
          ? optionalString(args, "issuer", "")
          : undefined;
      const data = await api.listMarkets(source, market_class, issuer);
      return JSON.stringify(data, null, 2);
    },
  },
];
