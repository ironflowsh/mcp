import { describe, expect, it } from "vitest";
import { rankSnapshot } from "./snapshot.js";

const row = (sym: string, funding: number, vol: number, chg = 0, oi = 0) => ({
  display_symbol: sym,
  funding_rate: funding,
  volume_24h_usd: vol,
  change_24h_pct: chg,
  open_interest_usd: oi,
});
const rows = [
  row("BTC-PERP", 0.0000125, 4e9, -0.03, 2e9),
  row("xyz:SOFTBANK-PERP", -0.00065, 2e6, 0.01, 4e6),
  row("para:TREAD-PERP", 0.00038, 1e5, 0.2, 3e5),
  row("ETH-PERP", 0.0000125, 1.5e9, -0.04, 1e9),
];

describe("rankSnapshot", () => {
  it("defaults to the 25 highest-volume markets", () => {
    const out = rankSnapshot(rows, {});
    expect(out.data.map((r) => r.display_symbol)).toEqual(["BTC-PERP", "ETH-PERP", "xyz:SOFTBANK-PERP", "para:TREAD-PERP"]);
    expect(out.total_markets).toBe(4);
    expect(out.sort_by).toBe("volume");
  });

  it("ranks by absolute funding for 'most extreme funding'", () => {
    const out = rankSnapshot(rows, { sortBy: "abs_funding", limit: 2 });
    expect(out.data.map((r) => r.display_symbol)).toEqual(["xyz:SOFTBANK-PERP", "para:TREAD-PERP"]);
    expect(out.returned).toBe(2);
  });

  it("sorts ascending when asked (most negative funding first)", () => {
    const out = rankSnapshot(rows, { sortBy: "funding", order: "asc", limit: 1 });
    expect(out.data[0].display_symbol).toBe("xyz:SOFTBANK-PERP");
  });

  it("drops markets under a volume floor before ranking", () => {
    const out = rankSnapshot(rows, { sortBy: "abs_funding", minVolumeUsd: 1e6 });
    expect(out.data.map((r) => r.display_symbol)).not.toContain("para:TREAD-PERP");
    expect(out.total_markets).toBe(4);
    expect(out.matched).toBe(3);
  });

  it("treats string numbers from the API as numbers", () => {
    const out = rankSnapshot([{ display_symbol: "A", funding_rate: "-0.001", volume_24h_usd: "5" }, row("B", 0.0001, 10)], {
      sortBy: "abs_funding",
    });
    expect(out.data[0].display_symbol).toBe("A");
  });

  it("rejects unknown sort keys and out-of-range limits", () => {
    expect(() => rankSnapshot(rows, { sortBy: "nope" as never })).toThrow(/sort_by/);
    expect(() => rankSnapshot(rows, { limit: 0 })).toThrow(/limit/);
    expect(() => rankSnapshot(rows, { limit: 500 })).toThrow(/limit/);
  });
});
