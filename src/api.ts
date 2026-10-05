// Ironflow REST API client. Uses native fetch — no external HTTP dependencies.

import { sanitizeClientApp } from "./usage.js";

const DEFAULT_BASE_URL = "https://api.ironflow.sh";
const DEFAULT_SOURCE = "hyperliquid";

// CallContext names who is asking: the MCP client app (from the client's
// initialize, or the hosted request's User-Agent) and the tool being run. It
// rides along as X-Ironflow-Client and X-Ironflow-Tool so the API's usage log
// can tell apps and tools apart. Never used for access decisions.
export interface CallContext {
  client?: string;
  tool?: string;
}

const TOOL_PATTERN = /^[a-z0-9_]{1,48}$/;
const ERROR_CODE_PATTERN = /^[A-Z0-9_]{1,48}$/;

// UpstreamCall is what the hosted access log records about one API request:
// the HTTP status and, on failure, the API's error code. Never the URL, so
// no addresses or keys end up in the log.
export interface UpstreamCall {
  status: number;
  code?: string;
}

export class IronflowAPI {
  private baseUrl: string;
  private apiKey?: string;
  private source: string;
  private userAgent: string;
  private forwardedFor?: string;
  private context: CallContext = {};
  // Shared by every withContext copy, so the hosted server can read what
  // the tool calls of one request did upstream.
  private calls: UpstreamCall[] = [];

