import { afterEach, describe, expect, it, vi } from "vitest";
import { IronflowAPI } from "./api.js";

// sentHeaders captures the headers of the one fetch a call makes.
function stubFetch(): () => Record<string, string> {
  const fetchMock = vi.fn(async () => new Response("{}", { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  return () => (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IronflowAPI caller context", () => {
  it("sends no context headers by default", async () => {
    const headers = stubFetch();
    await new IronflowAPI("http://api", undefined, undefined, "0.10.0").get("/v1/status");
    expect(headers()["X-Ironflow-Client"]).toBeUndefined();
    expect(headers()["X-Ironflow-Tool"]).toBeUndefined();
    expect(headers()["User-Agent"]).toBe("ironflow-mcp/0.10.0");
  });

  it("tags requests with the client app and tool", async () => {
    const headers = stubFetch();
    const api = new IronflowAPI("http://api").withContext({ client: "claude-ai/0.1.0", tool: "run_query" });
    await api.post("/v1/query", { sql: "SELECT 1" });
    expect(headers()["X-Ironflow-Client"]).toBe("claude-ai/0.1.0");
    expect(headers()["X-Ironflow-Tool"]).toBe("run_query");
  });

  it("leaves the original client untouched", async () => {
    const headers = stubFetch();
    const base = new IronflowAPI("http://api");
    base.withContext({ tool: "get_status" });
    await base.get("/v1/status");
    expect(headers()["X-Ironflow-Tool"]).toBeUndefined();
  });

  it("drops values that are not plain names", async () => {
    const headers = stubFetch();
    await new IronflowAPI("http://api").withContext({ client: "bad\nname", tool: "Drop Table" }).get("/v1/status");
    expect(headers()["X-Ironflow-Client"]).toBeUndefined();
    expect(headers()["X-Ironflow-Tool"]).toBeUndefined();
  });
});

describe("IronflowAPI upstream calls", () => {
  it("records each status and error code, shared with withContext copies", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "TIER_FORBIDDEN", message: "Builder only" } }), { status: 403 })
      )
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);
    const base = new IronflowAPI("http://api");
    const tool = base.withContext({ tool: "get_vault_leaderboard" });
    await tool.get("/v1/status");
    await expect(tool.get("/v1/analytics/vault-leaderboard")).rejects.toThrow("403 TIER_FORBIDDEN");
    await expect(tool.post("/v1/query", {})).rejects.toThrow("502");
    expect(base.upstreamCalls()).toEqual([{ status: 200 }, { status: 403, code: "TIER_FORBIDDEN" }, { status: 502 }]);
  });

  it("del returns a JSON body, and nothing for 204", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "ibx_1", state: "deleted" }), { headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const api = new IronflowAPI("http://api");
    expect(await api.del("/v1/ironbox/ibx_1")).toEqual({ id: "ibx_1", state: "deleted" });
    expect(await api.del("/v1/alerts/x")).toBeUndefined();
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe("DELETE");
  });

  it("reports whether a key is set", () => {
    expect(new IronflowAPI("http://api").hasKey()).toBe(false);
    expect(new IronflowAPI("http://api", "if_test").withContext({}).hasKey()).toBe(true);
  });
});

describe("IronflowAPI notices", () => {
  const json = (body: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });

  it("collects notice headers per withContext copy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ data: [] }, { headers: { "X-Ironflow-Market": "BTC-PERP" } }))
    );
    const base = new IronflowAPI("http://api");
    const a = base.withContext({ tool: "get_candles" });
    const b = base.withContext({ tool: "get_price" });
    await a.get("/v1/candles", { market: "BTC" });
    expect(a.notice()).toBe('Market "BTC" was read as BTC-PERP.');
    expect(b.notice()).toBe("");
  });

  it("reads notices on error responses too, and keeps the API's message, detail and Retry-After", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json(
          { error: { code: "KEYLESS_DAILY_LIMIT", message: "keyless access allows 500 requests per day from one IP: https://ironflow.sh/key", detail: "per IP" } },
          { status: 429, headers: { "Retry-After": "3600" } }
        )
      )
    );
    const api = new IronflowAPI("http://api").withContext({});
    await expect(api.get("/v1/trades", { market: "BTC-PERP" })).rejects.toThrow(
      "Ironflow API error 429 KEYLESS_DAILY_LIMIT: keyless access allows 500 requests per day from one IP: https://ironflow.sh/key (per IP) Retry after 3600 s."
    );
  });
});

