// Ironflow REST API client. Uses native fetch — no external HTTP dependencies.

const DEFAULT_BASE_URL = "https://api.ironflow.sh";
const DEFAULT_SOURCE = "hyperliquid";

export class IronflowAPI {
  private baseUrl: string;
  private apiKey?: string;
  private source: string;

  constructor(
    baseUrl = DEFAULT_BASE_URL,
    apiKey?: string,
    source = DEFAULT_SOURCE
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.source = source;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "ironflow-mcp/0.4.0",
    };
    if (this.apiKey) {
      h["Authorization"] = `Bearer ${this.apiKey}`;
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

    return res.json();
  }

  async patch(path: string, body: unknown): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    const res = await fetch(url.toString(), {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw await this.apiError(res);
    }
    return res.json();
  }

  async delete(path: string): Promise<void> {
    const url = new URL(path, this.baseUrl);
    const res = await fetch(url.toString(), {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok) {
      throw await this.apiError(res);
    }
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

  async getOrderbook(market: string): Promise<unknown> {
    return this.get("/v1/book", { market });
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

  async getDeposits(address: string = "", limit: string = "20"): Promise<unknown> {
    const params: Record<string, string> = { limit };
    if (address) params.address = address;
    return this.get("/v1/deposits", params);
  }

  async getWithdrawals(address: string = "", limit: string = "20"): Promise<unknown> {
    const params: Record<string, string> = { limit };
    if (address) params.address = address;
    return this.get("/v1/withdrawals", params);
  }

  async getOrderStatuses(address: string, market: string = "", limit: string = "20"): Promise<unknown> {
    const params: Record<string, string> = { address, limit };
    if (market) params.market = market;
    return this.get("/v1/order-statuses", params);
  }

  async getVaultOperations(vault: string = "", address: string = "", limit: string = "20"): Promise<unknown> {
    const params: Record<string, string> = { limit };
    if (vault) params.vault = vault;
    if (address) params.address = address;
    return this.get("/v1/vault-operations", params);
  }

  // ─── Analytics ────────────────────────────────────────────────────────

  async getNetFlows(interval: string = "1d", limit: string = "7"): Promise<unknown> {
    return this.get("/v1/analytics/net-flows", { interval, limit });
  }

  async getLiquidationLevels(market: string, bucket_size: string = "100"): Promise<unknown> {
    return this.get("/v1/analytics/liquidation-levels", { market, bucket_size });
  }

  async getOrderFlow(market: string = ""): Promise<unknown> {
    const params: Record<string, string> = {};
    if (market) params.market = market;
    return this.get("/v1/analytics/order-flow", params);
  }

  async getVaultLeaderboard(limit: string = "10"): Promise<unknown> {
    return this.get("/v1/analytics/vault-leaderboard", { limit });
  }

  async getFundingStats(market: string, interval: string = "1d", limit: string = "7"): Promise<unknown> {
    return this.get("/v1/analytics/funding-stats", { market, interval, limit });
  }

  // ─── Triggers ─────────────────────────────────────────────────────────

  async listTriggers(): Promise<unknown> {
    return this.get("/v1/triggers");
  }

  async createTrigger(body: unknown): Promise<unknown> {
    return this.post("/v1/triggers", body);
  }

  async testTrigger(body: unknown): Promise<unknown> {
    return this.post("/v1/triggers/test", body);
  }

  async toggleTrigger(id: number, isActive: boolean): Promise<unknown> {
    return this.patch(`/v1/triggers/${id}`, { is_active: isActive });
  }

  async deleteTrigger(id: number): Promise<void> {
    await this.delete(`/v1/triggers/${id}`);
  }

  // ─── Cohorts ──────────────────────────────────────────────────────────

  async listCohorts(): Promise<unknown> {
    return this.get("/v1/cohorts");
  }

  async getCohortAddresses(name: string): Promise<unknown> {
    return this.get(`/v1/cohorts/${encodeURIComponent(name)}`);
  }

  async deleteCohort(name: string): Promise<void> {
    await this.delete(`/v1/cohorts/${encodeURIComponent(name)}`);
  }

  // ─── Account & Status ────────────────────────────────────────────────

  async getMe(): Promise<unknown> {
    return this.get("/v1/me");
  }

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
