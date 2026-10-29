import { describe, expect, it } from "vitest";
import { attachNotice, formatNotices, readNotice } from "./notice.js";

const KEYLESS_NOTICE =
  "keyless access reaches 24 hours back, so data starts at X-Ironflow-History-Clamped. A free key reaches 30 days: https://ironflow.sh/key";

describe("readNotice", () => {
  it("reads the three notice headers", () => {
    const h = new Headers({
      "X-Ironflow-Market": "BTC-PERP",
      "X-Ironflow-History-Clamped": "1793232000000",
      "X-Ironflow-Notice": KEYLESS_NOTICE,
    });
    expect(readNotice(h, "btc")).toEqual({
      requestedMarket: "btc",
      market: "BTC-PERP",
      historyClampedMs: 1793232000000,
      notice: KEYLESS_NOTICE,
    });
  });

  it("returns undefined when the response says nothing", () => {
    expect(readNotice(new Headers({ "content-type": "application/json" }))).toBeUndefined();
  });

  it("strips control characters and caps the length", () => {
    const n = readNotice(new Headers({ "X-Ironflow-Notice": `a\tb${"x".repeat(1000)}` }));
    expect(n?.notice).toMatch(/^a b/);
    expect(n?.notice?.length).toBeLessThanOrEqual(400);
  });
});

describe("formatNotices", () => {
  it("writes the clamp time into the API's notice, which names a header the agent never sees", () => {
    const text = formatNotices([{ historyClampedMs: 1793232000000, notice: KEYLESS_NOTICE }]);
    expect(text).toBe(
      "Keyless access reaches 24 hours back, so data starts at 2026-10-29T00:00:00Z (1793232000000). A free key reaches 30 days: https://ironflow.sh/key"
    );
    expect(text).not.toContain("X-Ironflow");
  });

  it("says how a Hyperliquid name was read", () => {
    expect(formatNotices([{ requestedMarket: "BTC", market: "BTC-PERP" }])).toBe('Market "BTC" was read as BTC-PERP.');
  });

  it("explains a clamp that comes without notice text", () => {
    expect(formatNotices([{ historyClampedMs: 1793232000000 }])).toMatch(/^Data starts at 2026-10-29T00:00:00Z/);
  });

  it("says each thing once across the pages of one tool call", () => {
    const page = { requestedMarket: "BTC", market: "BTC-PERP" };
    expect(formatNotices([page, page, page])).toBe('Market "BTC" was read as BTC-PERP.');
    expect(formatNotices([])).toBe("");
  });
});

describe("attachNotice", () => {
  it("puts the notice first and leaves the result otherwise untouched", () => {
    const out = attachNotice({ data: [1], pagination: { has_more: false } }, "Market \"BTC\" was read as BTC-PERP.");
    expect(Object.keys(out)).toEqual(["notice", "data", "pagination"]);
    expect(out.data).toEqual([1]);
  });

  it("returns the result as is without a notice", () => {
    const result = { data: [] };
    expect(attachNotice(result, "")).toBe(result);
  });

  it("keeps a notice the result already had", () => {
    expect(attachNotice({ notice: "theirs" }, "ours").notice).toBe("ours theirs");
    expect(attachNotice({ notice: { x: 1 } }, "ours")).toEqual({ api_notice: "ours", notice: { x: 1 } });
  });
});
