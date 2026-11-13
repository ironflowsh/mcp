import { describe, expect, it } from "vitest";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { getPrompt, listPrompts, prompts } from "./prompts.js";
import { toolsFor } from "./tools.js";

const text = (name: string, args?: Record<string, string>): string => getPrompt(name, args).messages[0].content.text;

describe("prompts", () => {
  it("lists four starts without their text builders", () => {
    const listed = listPrompts();
    expect(listed.map((p) => p.name)).toEqual(["biggest_liquidations", "liquidation_map", "market_movers", "wallet_check"]);
    for (const p of listed) {
      expect(p.title.trim(), p.name).toBeTruthy();
      expect(p.description, p.name).toMatch(/Hyperliquid/);
      expect(p).not.toHaveProperty("text");
    }
  });

  it("asks only for tools the data toolset serves", () => {
    const data = new Set(toolsFor("data").map((t) => t.name));
    for (const p of prompts) {
      const named = text(p.name, { market: "ETH", address: "0x0000000000000000000000000000000000000001" }).match(/\b(get|list|describe|run)_[a-z_]+/g) ?? [];
      expect(named.length, p.name).toBeGreaterThan(0);
      for (const tool of named) expect(data.has(tool), `${p.name}: ${tool}`).toBe(true);
    }
  });

  it("sells nothing and uses no em dash", () => {
    const sells = /x402|pay[- ]per[- ]call|upgrade|free key|ironflow\.sh\/key|Ironbox|alert/i;
    for (const p of prompts) {
      const all = JSON.stringify(p) + text(p.name, { address: "0x1" });
      expect(all, p.name).not.toMatch(sells);
      expect(all, p.name).not.toContain("—");
    }
  });

  it("fills in the market, with BTC as the map default", () => {
    expect(text("liquidation_map")).toContain("get_liquidation_map with market BTC");
    expect(text("liquidation_map", { market: " xyz:NVDA " })).toContain("get_liquidation_map with market xyz:NVDA.");
    expect(text("biggest_liquidations")).toContain("window 24h for the totals");
    expect(text("biggest_liquidations", { market: "SOL" })).toContain("window 24h and market SOL");
  });

  it("keeps an argument short", () => {
    expect(text("liquidation_map", { market: "B".repeat(500) })).toContain(`market ${"B".repeat(100)}.`);
  });

  it("refuses an unknown prompt or a missing address as invalid params", () => {
    expect(() => getPrompt("nope", {})).toThrow(McpError);
    expect(() => getPrompt("nope", {})).toThrow(/Unknown prompt: nope/);
    expect(() => getPrompt("wallet_check", {})).toThrow(/wallet_check needs address/);
    expect(() => getPrompt("wallet_check", { address: "  " })).toThrow(McpError);
    expect(text("wallet_check", { address: "0xabc" })).toContain("Check the Hyperliquid wallet 0xabc.");
  });
});
