import { describe, expect, it, vi } from "vitest";
import { behaviorSQL, rowsToObjects, runQuery } from "./query.js";
import { IronflowAPI } from "./api.js";

const base = { addresses: [] as string[], label: "", sortBy: "volume" as const, limit: 20, minVolumeUsd: 0 };
const A = "0x" + "ab".repeat(20);

describe("behaviorSQL", () => {
  it("lists wallets by label, sorted and limited", () => {
    const sql = behaviorSQL({ ...base, label: "market_maker", sortBy: "pnl", limit: 5, minVolumeUsd: 1e6 });
    expect(sql).toContain("FROM hl.wallet_behavior");
    expect(sql).toContain("has(labels, 'market_maker')");
    expect(sql).toContain("volume_usd >= 1000000");
    expect(sql).toContain("ORDER BY realized_pnl_usd DESC");
    expect(sql).toMatch(/LIMIT 5$/);
  });

  it("looks up addresses, lowercased", () => {
    const sql = behaviorSQL({ ...base, addresses: [A.toUpperCase().replace("0X", "0x")] });
    expect(sql).toContain(`address IN ('${A}')`);
  });

  it("rejects anything that is not an address", () => {
    expect(() => behaviorSQL({ ...base, addresses: ["0x1' OR 1=1 --"] })).toThrow(/not a wallet address/);
  });

  it("rejects labels outside the fixed list", () => {
    expect(() => behaviorSQL({ ...base, label: "whale') OR ('1" })).toThrow(/label must be one of/);
  });

  it("rejects unknown sort keys and too many addresses", () => {
    expect(() => behaviorSQL({ ...base, sortBy: "volume_usd; DROP" as never })).toThrow(/sort_by/);
    expect(() => behaviorSQL({ ...base, addresses: Array(51).fill(A) })).toThrow(/at most 50/);
  });

  it("caps the limit", () => {
    expect(behaviorSQL({ ...base, limit: 10_000 })).toMatch(/LIMIT 100$/);
  });
});

describe("runQuery", () => {
  it("posts the SQL and returns column names once", async () => {
    const api = new IronflowAPI("https://api.example");
    const post = vi.spyOn(api, "post").mockResolvedValue({
      columns: [{ name: "market", type: "String" }, { name: "n", type: "UInt64" }],
      rows: [["BTC-PERP", 3]],
      row_count: 1, truncated: false, stats: {}, limits: {}, budget_remaining_seconds: 59,
    });
    const res = (await runQuery(api, "SELECT 1", 10)) as { columns: string[]; rows: unknown[][] };
    expect(post).toHaveBeenCalledWith("/v1/query", { sql: "SELECT 1", max_rows: 10 });
    expect(res.columns).toEqual(["market", "n"]);
    expect(rowsToObjects(res)).toEqual([{ market: "BTC-PERP", n: 3 }]);
  });
});
