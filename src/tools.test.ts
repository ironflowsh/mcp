// Unit tests for MCP tool handlers.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { IRONBOX_TOOLS, tools, toolsFor } from "./tools.js";
import { outputSchemas } from "./schemas.js";
import { structuredFrom } from "./server.js";
import type { IronflowAPI } from "./api.js";

// ─── Mock API ────────────────────────────────────────────────────────────────

function mockApi(overrides: Partial<Record<keyof IronflowAPI, unknown>> = {}): IronflowAPI {
  return {
    getPrice: vi.fn().mockResolvedValue("67000.50"),
    getRecentTrades: vi.fn().mockResolvedValue({ data: [] }),
    getCandles: vi.fn().mockResolvedValue({ data: [] }),
    getFundingRates: vi.fn().mockResolvedValue({ data: [] }),
    getOpenInterest: vi.fn().mockResolvedValue({ data: [] }),
    getLiquidations: vi.fn().mockResolvedValue({ data: [] }),
    ...overrides,
  } as unknown as IronflowAPI;
}

function findTool(name: string) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

// ─── Tool listing ─────────────────────────────────────────────────────────────

describe("tools array", () => {
  it("exports 54 tools", () => {
    expect(tools).toHaveLength(54);
  });

  it("the data toolset leaves out only the Ironbox tools", () => {
    expect(toolsFor()).toBe(tools);
    const data = toolsFor("data").map((t) => t.name);
    expect(data).toHaveLength(46);
    expect(data.filter((n) => n.includes("ironbox") || n.includes("box_"))).toEqual([]);
    expect(tools.filter((t) => !data.includes(t.name)).map((t) => t.name)).toEqual(IRONBOX_TOOLS);
  });

  it("drops tools whose tables stopped updating", () => {
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("get_net_flows");
    expect(names).not.toContain("get_order_flow");
  });

  it("names Hyperliquid in every market-data description", () => {
    const generic = ["list_cohorts", "get_cohort_addresses", "get_status", "get_status_metrics", "get_status_history"];
    for (const tool of tools.filter((t) => !generic.includes(t.name))) {
      expect(tool.description, tool.name).toMatch(/Hyperliquid/);
    }
  });

  it("every tool has name, title, description, inputSchema, handler", () => {
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.title?.trim(), tool.name).toBeTruthy();
      expect(tool.title.length, tool.name).toBeLessThanOrEqual(40);
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema.type).toBe("object");
      expect(typeof tool.handler).toBe("function");
    }
  });

  it("all tool names are unique", () => {
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ─── get_price ───────────────────────────────────────────────────────────────

describe("get_price", () => {
  const tool = findTool("get_price");

  it("returns the price as JSON", async () => {
    const api = mockApi();
    const result = await tool.handler({ market: "BTC-PERP" }, api);
    expect(JSON.parse(result)).toEqual({ market: "BTC-PERP", price: "67000.50" });
    expect(api.getPrice).toHaveBeenCalledWith("BTC-PERP");
  });

  it("throws when market is missing", async () => {
    await expect(tool.handler({}, mockApi())).rejects.toThrow('"market" is required');
  });

  it("throws when market is empty string", async () => {
    await expect(tool.handler({ market: "  " }, mockApi())).rejects.toThrow('"market" is required');
  });

  it("throws when market is not a string", async () => {
    await expect(tool.handler({ market: 123 }, mockApi())).rejects.toThrow('"market" is required');
  });
});

// ─── get_recent_trades ───────────────────────────────────────────────────────

describe("get_recent_trades", () => {
  const tool = findTool("get_recent_trades");

  it("uses default limit of 20", async () => {
    const api = mockApi();
    await tool.handler({ market: "BTC-PERP" }, api);
    expect(api.getRecentTrades).toHaveBeenCalledWith("BTC-PERP", "20");
  });

  it("passes custom limit", async () => {
    const api = mockApi();
    await tool.handler({ market: "BTC-PERP", limit: 50 }, api);
    expect(api.getRecentTrades).toHaveBeenCalledWith("BTC-PERP", "50");
  });

  it("throws on invalid limit", async () => {
    await expect(tool.handler({ market: "BTC-PERP", limit: -5 }, mockApi())).rejects.toThrow('"limit" must be a positive number');
  });

  it("throws on non-numeric limit", async () => {
    await expect(tool.handler({ market: "BTC-PERP", limit: "abc" }, mockApi())).rejects.toThrow('"limit" must be a positive number');
  });
});

// ─── get_candles ─────────────────────────────────────────────────────────────

describe("get_candles", () => {
  const tool = findTool("get_candles");

  it("uses defaults: 1h interval and 24 candles", async () => {
    const api = mockApi();
    await tool.handler({ market: "ETH-PERP" }, api);
    expect(api.getCandles).toHaveBeenCalledWith("ETH-PERP", "1h", "24");
  });

  it("passes custom interval and limit", async () => {
    const api = mockApi();
    await tool.handler({ market: "ETH-PERP", interval: "4h", limit: 100 }, api);
    expect(api.getCandles).toHaveBeenCalledWith("ETH-PERP", "4h", "100");
  });

  it("passes a number interval on as text for the API to judge, and refuses other types", async () => {
    const api = mockApi();
    await tool.handler({ market: "ETH-PERP", interval: 60 }, api);
    expect(api.getCandles).toHaveBeenCalledWith("ETH-PERP", "60", "24");
    await expect(tool.handler({ market: "ETH-PERP", interval: ["1h"] }, mockApi())).rejects.toThrow('"interval" must be a string or a number');
  });
});

// ─── get_funding_rates ───────────────────────────────────────────────────────

describe("get_funding_rates", () => {
  const tool = findTool("get_funding_rates");

  it("uses default limit of 10", async () => {
    const api = mockApi();
    await tool.handler({ market: "BTC-PERP" }, api);
    expect(api.getFundingRates).toHaveBeenCalledWith("BTC-PERP", "10");
  });

  it("passes custom limit", async () => {
    const api = mockApi();
    await tool.handler({ market: "BTC-PERP", limit: 24 }, api);
    expect(api.getFundingRates).toHaveBeenCalledWith("BTC-PERP", "24");
  });
});

// ─── get_open_interest ───────────────────────────────────────────────────────

describe("get_open_interest", () => {
  const tool = findTool("get_open_interest");

  it("calls getOpenInterest with market", async () => {
    const api = mockApi();
    await tool.handler({ market: "BTC-PERP" }, api);
    expect(api.getOpenInterest).toHaveBeenCalledWith("BTC-PERP");
  });
});

// ─── get_liquidations ────────────────────────────────────────────────────────

describe("get_liquidations", () => {
  const tool = findTool("get_liquidations");

  it("uses default limit of 20", async () => {
    const api = mockApi();
    await tool.handler({ market: "BTC-PERP" }, api);
    expect(api.getLiquidations).toHaveBeenCalledWith("BTC-PERP", "20");
  });

  it("passes custom limit", async () => {
    const api = mockApi();
    await tool.handler({ market: "BTC-PERP", limit: 5 }, api);
    expect(api.getLiquidations).toHaveBeenCalledWith("BTC-PERP", "5");
  });

  it("throws when market is missing", async () => {
    await expect(tool.handler({}, mockApi())).rejects.toThrow('"market" is required');
  });
});

// ─── API error propagation ────────────────────────────────────────────────────

describe("API error propagation", () => {
  it("propagates API errors through tool handler", async () => {
    const api = mockApi({ getPrice: vi.fn().mockRejectedValue(new Error("Market not found")) });
    await expect(findTool("get_price").handler({ market: "FAKE-PERP" }, api)).rejects.toThrow("Market not found");
  });
});

// ─── Signal tools (public endpoints) ──────────────────────────────────────────

describe("signal tools", () => {
  const W = "0x9b3cafa1209ac61f02d7bc3b219697fb171c9c91";
  const cases: [string, Record<string, unknown>, string, Record<string, string>][] = [
    ["get_top_traders", {}, "/v1/copy-feed", { window: "30d", sort: "top", limit: "20" }],
    ["get_market_leaders", { market: "BTC-PERP" }, "/v1/asset-leaders", { market: "BTC-PERP", window: "30d", limit: "20" }],
    ["get_early_movers", { market: "ETH-PERP", window: "7d" }, "/v1/whale-signals", { market: "ETH-PERP", window: "7d", limit: "10" }],
    ["get_trader_profile", { address: W }, "/v1/trader-activity", { address: W, window: "30d" }],
  ];
  for (const [name, args, path, params] of cases) {
    it(`${name} calls ${path}`, async () => {
      const get = vi.fn().mockResolvedValue({ ok: true });
      const out = await findTool(name).handler(args, mockApi({ get }));
      expect(get).toHaveBeenCalledWith(path, params);
      expect(JSON.parse(out)).toEqual({ ok: true });
    });
  }

  it("get_market_leaders requires a market", async () => {
    await expect(findTool("get_market_leaders").handler({}, mockApi())).rejects.toThrow(/market/);
  });

  it("get_trader_profile requires an address", async () => {
    await expect(findTool("get_trader_profile").handler({}, mockApi())).rejects.toThrow(/address/);
  });
});

// ─── get_liquidation_summary ────────────────────────────────────────────────

describe("get_liquidation_summary", () => {
  const summary = {
    as_of: 2000,
    windows: [
      {
        window: "1h",
        from: 1000,
        total: { long_usd: 1200, short_usd: 10, liquidations: 3, wallets: 2 },
        largest: { market: "BTC-PERP", side: "long", usd: 1000, price: 100, address: "0x1", timestamp: 1500 },
        markets: [
          { market: "BTC-PERP", long_usd: 1200, short_usd: 0, liquidations: 2, wallets: 1 },
          { market: "ETH-PERP", long_usd: 0, short_usd: 10, liquidations: 1, wallets: 1 },
        ],
      },
    ],
  };

  it("reads the API summary and keeps the output shape", async () => {
    const get = vi.fn().mockResolvedValue(summary);
    const out = JSON.parse(await findTool("get_liquidation_summary").handler({ window: "1h", market: "BTC" }, mockApi({ get })));
    expect(get).toHaveBeenCalledWith("/v1/liquidations/summary", { windows: "1h", market: "BTC" });
    expect(out.count).toBe(3);
    expect(out.wallets).toBe(2);
    expect(out.notional_usd).toBe(1210);
    expect(out.longs_liquidated_usd).toBe(1200);
    expect(out.shorts_liquidated_usd).toBe(10);
    expect(out.by_market[0]).toEqual({ market: "BTC-PERP", count: 2, notional_usd: 1200 });
    expect(out.largest).toEqual({ market: "BTC-PERP", side: "long", notional_usd: 1000, price: 100, address: "0x1", timestamp: 1500 });
    expect(out.complete).toBe(true);
  });

  it("maps the older minutes argument to the next window", async () => {
    const get = vi.fn().mockResolvedValue(summary);
    await findTool("get_liquidation_summary").handler({ minutes: 90 }, mockApi({ get }));
    expect(get.mock.calls[0][1]).toEqual({ windows: "4h" });
    await findTool("get_liquidation_summary").handler({}, mockApi({ get }));
    expect(get.mock.calls[1][1]).toEqual({ windows: "1h" });
  });

  it("rejects unknown windows and over-long minutes", async () => {
    await expect(findTool("get_liquidation_summary").handler({ window: "2h" }, mockApi())).rejects.toThrow(/window/);
    await expect(findTool("get_liquidation_summary").handler({ minutes: 20000 }, mockApi())).rejects.toThrow(/7 days/);
  });
});

// ─── Structured output ───────────────────────────────────────────────────────

describe("output schemas", () => {
  it("covers every tool and nothing else", () => {
    expect(Object.keys(outputSchemas).sort()).toEqual(tools.map((t) => t.name).sort());
  });

  it("are loose objects: no required fields, no closed property sets", () => {
    const walk = (s: unknown): void => {
      if (!s || typeof s !== "object") return;
      const o = s as Record<string, unknown>;
      expect(o.required).toBeUndefined();
      expect(o.additionalProperties === false).toBe(false);
      Object.values(o).forEach(walk);
    };
    for (const [name, schema] of Object.entries(outputSchemas)) {
      expect((schema as { type?: string }).type, name).toBe("object");
      walk(schema);
    }
  });
});

describe("structuredFrom", () => {
  it("passes a JSON object through", () => {
    expect(structuredFrom('{"a":1}')).toEqual({ a: 1 });
  });
  it("wraps arrays and plain text so a result is always an object", () => {
    expect(structuredFrom("[1,2]")).toEqual({ result: [1, 2] });
    expect(structuredFrom("hello")).toEqual({ result: "hello" });
  });
});

// ─── Vault tools ─────────────────────────────────────────────────────────────

describe("get_vault_operations", () => {
  const tool = findTool("get_vault_operations");

  it("asks for a vault or address instead of sending the API a call it rejects with 400", async () => {
    const api = mockApi({ getVaultOperations: vi.fn() });
    await expect(tool.handler({}, api)).rejects.toThrow(/Pass "vault".*or "address"/);
    await expect(tool.handler({ vault: " ", limit: 5 }, api)).rejects.toThrow(/Pass "vault"/);
    expect(api.getVaultOperations).not.toHaveBeenCalled();
  });

  it("passes the filters lowercased, as the API stores addresses", async () => {
    const api = mockApi({ getVaultOperations: vi.fn().mockResolvedValue({ data: [] }) });
    await tool.handler({ vault: "0xDFC24B077BC1425AD1DEA75BCB6F8158E10DF303" }, api);
    expect(api.getVaultOperations).toHaveBeenCalledWith("0xdfc24b077bc1425ad1dea75bcb6f8158e10df303", "", "20");
  });
});

describe("get_vault_leaderboard", () => {
  const tool = findTool("get_vault_leaderboard");
  const queryResponse = {
    columns: ["vault", "total_deposits", "total_withdrawals", "net_flow", "unique_users"].map((name) => ({ name, type: "String" })),
    rows: [["0xabc", "100", "40", "60", 3]],
    row_count: 1,
    truncated: false,
    stats: {},
    limits: { history_days: 1 },
    budget_remaining_seconds: 59,
  };

  it("serves keyless callers from SQL, never the Builder-only endpoint", async () => {
    const post = vi.fn().mockResolvedValue(queryResponse);
    const api = mockApi({ hasKey: () => false, getVaultLeaderboard: vi.fn(), post });
    const out = JSON.parse(await tool.handler({ limit: 5 }, api));
    expect(api.getVaultLeaderboard).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith("/v1/query", expect.objectContaining({ sql: expect.stringContaining("FROM hl.vault_operations") }));
    expect((post.mock.calls[0][1] as { sql: string }).sql).toMatch(/LIMIT 5$/);
    expect(out).toEqual({
      window_days: 1,
      data: [{ source: "hyperliquid", vault: "0xabc", total_deposits: "100", total_withdrawals: "40", net_flow: "60", unique_users: 3 }],
    });
  });

  it("uses the REST endpoint for Builder keys", async () => {
    const post = vi.fn();
    const api = mockApi({ hasKey: () => true, getVaultLeaderboard: vi.fn().mockResolvedValue({ data: [{ vault: "0xabc" }] }), post });
    expect(JSON.parse(await tool.handler({}, api))).toEqual({ data: [{ vault: "0xabc" }] });
    expect(api.getVaultLeaderboard).toHaveBeenCalledWith("10");
    expect(post).not.toHaveBeenCalled();
  });

  it("falls back to SQL when the key's tier is below Builder", async () => {
    const post = vi.fn().mockResolvedValue({ ...queryResponse, limits: { history_days: 30 } });
    const api = mockApi({
      hasKey: () => true,
      getVaultLeaderboard: vi.fn().mockRejectedValue(new Error("Ironflow API error 403 TIER_FORBIDDEN: requires Builder")),
      post,
    });
    expect(JSON.parse(await tool.handler({}, api)).window_days).toBe(7);
    expect(post).toHaveBeenCalledOnce();
  });

  it("passes other API errors through", async () => {
    const api = mockApi({
      hasKey: () => true,
      getVaultLeaderboard: vi.fn().mockRejectedValue(new Error("Ironflow API error 500 INTERNAL: boom")),
      post: vi.fn(),
    });
    await expect(tool.handler({}, api)).rejects.toThrow("500");
  });
});

// ─── list_markets ────────────────────────────────────────────────────────────

describe("list_markets", () => {
  const tool = findTool("list_markets");
  const page = { data: [{ display_symbol: "xyz:NVDA-PERP", metadata: { big: 1 } }], count: 1, pagination: { next_cursor: "n1", has_more: true, total: 10 } };

  it("passes q, include_inactive, limit and cursor to the API", async () => {
    const listMarkets = vi.fn().mockResolvedValue(page);
    const out = JSON.parse(
      await tool.handler({ q: "nvda", include_inactive: true, limit: 20, cursor: "c0", market_class: "perp" }, mockApi({ listMarkets }))
    );
    expect(listMarkets).toHaveBeenCalledWith({
      source: "",
      marketClass: "perp",
      issuer: undefined,
      q: "nvda",
      includeInactive: true,
      limit: 20,
      cursor: "c0",
    });
    expect(out).toEqual({
      matched: 10,
      returned: 1,
      data: [{ display_symbol: "xyz:NVDA-PERP" }],
      pagination: { next_cursor: "n1", has_more: true, total: 10 },
    });
  });

  it("asks for one page of 100 by default and never more than 100", async () => {
    const listMarkets = vi.fn().mockResolvedValue(page);
    await tool.handler({}, mockApi({ listMarkets }));
    await tool.handler({ limit: 5000 }, mockApi({ listMarkets }));
    expect(listMarkets.mock.calls[0][0]).toMatchObject({ limit: 100, includeInactive: false });
    expect(listMarkets.mock.calls[1][0]).toMatchObject({ limit: 100 });
  });

  it("still accepts search, the pre-0.11 name of q, and issuer '' for native only", async () => {
    const listMarkets = vi.fn().mockResolvedValue(page);
    await tool.handler({ search: "btc", issuer: "" }, mockApi({ listMarkets }));
    expect(listMarkets.mock.calls[0][0]).toMatchObject({ q: "btc", issuer: "" });
  });

  it("rejects a non-boolean include_inactive", async () => {
    await expect(tool.handler({ include_inactive: "yes" }, mockApi({ listMarkets: vi.fn() }))).rejects.toThrow(/true or false/);
  });
});

// ─── Time windows ────────────────────────────────────────────────────────────

describe("time window parameters", () => {
  const W = "0x9b3cafa1209ac61f02d7bc3b219697fb171c9c91";

  it("pass Unix ms, Unix seconds and ISO 8601 through for the API to read", async () => {
    const getUserSummary = vi.fn().mockResolvedValue({});
    const tool = findTool("get_user_summary");
    await tool.handler({ address: W, from: 1793232000000, to: "1793318400" }, mockApi({ getUserSummary }));
    await tool.handler({ address: W, from: "2026-10-01", to: "2026-10-02T12:00:00Z" }, mockApi({ getUserSummary }));
    expect(getUserSummary.mock.calls[0]).toEqual([W, "1793232000000", "1793318400"]);
    expect(getUserSummary.mock.calls[1]).toEqual([W, "2026-10-01", "2026-10-02T12:00:00Z"]);
  });

  it("leave an unset bound out", async () => {
    const getPnLLeaderboard = vi.fn().mockResolvedValue({});
    await findTool("get_pnl_leaderboard").handler({}, mockApi({ getPnLLeaderboard }));
    expect(getPnLLeaderboard).toHaveBeenCalledWith("", "", 50, "realized_pnl");
  });

  it("pass relative times (now, -24h, now-7d) through", async () => {
    const getUserSummary = vi.fn().mockResolvedValue({});
    const tool = findTool("get_user_summary");
    await tool.handler({ address: W, from: "-7d", to: "now" }, mockApi({ getUserSummary }));
    await tool.handler({ address: W, from: "NOW-24h", to: "-30m" }, mockApi({ getUserSummary }));
    expect(getUserSummary.mock.calls[0]).toEqual([W, "-7d", "now"]);
    expect(getUserSummary.mock.calls[1]).toEqual([W, "now-24h", "-30m"]);
    await expect(tool.handler({ address: W, from: "-7y" }, mockApi())).rejects.toThrow(/relative/);
  });

  it("reject text that is no time", async () => {
    await expect(findTool("get_user_summary").handler({ address: W, from: "last tuesday" }, mockApi())).rejects.toThrow(/ISO 8601/);
    await expect(findTool("get_user_summary").handler({ address: W, from: -5 }, mockApi())).rejects.toThrow(/ISO 8601/);
  });

  it("are declared as strings with the accepted formats", () => {
    for (const tool of tools) {
      for (const key of ["from", "to"]) {
        const prop = tool.inputSchema.properties[key];
        if (!prop) continue;
        expect(prop.type, `${tool.name}.${key}`).toBe("string");
        expect(prop.description, `${tool.name}.${key}`).toMatch(/ISO 8601/);
      }
    }
  });
});

describe("market parameters", () => {
  it("say that Hyperliquid names are accepted", () => {
    for (const tool of tools) {
      const prop = tool.inputSchema.properties.market;
      if (prop) expect(prop.description, tool.name).toMatch(/Hyperliquid name/);
    }
  });
});

describe("liquidation alert tools", () => {
  it("create sends only the fields given", async () => {
    const post = vi.fn().mockResolvedValue({ id: "6f1c2a3b-0000-4000-8000-000000000001", type: "discord" });
    const api = mockApi({ post });
    const out = await findTool("create_liquidation_alert").handler(
      { url: "https://discord.com/api/webhooks/1/x", markets: "BTC,ETH", side: "long", min_usd: 100000 },
      api
    );
    expect(post).toHaveBeenCalledWith("/v1/alerts", {
      url: "https://discord.com/api/webhooks/1/x",
      markets: "BTC,ETH",
      side: "long",
      min_usd: 100000,
    });
    expect(JSON.parse(out).type).toBe("discord");
  });

  it("create needs a url or a telegram chat", async () => {
    await expect(findTool("create_liquidation_alert").handler({}, mockApi())).rejects.toThrow("telegram_chat");
    const post = vi.fn().mockResolvedValue({ type: "telegram" });
    await findTool("create_liquidation_alert").handler({ telegram_chat: "@my_alerts", min_usd: 250000 }, mockApi({ post }));
    expect(post).toHaveBeenCalledWith("/v1/alerts", { telegram_chat: "@my_alerts", min_usd: 250000 });
  });

  it("test and delete take only an alert id", async () => {
    const post = vi.fn().mockResolvedValue({ delivered: true, status: "active" });
    const del = vi.fn().mockResolvedValue(undefined);
    const api = mockApi({ post, del });
    const id = "6F1C2A3B-0000-4000-8000-000000000001";
    await findTool("test_liquidation_alert").handler({ id }, api);
    expect(post).toHaveBeenCalledWith(`/v1/alerts/${id.toLowerCase()}/test`, {});
    const out = await findTool("delete_liquidation_alert").handler({ id }, api);
    expect(del).toHaveBeenCalledWith(`/v1/alerts/${id.toLowerCase()}`);
    expect(JSON.parse(out)).toEqual({ deleted: true, id: id.toLowerCase() });
    for (const bad of ["../keys", "6f1c2a3b", "6f1c2a3b-0000-4000-8000-000000000001/../x"]) {
      await expect(findTool("delete_liquidation_alert").handler({ id: bad }, api), bad).rejects.toThrow("alert id");
    }
    expect(del).toHaveBeenCalledTimes(1);
  });

  it("list reads /v1/alerts", async () => {
    const get = vi.fn().mockResolvedValue({ alerts: [], limit: 1 });
    await findTool("list_liquidation_alerts").handler({}, mockApi({ get }));
    expect(get).toHaveBeenCalledWith("/v1/alerts");
  });
});

describe("Ironbox tools", () => {
  const box = { id: "ibx_01JC7W2K", name: "funding-bot", state: "creating", size: "small", mode: "paper", runtime: "python" };

  it("create sends only the fields given, markets as a list", async () => {
    const post = vi.fn().mockResolvedValue(box);
    const out = await findTool("create_ironbox").handler(
      { name: " funding-bot ", mode: "paper", markets: ["perps", "Outcomes"], note: "" },
      mockApi({ post })
    );
    expect(post).toHaveBeenCalledWith("/v1/ironbox", { name: "funding-bot", mode: "paper", markets: ["perps", "outcomes"] });
    expect(JSON.parse(out)).toEqual(box);
  });

  it("create works with no arguments and reads comma-separated markets", async () => {
    const post = vi.fn().mockResolvedValue(box);
    await findTool("create_ironbox").handler({}, mockApi({ post }));
    expect(post).toHaveBeenLastCalledWith("/v1/ironbox", {});
    await findTool("create_ironbox").handler({ size: "large", runtime: "node", markets: "perps, spot" }, mockApi({ post }));
    expect(post).toHaveBeenLastCalledWith("/v1/ironbox", { size: "large", runtime: "node", markets: ["perps", "spot"] });
    await expect(findTool("create_ironbox").handler({ markets: [1] }, mockApi({ post }))).rejects.toThrow("markets");
  });

  it("list, get and delete read and remove by id", async () => {
    const get = vi.fn().mockResolvedValue({ data: [box] });
    const del = vi.fn().mockResolvedValue({ ...box, state: "deleted" });
    const api = mockApi({ get, del });
    expect(JSON.parse(await findTool("list_ironboxes").handler({}, api))).toEqual({ data: [box] });
    expect(get).toHaveBeenLastCalledWith("/v1/ironbox");
    await findTool("get_ironbox").handler({ id: " ibx_01JC7W2K " }, api);
    expect(get).toHaveBeenLastCalledWith("/v1/ironbox/ibx_01JC7W2K");
    const out = await findTool("delete_ironbox").handler({ id: "ibx_01JC7W2K" }, api);
    expect(del).toHaveBeenCalledWith("/v1/ironbox/ibx_01JC7W2K");
    expect(JSON.parse(out).state).toBe("deleted");
    for (const bad of ["../keys", "ibx_", "6f1c2a3b", "ibx_1/../x", "ibx_1?x=1"]) {
      await expect(findTool("delete_ironbox").handler({ id: bad }, api), bad).rejects.toThrow("Ironbox id");
      await expect(findTool("get_ironbox").handler({ id: bad }, api), bad).rejects.toThrow("Ironbox id");
    }
    expect(del).toHaveBeenCalledTimes(1);
  });
});

// ─── get_outcome_markets ──────────────────────────────────────────────────────

describe("get_outcome_markets", () => {
  const run = async (summary: Record<string, unknown>, args: Record<string, unknown> = {}) => {
    const api = mockApi({ getOutcomeMarkets: vi.fn().mockResolvedValue(summary) });
    return JSON.parse(await findTool("get_outcome_markets").handler(args, api));
  };

  it("ranks by traded volume and returns the last trade as the price", async () => {
    const out = await run({
      window_hours: 24,
      volume_usd: 7971888,
      notional_total: 16418714,
      active_markets: [
        { market_id: 2, notional_24h: 900, volume_24h: 100, last_price: 0.5, last_trade_price: 0.22, last_trade_ms: 1000 },
        { market_id: 4, notional_24h: 300, volume_24h: 250, last_price: 0.5, last_trade_price: 0.84, last_trade_ms: 2000 },
      ],
    });
    expect(out.volume_usd).toBe(7971888);
    expect(out.notional_total).toBe(16418714);
    expect(out.top_markets.map((m: { market_id: number }) => m.market_id)).toEqual([4, 2]);
    expect(out.top_markets[0].last_price).toBe(0.84);
    expect(out.top_markets[1].last_price).toBe(0.22);
  });

  it("reports no price for a side with only splits and merges in 24 hours", async () => {
    const out = await run({
      active_markets: [{ market_id: 2, notional_24h: 50, volume_24h: 0, last_price: 0.5, last_trade_price: 0, last_trade_ms: 0 }],
    });
    expect(out.top_markets[0].last_price).toBeNull();
  });

  it("keeps the old ranking and price while the API has no traded fields", async () => {
    const out = await run({
      notional_total: 500,
      active_markets: [
        { market_id: 2, notional_24h: 100, last_price: 0.3 },
        { market_id: 4, notional_24h: 400, last_price: 0.6 },
      ],
    });
    expect(out.volume_usd).toBeUndefined();
    expect(out.notional_total).toBe(500);
    expect(out.top_markets.map((m: { market_id: number }) => m.market_id)).toEqual([4, 2]);
    expect(out.top_markets[0].last_price).toBe(0.6);
  });

  it("applies the limit and copes with no markets", async () => {
    const rows = [1, 2, 3].map((i) => ({ market_id: i * 2, volume_24h: i, last_trade_price: 0.5, last_trade_ms: 1 }));
    expect((await run({ active_markets: rows }, { limit: 2 })).top_markets).toHaveLength(2);
    expect((await run({})).top_markets).toEqual([]);
  });

  it("describes every field it returns", async () => {
    const out = await run({
      window_hours: 24,
      volume_usd: 1,
      notional_total: 2,
      fills_total: 3,
      wallets_total: 4,
      markets_active: 5,
      computed_at: 6,
      active_markets: [{ market_id: 2, display_symbol: "A", hl_coin: "#1", last_fill_ms: 1, fills_24h: 1, notional_24h: 1, volume_24h: 1, last_price: 0.5, last_trade_price: 0.4, last_trade_ms: 1 }],
    });
    const schema = outputSchemas.get_outcome_markets as { properties: Record<string, { items?: { properties: Record<string, unknown> } }> };
    for (const k of Object.keys(out)) expect(schema.properties).toHaveProperty(k);
    for (const k of Object.keys(out.top_markets[0])) expect(schema.properties.top_markets.items?.properties).toHaveProperty(k);
  });
});

describe("paper box strategy tools", () => {
  const secret = "ibxs_" + "ab".repeat(32);
  const box = `https://api.ironflow.sh/box/${secret}`;

  it("start_box_strategy sends only strategy fields, to the box URL", async () => {
    const post = vi.fn().mockResolvedValue({ strategy: { id: "strat_1" }, paper: true });
    await findTool("start_box_strategy").handler(
      { box, kind: "dca", market: "BTC", tranche_usd: 100, budget_usd: 500, max_loss_usd: 50, script: "import os" },
      mockApi({ post })
    );
    expect(post).toHaveBeenCalledWith(`/box/${secret}/strategies`, {
      kind: "dca", market: "BTC", tranche_usd: 100, budget_usd: 500, max_loss_usd: 50,
    });
  });

  it("takes the bare secret and refuses anything else", async () => {
    const get = vi.fn().mockResolvedValue({ strategies: [] });
    await findTool("list_box_strategies").handler({ box: secret }, mockApi({ get }));
    expect(get).toHaveBeenCalledWith(`/box/${secret}/strategies`);
    await expect(findTool("list_box_strategies").handler({ box: "https://evil.example/x" }, mockApi({ get }))).rejects.toThrow("box must be");
    await expect(findTool("list_box_strategies").handler({ box: "ibxs_../../v1/keys" }, mockApi({ get }))).rejects.toThrow("box must be");
  });

  it("stop_box_strategy can leave the position and checks the id", async () => {
    const del = vi.fn().mockResolvedValue({ strategy: { status: "stopped" } });
    const strategy_id = "strat_9f2c4a7e1b3d5c60";
    await findTool("stop_box_strategy").handler({ box, strategy_id, close_position: false }, mockApi({ del }));
    expect(del).toHaveBeenCalledWith(`/box/${secret}/strategies/${strategy_id}?close_position=false`);
    await findTool("stop_box_strategy").handler({ box, strategy_id }, mockApi({ del }));
    expect(del).toHaveBeenLastCalledWith(`/box/${secret}/strategies/${strategy_id}`);
    await expect(findTool("stop_box_strategy").handler({ box, strategy_id: "../x" }, mockApi({ del }))).rejects.toThrow("strategy_id");
  });

  it("get_box_activity passes the cursor", async () => {
    const get = vi.fn().mockResolvedValue({ events: [], next_cursor: 9 });
    await findTool("get_box_activity").handler({ box, after: 9, limit: 50 }, mockApi({ get }));
    expect(get).toHaveBeenCalledWith(`/box/${secret}/activity`, { after: "9", limit: "50" });
  });
});

describe("number-like parameters", () => {
  // opencode's first get_liquidation_map call sent bucket_size 100 as a
  // number and got '"bucket_size" must be a string' (2026-11-11).
  it("get_liquidation_map takes bucket_size as a number or a string", async () => {
    const getLiquidationMap = vi.fn().mockResolvedValue({ levels: [] });
    await findTool("get_liquidation_map").handler({ market: "BTC-PERP", bucket_size: 100, range_pct: "15" }, mockApi({ getLiquidationMap }));
    expect(getLiquidationMap).toHaveBeenCalledWith("BTC-PERP", "100", "15", "both");
    await findTool("get_liquidation_map").handler({ market: "BTC-PERP", bucket_size: "250" }, mockApi({ getLiquidationMap }));
    expect(getLiquidationMap).toHaveBeenLastCalledWith("BTC-PERP", "250", "20", "both");
  });

  it("get_liquidation_levels takes bucket_size as a number", async () => {
    const getLiquidationLevels = vi.fn().mockResolvedValue({ data: [] });
    await findTool("get_liquidation_levels").handler({ market: "BTC-PERP", bucket_size: 1000 }, mockApi({ getLiquidationLevels }));
    expect(getLiquidationLevels).toHaveBeenCalledWith("BTC-PERP", "1000");
  });

  it("still refuses objects and non-finite numbers where a string is expected", async () => {
    const getLiquidationMap = vi.fn();
    await expect(findTool("get_liquidation_map").handler({ market: "BTC-PERP", bucket_size: { x: 1 } }, mockApi({ getLiquidationMap }))).rejects.toThrow("bucket_size");
    await expect(findTool("get_liquidation_map").handler({ market: "BTC-PERP", bucket_size: Number.NaN }, mockApi({ getLiquidationMap }))).rejects.toThrow("bucket_size");
    expect(getLiquidationMap).not.toHaveBeenCalled();
  });

  it("start_box_strategy sends grid prices as strings and numeric fields as numbers", async () => {
    const secret = "ibxs_" + "cd".repeat(32);
    const post = vi.fn().mockResolvedValue({ strategy: { id: "strat_1" } });
    await findTool("start_box_strategy").handler(
      { box: secret, kind: "grid", market: "BTC", lower_px: 95000, upper_px: "105000", grids: "10", size_usd: "500", max_loss_usd: 50 },
      mockApi({ post })
    );
    expect(post).toHaveBeenCalledWith(`/box/${secret}/strategies`, {
      kind: "grid", market: "BTC", lower_px: "95000", upper_px: "105000", grids: 10, size_usd: 500, max_loss_usd: 50,
    });
  });
});
