import { describe, expect, it } from "vitest";
import { attachNotice, enumNotice, formatNotices, readNotice } from "./notice.js";

const KEYLESS_NOTICE =
  "keyless access reaches 24 hours back, so data starts at X-Ironflow-History-Clamped. A free key reaches 14 days: https://ironflow.sh/key";

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
    const n = readNotice(new Headers({ "X-Ironflow-Notice": `a\tb${"x".repeat(3000)}` }));
    expect(n?.notice).toMatch(/^a b/);
    expect(n?.notice?.length).toBeLessThanOrEqual(1000);
  });
});

describe("formatNotices", () => {
  it("writes the clamp time into the API's notice, which names a header the agent never sees", () => {
    const text = formatNotices([{ historyClampedMs: 1793232000000, notice: KEYLESS_NOTICE }]);
    expect(text).toBe(
      "Keyless access reaches 24 hours back, so data starts at 2026-10-29T00:00:00Z (1793232000000). A free key reaches 14 days: https://ironflow.sh/key"
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

  it("does not repeat a body notice that ours already says", () => {
    const api = "keyless sample: the 10 busiest price levels. A free key returns every level: https://ironflow.sh/key";
    const ours = formatNotices([{ notice: api }]);
    expect(attachNotice({ notice: api, data: [] }, ours).notice).toBe(ours);
    const withMarket = formatNotices([{ requestedMarket: "BTC", market: "BTC-PERP", notice: api }]);
    expect(attachNotice({ notice: api }, withMarket).notice).toBe(withMarket);
  });

  it("keeps a notice the result already had", () => {
    expect(attachNotice({ notice: "theirs" }, "ours").notice).toBe("ours theirs");
    expect(attachNotice({ notice: { x: 1 } }, "ours")).toEqual({ api_notice: "ours", notice: { x: 1 } });
  });
});

describe("enumNotice", () => {
  const allowed = ["1h", "4h", "24h", "7d"];

  it("names the ignored value and the allowed ones", () => {
    expect(enumNotice({ key: "window", given: "__outside_enum__", allowed })).toBe(
      'Ignored window "__outside_enum__" (allowed: 1h, 4h, 24h, 7d), so the default applies.'
    );
  });

  it("says what a value was read as", () => {
    expect(enumNotice({ key: "window", given: "1d", allowed, usedAs: "24h" })).toBe('Read window "1d" as 24h (allowed: 1h, 4h, 24h, 7d).');
  });

  it("drops the default for one entry of a list", () => {
    expect(enumNotice({ key: "markets", given: "futures", allowed: ["perps", "spot"], inList: true })).toBe(
      'Ignored markets "futures" (allowed: perps, spot).'
    );
  });

  it("shows a long or non-string value short and quoted", () => {
    const long = enumNotice({ key: "window", given: `"${"x".repeat(100)}\n`, allowed });
    expect(long).toMatch(/^Ignored window "\\"x{39}\.\.\." \(allowed/);
    expect(enumNotice({ key: "window", given: 24, allowed })).toMatch(/^Ignored window "24" /);
    expect(enumNotice({ key: "sort", given: { by: "usd" }, allowed: ["usd", "pct"] })).toMatch(/^Ignored sort "\{\\"by\\":\\"usd\\"\}" /);
  });

  it("goes through formatNotices with the API's notices, each once", () => {
    const ours = enumNotice({ key: "window", given: "1d", allowed, usedAs: "24h" });
    expect(formatNotices([{ notice: ours }, { notice: ours }, { requestedMarket: "BTC", market: "BTC-PERP" }])).toBe(
      `${ours} Market "BTC" was read as BTC-PERP.`
    );
  });
});
