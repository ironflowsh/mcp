import { describe, expect, it } from "vitest";
import { callerHash, clientFromInitialize, sanitizeClientApp, summarizeArgs } from "./usage.js";

describe("sanitizeClientApp", () => {
  it("keeps plain app names", () => {
    expect(sanitizeClientApp("claude-ai/0.1.0")).toBe("claude-ai/0.1.0");
    expect(sanitizeClientApp("Cursor (vscode)/1.2")).toBe("Cursor (vscode)/1.2");
  });
  it("drops anything with control or quote characters", () => {
    expect(sanitizeClientApp("bad\nname")).toBe("");
    expect(sanitizeClientApp('a"b')).toBe("");
  });
  it("truncates to 64 characters", () => {
    expect(sanitizeClientApp("x".repeat(100))).toHaveLength(64);
  });
  it("is empty for missing input", () => {
    expect(sanitizeClientApp(undefined)).toBe("");
  });
});

describe("clientFromInitialize", () => {
  it("reads clientInfo from an initialize request", () => {
    const body = { jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "claude-ai", version: "0.1.0" } } };
    expect(clientFromInitialize(body)).toBe("claude-ai/0.1.0");
  });
  it("is empty for other methods", () => {
    expect(clientFromInitialize({ method: "tools/list" })).toBe("");
  });
  it("handles batches", () => {
    expect(clientFromInitialize([{ method: "initialize", params: { clientInfo: { name: "cursor" } } }])).toBe("cursor");
  });
});

describe("callerHash", () => {
  it("is stable for the same IP and salt and 16 hex characters", () => {
    const h = callerHash("85.137.93.255", "salt");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(callerHash("85.137.93.255", "salt")).toBe(h);
  });
  it("changes with the salt", () => {
    expect(callerHash("85.137.93.255", "a")).not.toBe(callerHash("85.137.93.255", "b"));
  });
  it("is empty without an IP", () => {
    expect(callerHash(undefined, "salt")).toBe("");
  });
});

describe("summarizeArgs", () => {
  it("returns the tool arguments as compact JSON", () => {
    const body = { method: "tools/call", params: { name: "get_funding_rates", arguments: { market: "BTC-PERP" } } };
    expect(summarizeArgs(body)).toBe('{"market":"BTC-PERP"}');
  });
  it("truncates long arguments such as SQL", () => {
    const body = { method: "tools/call", params: { name: "run_query", arguments: { sql: "SELECT ".repeat(200) } } };
    expect(summarizeArgs(body).length).toBe(600);
  });
  it("is empty for calls without arguments and for other methods", () => {
    expect(summarizeArgs({ method: "tools/call", params: { name: "get_status" } })).toBe("");
    expect(summarizeArgs({ method: "tools/list" })).toBe("");
  });
});