describe("IronflowAPI.listMarkets", () => {
  function urlOf(call: unknown): URL {
    return new URL((call as [string])[0]);
  }

  it("passes q, include_inactive, limit and cursor through", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await new IronflowAPI("http://api").listMarkets({ q: "nvda", includeInactive: true, limit: 50, cursor: "abc", marketClass: "perp" });
    const url = urlOf(fetchMock.mock.calls[0]);
    expect(url.pathname).toBe("/v1/markets");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "nvda",
      include_inactive: "true",
      limit: "50",
      cursor: "abc",
      market_class: "perp",
      source: "hyperliquid",
    });
  });

  it("sends issuer= for native-only and leaves issuer out when not asked", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const api = new IronflowAPI("http://api");
    await api.listMarkets({ issuer: "" });
    await api.listMarkets({});
    expect(urlOf(fetchMock.mock.calls[0]).searchParams.has("issuer")).toBe(true);
    expect(urlOf(fetchMock.mock.calls[0]).searchParams.get("issuer")).toBe("");
    expect(urlOf(fetchMock.mock.calls[1]).searchParams.has("issuer")).toBe(false);
  });
});

// The list endpoints sort oldest first; "latest" calls must ask for desc.
describe("IronflowAPI latest rows", () => {
  afterEach(() => vi.unstubAllGlobals());

  const urls = async (call: (api: IronflowAPI) => Promise<unknown>): Promise<URL> => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ mark_price: "1" }] }), { headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await call(new IronflowAPI("http://api"));
    return new URL((fetchMock.mock.calls[0] as unknown as [string])[0]);
  };

  it("asks for the newest rows first", async () => {
    for (const call of [
      (a: IronflowAPI) => a.getPrice("BTC-PERP"),
      (a: IronflowAPI) => a.getMarkPrices("BTC-PERP"),
      (a: IronflowAPI) => a.getOpenInterest("BTC-PERP"),
      (a: IronflowAPI) => a.getRecentTrades("BTC-PERP"),
      (a: IronflowAPI) => a.getFundingRates("BTC-PERP"),
      (a: IronflowAPI) => a.getLiquidations("BTC-PERP"),
    ]) {
      const u = await urls(call);
      expect(u.searchParams.get("order"), u.pathname).toBe("desc");
      vi.unstubAllGlobals();
    }
  });
});

describe("IronflowAPI.noteRPC", () => {
  it("reports a session call with the client app, never the key", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const api = new IronflowAPI("http://api", "if_secret", undefined, "0.17.2-hosted", "203.0.113.9").withContext({ client: "claude-ai/0.1.0" });
    await api.noteRPC("tools/list", true, "data");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe("http://api/v1/mcp/events?rpc=tools%2Flist&keyed=true&toolset=data");
    expect(init.method).toBe("POST");
    expect(headers["X-Ironflow-Client"]).toBe("claude-ai/0.1.0");
    expect(headers["User-Agent"]).toBe("ironflow-mcp/0.17.2-hosted");
    expect(headers["X-Forwarded-For"]).toBe("203.0.113.9");
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("tags our own checks with utm_source=qa_check, which the API leaves out of mcp_request", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const api = new IronflowAPI("http://api").withContext({ client: "claude-code/2.1.322" });
    await api.noteRPC("initialize", false, undefined, true);
    await api.noteRPC("initialize", false);
    const [qa] = fetchMock.mock.calls[0] as unknown as [string];
    const [outside] = fetchMock.mock.calls[1] as unknown as [string];
    expect(qa).toBe("http://api/v1/mcp/events?rpc=initialize&keyed=false&utm_source=qa_check");
    expect(outside).toBe("http://api/v1/mcp/events?rpc=initialize&keyed=false");
  });

  it("never throws when the API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))));
    await expect(new IronflowAPI("http://api").noteRPC("initialize", false)).resolves.toBeUndefined();
  });
});
