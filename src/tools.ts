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

// Maximum byte length we accept for a JSON string argument from the agent.
// Trigger rules and sample events are tiny (rarely > 1 KiB); 64 KiB is well
// above any legitimate payload while still bounding parse-time memory.
const MAX_JSON_ARG_BYTES = 64 * 1024;

// Maximum nesting depth for parsed JSON. Defends against pathological
// recursive structures the agent (or a malicious model output) might emit.
const MAX_JSON_DEPTH = 16;

/**
 * safeJSONParse parses a JSON string and refuses dangerous shapes:
 *
 *  - Strings larger than MAX_JSON_ARG_BYTES.
 *  - Any object key matching `__proto__`, `constructor`, or `prototype` —
 *    these would not enable prototype pollution against our own code (we
 *    don't deep-merge user input here) but they're a strong "this is an
 *    attack" signal worth refusing. Stripping them with a reviver yields
 *    an object that's safe to forward.
 *  - Nesting deeper than MAX_JSON_DEPTH.
 *
 * The result is a plain JSON value (object / array / primitive). Callers
 * still need to assert their domain shape before using the result.
 */
function safeJSONParse(input: string, label: string): unknown {
  if (input.length > MAX_JSON_ARG_BYTES) {
    throw new Error(`"${label}" exceeds ${MAX_JSON_ARG_BYTES} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input, (key, value) => {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        // Drop the key by returning undefined.
        return undefined;
      }
      return value;
    });
  } catch {
    throw new Error(`"${label}" is not valid JSON`);
  }
  enforceDepth(parsed, MAX_JSON_DEPTH, label);
  return parsed;
}

function enforceDepth(value: unknown, remaining: number, label: string): void {
  if (remaining < 0) {
    throw new Error(`"${label}" exceeds maximum nesting depth (${MAX_JSON_DEPTH})`);
  }
  if (Array.isArray(value)) {
    for (const v of value) enforceDepth(v, remaining - 1, label);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) enforceDepth(v, remaining - 1, label);
  }
}

/**
 * Light-touch validation for a trigger rule. The authoritative check lives
 * server-side; this just stops obviously malformed shapes from making the
 * round-trip and rejects payloads that could only be exploit attempts.
 */
function validateRule(rule: unknown): Record<string, unknown> {
  if (rule === null || typeof rule !== "object" || Array.isArray(rule)) {
    throw new Error('"rule" must be a JSON object');
  }
  return rule as Record<string, unknown>;
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
    name: "get_orderbook",
    description: "Get the current L2 order book snapshot for a market, showing bid and ask price levels",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: 'Market symbol — native HL perp (e.g. "BTC-PERP", "ETH-PERP") or HIP-3 builder market namespaced as "<issuer>:<base>-PERP" (e.g. "flx:GAS-PERP", "xyz:NVDA-PERP")' },
      },
      required: ["market"],
    },
    handler: async (args, api) => {
      const market = requireString(args, "market");
      const data = await api.getOrderbook(market);
      return JSON.stringify(data, null, 2);
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
    name: "get_deposits",
    description: "Get recent deposit events for a wallet address",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Wallet address (e.g. 0x...)" },
        limit: { type: "number", description: "Number of deposits (1-100, default 20)" },
      },
      required: ["address"],
    },
    handler: async (args, api) => {
      const address = requireString(args, "address");
      const limit = optionalNumber(args, "limit", 20);
      const data = await api.getDeposits(address, String(limit));
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_withdrawals",
    description: "Get recent withdrawal events for a wallet address",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Wallet address (e.g. 0x...)" },
        limit: { type: "number", description: "Number of withdrawals (1-100, default 20)" },
      },
      required: ["address"],
    },
    handler: async (args, api) => {
      const address = requireString(args, "address");
      const limit = optionalNumber(args, "limit", 20);
      const data = await api.getWithdrawals(address, String(limit));
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_order_statuses",
    description: "Get order status history for a wallet address (placed, filled, cancelled, triggered)",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Wallet address (e.g. 0x...)" },
        market: { type: "string", description: "Optional market filter" },
        limit: { type: "number", description: "Number of statuses (1-100, default 20)" },
      },
      required: ["address"],
    },
    handler: async (args, api) => {
      const address = requireString(args, "address");
      const market = optionalString(args, "market", "");
      const limit = optionalNumber(args, "limit", 20);
      const data = await api.getOrderStatuses(address, market, String(limit));
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

  // ─── Export ───────────────────────────────────────────────────────────

  {
    name: "export_data",
    description: "Export historical data as CSV (Builder+ tier). Returns the download URL or raw data for a given event type and time range",
    inputSchema: {
      type: "object",
      properties: {
        event_type: { type: "string", description: "Data type to export (trade, fill, book, liquidation, funding_rate, deposit, withdrawal, vault_operation, order_status, open_interest, mark_price)" },
        market: { type: "string", description: 'Optional market filter — native HL (e.g. "BTC-PERP") or HIP-3 builder market "<issuer>:<base>-PERP" (e.g. "flx:GAS-PERP")' },
        format: { type: "string", description: "Output format: csv or parquet. Default: csv", enum: ["csv", "parquet"] },
      },
      required: ["event_type"],
    },
    handler: async (args, api) => {
      const eventType = requireString(args, "event_type");
      const market = optionalString(args, "market", "");
      const format = optionalString(args, "format", "csv");
      const params: Record<string, string> = { event_type: eventType, format };
      if (market) params.market = market;
      const data = await api.get("/v1/export", params);
      return typeof data === "string" ? data : JSON.stringify(data, null, 2);
    },
  },

  // ─── Triggers ────────────────────────────────────────────────────────

  {
    name: "list_triggers",
    description: "List all webhook triggers configured for the authenticated user",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: async (_args, api) => {
      const data = await api.listTriggers();
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "create_trigger",
    description: "Create a rule-based webhook trigger that fires when market events match conditions (e.g. BTC price > 100000)",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Human-readable trigger name" },
        channel: { type: "string", description: "Event channel to monitor (trades, fills, liquidations, funding_rates, etc.)" },
        webhook_url: { type: "string", description: "HTTPS URL to receive webhook POST when trigger fires" },
        rule: { type: "string", description: 'Rule as JSON string, e.g. {"condition":{"field":"data.price","op":"gt","value":"100000"}}' },
      },
      required: ["name", "channel", "webhook_url", "rule"],
    },
    handler: async (args, api) => {
      const name = requireString(args, "name");
      const channel = requireString(args, "channel");
      const webhook_url = requireString(args, "webhook_url");
      // Reject anything that's not https:// — webhooks travel API key /
      // event payload data, and a plain http URL would leak it.
      if (!/^https:\/\//i.test(webhook_url)) {
        throw new Error('"webhook_url" must be an https:// URL');
      }
      const ruleStr = requireString(args, "rule");
      const rule = validateRule(safeJSONParse(ruleStr, "rule"));
      const data = await api.createTrigger({ name, channel, rule, webhook_url });
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "test_trigger",
    description: "Test a trigger rule against a sample event without creating it — dry run evaluation",
    inputSchema: {
      type: "object",
      properties: {
        rule: { type: "string", description: "Rule as JSON string" },
        event: { type: "string", description: "Sample event as JSON string to test against" },
      },
      required: ["rule", "event"],
    },
    handler: async (args, api) => {
      const rule = validateRule(safeJSONParse(requireString(args, "rule"), "rule"));
      const eventParsed = safeJSONParse(requireString(args, "event"), "event");
      if (eventParsed === null || typeof eventParsed !== "object" || Array.isArray(eventParsed)) {
        throw new Error('"event" must be a JSON object');
      }
      const data = await api.testTrigger({ rule, event: eventParsed as Record<string, unknown> });
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "toggle_trigger",
    description: "Enable or disable an existing webhook trigger by ID",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Trigger ID to toggle" },
        is_active: { type: "boolean", description: "true to enable, false to disable" },
      },
      required: ["id", "is_active"],
    },
    handler: async (args, api) => {
      const id = optionalNumber(args, "id", 0);
      if (id <= 0) throw new Error('"id" is required and must be a positive number');
      const isActiveRaw = args["is_active"];
      if (typeof isActiveRaw !== "boolean") throw new Error('"is_active" is required and must be a boolean');
      const data = await api.toggleTrigger(id, isActiveRaw);
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "delete_trigger",
    description: "Permanently delete a webhook trigger by ID",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Trigger ID to delete" },
      },
      required: ["id"],
    },
    handler: async (args, api) => {
      const id = optionalNumber(args, "id", 0);
      if (id <= 0) throw new Error('"id" is required and must be a positive number');
      await api.deleteTrigger(id);
      return `Trigger ${id} deleted`;
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
  {
    name: "delete_cohort",
    description: "Delete a custom cohort by name. Predefined cohorts (top_pnl_30d, high_volume_30d, etc.) cannot be deleted",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Custom cohort name to delete" },
      },
      required: ["name"],
    },
    handler: async (args, api) => {
      const name = requireString(args, "name");
      await api.deleteCohort(name);
      return `Cohort ${name} deleted`;
    },
  },

  // ─── Account & Status ────────────────────────────────────────────────

  {
    name: "get_me",
    description: "Get the authenticated user's tier (free, explorer, builder, enterprise) and rate limits",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: async (_args, api) => {
      const data = await api.getMe();
      return JSON.stringify(data, null, 2);
    },
  },
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
