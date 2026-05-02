// Unit tests for MCP tool handlers.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { tools } from "./tools.js";
import type { IronflowAPI } from "./api.js";

// ─── Mock API ────────────────────────────────────────────────────────────────

function mockApi(overrides: Partial<Record<keyof IronflowAPI, unknown>> = {}): IronflowAPI {
  return {
    getPrice: vi.fn().mockResolvedValue("67000.50"),
    getOrderbook: vi.fn().mockResolvedValue({ bids: [], asks: [] }),
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
  it("exports 32 tools", () => {
    expect(tools).toHaveLength(32);
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

  it("returns formatted price string", async () => {
    const api = mockApi();
    const result = await tool.handler({ market: "BTC-PERP" }, api);
    expect(result).toBe("BTC-PERP: $67000.50");
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

// ─── get_orderbook ───────────────────────────────────────────────────────────

describe("get_orderbook", () => {
  const tool = findTool("get_orderbook");

  it("returns JSON-encoded orderbook", async () => {
    const api = mockApi({ getOrderbook: vi.fn().mockResolvedValue({ bids: [["49999", "1"]], asks: [] }) });
    const result = await tool.handler({ market: "BTC-PERP" }, api);
    expect(JSON.parse(result)).toEqual({ bids: [["49999", "1"]], asks: [] });
    expect(api.getOrderbook).toHaveBeenCalledWith("BTC-PERP");
  });

  it("throws when market is missing", async () => {
    await expect(tool.handler({}, mockApi())).rejects.toThrow('"market" is required');
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
