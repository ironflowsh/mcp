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
    description: "Get the latest mid-market price for a perpetual futures market on Hyperliquid",
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
    description: "Get recent tick-level trades for a market including price, size, side, and timestamp",
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
    description: "Get OHLCV candlestick data for a market. Useful for price analysis and charting",
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
    description: "Get funding rate history for a perpetual futures market. Rates are paid hourly on Hyperliquid",
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
    description: "Get the current open interest and 24h trading volume for a perpetual futures market",
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
    description: "Get recent liquidation events for a market showing forced position closures with price, size, and address",
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
    description: "Get trade fills for a specific wallet address, optionally filtered by market",
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
    description: "Get the current mark price, oracle price, and funding rate for a market",
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
    description: "Get vault deposit and withdrawal events, filterable by vault address or user address",
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

  // ─── Analytics (Builder+ tier) ───────────────────────────────────────

  {
    name: "get_net_flows",
    description: "Get net deposit/withdrawal flows over time — shows capital inflows and outflows (Builder+ tier)",
    inputSchema: {
      type: "object",
      properties: {
        interval: { type: "string", description: "Time interval (1h, 4h, 8h, 1d, 7d). Default: 1d", enum: ["1h", "4h", "8h", "1d", "7d"] },
        limit: { type: "number", description: "Number of data points (default 7)" },
      },
      required: [],
    },
    handler: async (args, api) => {
      const interval = optionalString(args, "interval", "1d");
      const limit = optionalNumber(args, "limit", 7);
      const data = await api.getNetFlows(interval, String(limit));
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_liquidation_levels",
    description: "Get liquidations bucketed by price level — useful for heatmap visualization (Builder+ tier)",
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
    name: "get_order_flow",
    description: "Get fill and cancel rates per market — shows execution quality (Builder+ tier)",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: "Optional market filter" },
      },
      required: [],
    },
    handler: async (args, api) => {
      const market = optionalString(args, "market", "");
      const data = await api.getOrderFlow(market);
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_vault_leaderboard",
    description: "Get vaults ranked by net deposits — shows which vaults are attracting capital (Builder+ tier)",
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
    description: "Get funding rate statistics over time including annualized rates (Builder+ tier)",
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
    description: "Get an address's current open perp positions + unrealized P&L. Mirrors HL clearinghouseState — best tool for 'is this wallet long or short right now?' or 'what's their P&L?' questions.",
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
    description: "Get funding payments per market per bucket for an address. Sign convention: positive = received, negative = paid. Use bucket=1d for daily roll-up, 1h for raw HL funding intervals.",
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
    description: "Get an address's maker vs taker fill breakdown per market over a time window. The single most diagnostic endpoint for market-maker analysis — no commercial provider exposes this precomputed. High maker share with negative maker_fee = classic MM (rebate income); high taker share = liquidity taker. Caveat: fills before 2026-05-21 default to maker until S3 backfill.",
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
    description: "Get non-fill ledger events for an address: deposits, withdrawals, vault operations. Sign convention on amount: positive = into account, negative = out. Phase b will add rewardsClaim (airdrops), spotTransfer, delegate/undelegate (HYPE staking).",
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
      "Global Smart Money leaderboard — every HL wallet ranked by realized PnL, biggest losses, or volume over a chosen window. Replaces HL's 10-cap 'tracked addresses' with the full active universe. Sort by 'realized_pnl' (top winners), 'loss' (biggest losers), or 'volume'. Wallets with <5 fills in window are excluded.",
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
      "Top wallets ranked for one specific market. HL's public info API caps tracked addresses at 10; this returns up to 200. Sort by 'volume' or 'realized_pnl'.",
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
      "Anchored snapshot of every active market in one round-trip. Each row carries current mark, 24h-ago mark, 24h change %, latest open interest (USD and base), and latest funding. Replaces N×3 fan-out (candles + OI + funding per row). Filter by market_class or issuer.",
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
      "Aggregate stats for one address over a window — single ClickHouse aggregation. Returns volume, realized PnL, fill count, win rate, maker mix, markets touched. Fast-path replacement for the multi-call wallet X-Ray fan-out.",
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
      "Precomputed wallet label catalog. Returns a map of address → label list covering top whales by 24h volume, top smart money by 30d realized PnL, every distinct vault address, and every vault leader (modal commission recipient). Edge-cached 5 min — fetch once and look up addresses locally.",
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
      "Bucketed realized-PnL time series for one address. Each point is the sum of realized_pnl in a bucket_ms window. Server clamps bucket_ms so the series has ≤500 buckets.",
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
      "List active markets from the registry. Filter by source (venue), market_class (perp|spot|prediction), or issuer (HIP-3 builder code; pass empty string '' for native non-builder markets only). HIP-4 outcome contracts (live on Hyperliquid mainnet since 2026-05-02) use market_class='prediction' and display symbols like '#0-OUTCOME' / '#1-OUTCOME' — complementary outcomes of one binary market have prices summing to 1.0.",
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
