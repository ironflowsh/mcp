// Unit tests for MCP tool handlers.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { tools } from "./tools.js";
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
  it("exports 36 tools", () => {
    expect(tools).toHaveLength(36);
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

  it("every tool has name, description, inputSchema, handler", () => {
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
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

  it("throws when interval is not a string", async () => {
    await expect(tool.handler({ market: "ETH-PERP", interval: 60 }, mockApi())).rejects.toThrow('"interval" must be a string');
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
  const liq = (m: string, side: string, price: string, size: string) => ({ display_symbol: m, side, price, size, address: "0x1", timestamp: 1 });

  it("pages the feed and aggregates per market", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ data: [liq("BTC-PERP", "sell", "100", "2"), liq("ETH-PERP", "buy", "10", "1")], pagination: { has_more: true, next_cursor: "c1" } })
      .mockResolvedValueOnce({ data: [liq("BTC-PERP", "sell", "100", "10")], pagination: { has_more: false } });
    const out = JSON.parse(await findTool("get_liquidation_summary").handler({ minutes: 30 }, mockApi({ get })));

    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1][1].cursor).toBe("c1");
    expect(out.count).toBe(3);
    expect(out.notional_usd).toBe(1210);
    expect(out.longs_liquidated_usd).toBe(1200);
    expect(out.shorts_liquidated_usd).toBe(10);
    expect(out.by_market[0]).toEqual({ market: "BTC-PERP", count: 2, notional_usd: 1200 });
    expect(out.largest.notional_usd).toBe(1000);
    expect(out.complete).toBe(true);
  });

  it("stops at the page cap and says the result is partial", async () => {
    const page = { data: [liq("BTC-PERP", "sell", "1", "1")], pagination: { has_more: true, next_cursor: "x" } };
    const get = vi.fn().mockResolvedValue(page);
    const out = JSON.parse(await findTool("get_liquidation_summary").handler({}, mockApi({ get })));
    expect(get).toHaveBeenCalledTimes(8);
    expect(out.complete).toBe(false);
  });

  it("rejects windows over 240 minutes", async () => {
    await expect(findTool("get_liquidation_summary").handler({ minutes: 600 }, mockApi())).rejects.toThrow(/240/);
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