  // forwardedFor is set only by the hosted HTTP server: it passes the MCP
  // client's IP on so keyless rate limits apply per caller, not per server.
  constructor(
    baseUrl = DEFAULT_BASE_URL,
    apiKey?: string,
    source = DEFAULT_SOURCE,
    version = "unknown",
    forwardedFor?: string
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.source = source;
    this.userAgent = `ironflow-mcp/${version}`;
    this.forwardedFor = forwardedFor;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": this.userAgent,
    };
    if (this.apiKey) {
      h["Authorization"] = `Bearer ${this.apiKey}`;
    }
    if (this.forwardedFor) {
      h["X-Forwarded-For"] = this.forwardedFor;
    }
    const client = sanitizeClientApp(this.context.client);
    if (client) h["X-Ironflow-Client"] = client;
    if (this.context.tool && TOOL_PATTERN.test(this.context.tool)) {
      h["X-Ironflow-Tool"] = this.context.tool;
    }
    return h;
  }

  // hasKey reports whether requests carry an API key.
  hasKey(): boolean {
    return Boolean(this.apiKey);
  }

  // upstreamCalls returns the status (and error code) of every API request
  // made so far through this client or its withContext copies.
  upstreamCalls(): UpstreamCall[] {
    return [...this.calls];
  }

  private record(status: number, code?: string): void {
    this.calls.push(code && ERROR_CODE_PATTERN.test(code) ? { status, code } : { status });
  }

  // withContext returns a copy of this client that tags its requests with
  // the given caller context. A copy, so concurrent tool calls on a shared
  // stdio client never see each other's tool name.
  withContext(context: CallContext): IronflowAPI {
    const copy = Object.create(IronflowAPI.prototype) as IronflowAPI;
    Object.assign(copy, this);
    copy.context = { ...context };
    return copy;
  }

  private async apiError(res: Response): Promise<Error> {
    const text = await res.text();
    try {
      const parsed = JSON.parse(text) as {
        error?: { code?: string; message?: string };
      };
      const code = parsed.error?.code;
      const message = parsed.error?.message;
      this.record(res.status, code);
      if (code) {
        return new Error(`Ironflow API error ${res.status} ${code}: ${message ?? text}`);
      }
    } catch {
      // Non-JSON response — fall through to raw text.
      this.record(res.status);
    }
    return new Error(`Ironflow API error ${res.status}: ${text}`);
  }

  async get(
    path: string,
    params: Record<string, string> = {}
  ): Promise<unknown> {
    // Always include source.
    if (!params.source) {
      params.source = this.source;
    }

    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }

    const res = await fetch(url.toString(), { headers: this.headers() });

    if (!res.ok) {
      throw await this.apiError(res);
    }
    this.record(res.status);

    const ctype = res.headers.get("content-type") ?? "";
    if (ctype.includes("application/json")) {
      return res.json();
    }
    return res.text();
  }

  // post sends a JSON body and returns the parsed JSON response.
  async post(path: string, body: unknown): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw await this.apiError(res);
    }
    this.record(res.status);
    return res.json();
  }

  // ─── Convenience methods ──────────────────────────────────────────────

  async getPrice(market: string): Promise<string> {
    const resp = (await this.get("/v1/mark-prices", { market, limit: "1" })) as {
      data?: { mark_price?: string }[];
    };
    const price = resp.data?.[0]?.mark_price;
    if (!price) {
      throw new Error(`Market ${market} not found`);
    }
    return price;
  }

  async getRecentTrades(
    market: string,
    limit: string = "20"
  ): Promise<unknown> {
    return this.get("/v1/trades", { market, limit });
  }

  async getCandles(
    market: string,
    interval: string = "1h",
    limit: string = "24"
  ): Promise<unknown> {
    return this.get("/v1/candles", { market, interval, limit });
  }

  async getFundingRates(
    market: string,
    limit: string = "10"
  ): Promise<unknown> {
    return this.get("/v1/funding", { market, limit });
  }

  async getOpenInterest(market: string): Promise<unknown> {
    return this.get("/v1/open-interest", { market, limit: "1" });
  }

  async getLiquidations(
    market: string,
    limit: string = "20"
  ): Promise<unknown> {
    return this.get("/v1/liquidations", { market, limit });
  }

  async getFills(address: string, market: string = "", limit: string = "20"): Promise<unknown> {
    const params: Record<string, string> = { address, limit };
    if (market) params.market = market;
    return this.get("/v1/fills", params);
  }

  async getMarkPrices(market: string): Promise<unknown> {
    return this.get("/v1/mark-prices", { market, limit: "1" });
  }

  async getVaultOperations(vault: string = "", address: string = "", limit: string = "20"): Promise<unknown> {
    const params: Record<string, string> = { limit };
    if (vault) params.vault = vault;
    if (address) params.address = address;
    return this.get("/v1/vault-operations", params);
  }

  // ─── Analytics ────────────────────────────────────────────────────────

  async getLiquidationLevels(market: string, bucket_size: string = "100"): Promise<unknown> {
    return this.get("/v1/analytics/liquidation-levels", { market, bucket_size });
  }

  async getVaultLeaderboard(limit: string = "10"): Promise<unknown> {
    return this.get("/v1/analytics/vault-leaderboard", { limit });
  }

  async getFundingStats(market: string, interval: string = "1d", limit: string = "7"): Promise<unknown> {
    return this.get("/v1/analytics/funding-stats", { market, interval, limit });
  }

  // ─── Per-address wallet analytics (v0.31.0+) ──────────────────────────

  async getUserState(address: string): Promise<unknown> {
    return this.get("/v1/analytics/user-state", { address });
  }

  async getUserFunding(
    address: string,
    market: string = "",
    from: number = 0,
    to: number = 0,
    bucket: string = "1d",
  ): Promise<unknown> {
    const params: Record<string, string> = { address, bucket };
    if (market) params.market = market;
    if (from > 0) params.from = String(from);
    if (to > 0) params.to = String(to);
    return this.get("/v1/analytics/user-funding", params);
  }

  async getUserMakerTaker(
    address: string,
    market: string = "",
    from: number = 0,
    to: number = 0,
  ): Promise<unknown> {
    const params: Record<string, string> = { address };
    if (market) params.market = market;
    if (from > 0) params.from = String(from);
    if (to > 0) params.to = String(to);
    return this.get("/v1/analytics/user-maker-taker", params);
  }

  async getUserLedger(
    address: string,
    from: number = 0,
    to: number = 0,
    eventTypes: string = "",
    limit: number = 1000,
  ): Promise<unknown> {
    const params: Record<string, string> = { address, limit: String(limit) };
    if (from > 0) params.from = String(from);
    if (to > 0) params.to = String(to);
    if (eventTypes) params.event_types = eventTypes;
    return this.get("/v1/analytics/user-ledger", params);
  }

  // ─── Cross-wallet ranking (v0.34+) ───────────────────────────────────

  async getPnLLeaderboard(
    from: number = 0,
    to: number = 0,
    limit: number = 50,
    sortBy: string = "realized_pnl",
  ): Promise<unknown> {
    const params: Record<string, string> = {
      limit: String(limit),
      sort_by: sortBy,
    };
    if (from > 0) params.from = String(from);
    if (to > 0) params.to = String(to);
    return this.get("/v1/analytics/leaderboard-pnl", params);
  }

  async getMarketTopWallets(
    market: string,
    from: number = 0,
    to: number = 0,
    limit: number = 25,
    sortBy: string = "volume",
  ): Promise<unknown> {
    const params: Record<string, string> = {
      market,
      limit: String(limit),
      sort_by: sortBy,
    };
    if (from > 0) params.from = String(from);
    if (to > 0) params.to = String(to);
    return this.get("/v1/analytics/market-top-wallets", params);
  }

  async getMarketsSnapshot(
    marketClass: string = "",
    issuer: string = "",
  ): Promise<unknown> {
    const params: Record<string, string> = {};
    if (marketClass) params.market_class = marketClass;
    // The endpoint distinguishes "no filter" from "native-only" via
    // presence of the `issuer` key; we forward only when caller asked
    // for it explicitly (non-empty or the explicit empty-string
    // sentinel handled below).
    if (issuer) params.issuer = issuer;
    return this.get("/v1/markets/snapshot", params);
  }

  async getUserSummary(
    address: string,
    from: number = 0,
    to: number = 0,
  ): Promise<unknown> {
    const params: Record<string, string> = { address };
    if (from > 0) params.from = String(from);
    if (to > 0) params.to = String(to);
    return this.get("/v1/analytics/user-summary", params);
  }

  async getUserPnLSeries(
    address: string,
    from: number = 0,
    to: number = 0,
    bucketMs: number = 0,
  ): Promise<unknown> {
    const params: Record<string, string> = { address };
    if (from > 0) params.from = String(from);
    if (to > 0) params.to = String(to);
    if (bucketMs > 0) params.bucket_ms = String(bucketMs);
    return this.get("/v1/analytics/user-pnl-series", params);
  }

  async getWalletLabels(
    whaleTopN: number = 100,
    smartTopN: number = 100,
  ): Promise<unknown> {
    return this.get("/v1/analytics/wallet-labels", {
      whale_top_n: String(whaleTopN),
      smart_top_n: String(smartTopN),
    });
  }

  // ─── Cohorts ──────────────────────────────────────────────────────────

  async listCohorts(): Promise<unknown> {
    return this.get("/v1/cohorts");
  }

  async getCohortAddresses(name: string): Promise<unknown> {
    return this.get(`/v1/cohorts/${encodeURIComponent(name)}`);
  }

  // ─── Account & Status ────────────────────────────────────────────────

  async getStatus(): Promise<unknown> {
    return this.get("/v1/status");
  }

  async getStatusMetrics(): Promise<unknown> {
    return this.get("/v1/status/metrics");
  }

  async getStatusHistory(period: string = ""): Promise<unknown> {
    const params: Record<string, string> = {};
    if (period) params.period = period;
    return this.get("/v1/status/history", params);
  }

  async listMarkets(
    source: string = "",
    market_class: string = "",
    issuer: string | undefined = undefined,
  ): Promise<unknown> {
    const params: Record<string, string> = {};
    if (source) params.source = source;
    if (market_class) params.market_class = market_class;
    // issuer is tri-state: undefined = no filter, "" = native only, "flx" = flx only.
    if (issuer !== undefined) params.issuer = issuer;
    return this.get("/v1/markets", params);
  }
}
