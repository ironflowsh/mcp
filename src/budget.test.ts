import { describe, expect, it } from "vitest";
import { fitToBudget } from "./budget.js";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ i, pad: "x".repeat(50) }));

describe("fitToBudget", () => {
  it("returns small results unchanged, as compact JSON", () => {
    const text = fitToBudget({ a: 1, data: [1, 2] }, 1000);
    expect(text).toBe('{"a":1,"data":[1,2]}');
  });

  it("trims the largest array until the result fits, and says so", () => {
    const text = fitToBudget({ meta: "m", data: rows(1000) }, 5000);
    expect(text.length).toBeLessThanOrEqual(5000);
    const out = JSON.parse(text);
    expect(out.data.length).toBeGreaterThan(0);
    expect(out.data.length).toBeLessThan(1000);
    expect(out.data[0].i).toBe(0); // keeps the head of the list (the ranked top)
    expect(out.truncated).toMatch(/1000/);
    expect(out.meta).toBe("m");
  });

  it("finds arrays nested one level down", () => {
    const text = fitToBudget({ window: { rows: rows(500) } }, 4000);
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(JSON.parse(text).window.rows.length).toBeLessThan(500);
  });

  it("trims large maps (address to labels) too", () => {
    const labels = Object.fromEntries(rows(800).map((r) => [`0x${r.i}`, [r]]));
    const text = fitToBudget({ labels }, 6000);
    expect(text.length).toBeLessThanOrEqual(6000);
    expect(Object.keys(JSON.parse(text).labels).length).toBeLessThan(800);
  });

  it("passes non-object results through", () => {
    expect(fitToBudget("hello", 10)).toBe('"hello"');
  });
});
