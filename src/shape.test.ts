import { describe, expect, it } from "vitest";
import { shapeMarkets, shapeUserFunding, shapeWalletLabels } from "./shape.js";

describe("shapeMarkets", () => {
  const rows = [
    { display_symbol: "BTC-PERP", base_asset: "BTC", hl_coin: "BTC", issuer: "", market_class: "perp", metadata: { big: "x".repeat(500) } },
    { display_symbol: "xyz:NVDA-PERP", base_asset: "NVDA", hl_coin: "xyz:NVDA", issuer: "xyz", market_class: "perp", metadata: {} },
    { display_symbol: "PURR/USDC", base_asset: "PURR", hl_coin: "@1", issuer: "", market_class: "spot", active_to_ms: 5, metadata: {} },
  ];

  it("passes the API's page through without the bulky metadata", () => {
    const out = shapeMarkets({ data: rows.slice(0, 2), pagination: { next_cursor: "c1", has_more: true, total: 3 } }, { limit: 2 });
    expect(out.data[0]).not.toHaveProperty("metadata");
    expect(out).toMatchObject({ matched: 3, returned: 2, pagination: { next_cursor: "c1", has_more: true, total: 3 } });
  });

  it("keeps active_to_ms on closed markets", () => {
    const out = shapeMarkets({ data: rows, pagination: { next_cursor: null, has_more: false, total: 3 } }, {});
    expect(out.data[2]).toMatchObject({ display_symbol: "PURR/USDC", active_to_ms: 5 });
    expect(out.pagination).toEqual({ next_cursor: null, has_more: false, total: 3 });
  });

  it("searches and limits itself when the API returns the whole registry without pagination", () => {
    expect(shapeMarkets({ data: rows }, { search: "nvda" }).data.map((m) => m.display_symbol)).toEqual(["xyz:NVDA-PERP"]);
    expect(shapeMarkets({ data: rows }, { search: "@1" }).data.map((m) => m.display_symbol)).toEqual(["PURR/USDC"]);
    expect(shapeMarkets({ data: rows }, { search: "XYZ" }).matched).toBe(1);
    const out = shapeMarkets({ data: rows }, { limit: 1 });
    expect(out).toMatchObject({ matched: 3, returned: 1, pagination: { next_cursor: null, has_more: true, total: 3 } });
  });
});

describe("shapeWalletLabels", () => {
  const resp = {
    counts: { whales: 1, smart_money: 1, vaults: 2 },
    labels: {
      "0xAAA": [{ kind: "whale", name: "WHALE · #1" }],
      "0xbbb": [{ kind: "smart_money", name: "SMART MONEY · #1" }],
      "0xccc": [{ kind: "vault", name: "VAULT" }],
      "0xddd": [{ kind: "vault", name: "VAULT" }, { kind: "whale", name: "WHALE · #2" }],
    },
  };
  it("looks up requested addresses in any letter case", () => {
    const out = shapeWalletLabels(resp, { addresses: ["0xaaa", "0xCCC", "0xnone"] });
    expect(Object.keys(out.labels).sort()).toEqual(["0xAAA", "0xccc"]);
  });
  it("without addresses, lists whales and smart money but not plain vaults", () => {
    const out = shapeWalletLabels(resp, {});
    expect(Object.keys(out.labels).sort()).toEqual(["0xAAA", "0xbbb", "0xddd"]);
    expect(out.counts).toEqual(resp.counts);
    expect(out.note).toMatch(/addresses/);
  });
});

describe("shapeUserFunding", () => {
  const resp = {
    address: "0x1",
    data: [
      { bucket_start: 1, market: "A", funding_payment: 1 },
      { bucket_start: 3, market: "B", funding_payment: 2 },
      { bucket_start: 2, market: "C", funding_payment: 3 },
    ],
  };
  it("keeps the most recent rows up to the limit", () => {
    const out = shapeUserFunding(resp, 2);
    expect(out.data.map((r) => r.bucket_start)).toEqual([3, 2]);
    expect(out).toMatchObject({ total_rows: 3, returned: 2, address: "0x1" });
  });
});
