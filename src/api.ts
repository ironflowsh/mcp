// Ironflow REST API client. Uses native fetch — no external HTTP dependencies.

const DEFAULT_BASE_URL = "https://api.ironflow.sh";
const DEFAULT_SOURCE = "hyperliquid";

export class IronflowAPI {
  private baseUrl: string;
  private apiKey?: string;
  private source: string;
  private userAgent: string;
  private forwardedFor?: string;

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
    return h;
  }

  private async apiError(res: Response): Promise<Error> {
    const text = await res.text();
    try {
      const parsed = JSON.parse(text) as {
        error?: { code?: string; message?: string };
      };
      const code = parsed.error?.code;
      const message = parsed.error?.message;
      if (code) {
        return new Error(`Ironflow API error ${res.status} ${code}: ${message ?? text}`);
      }
    } catch {
      // Non-JSON response — fall through to raw text.
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

    const ctype = res.headers.get("content-type") ?? "";
    if (ctype.includes("application/json")) {
      return res.json();
    }
    return res.text();
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
