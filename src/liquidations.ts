// Liquidation summary across all Hyperliquid markets. The REST feed returns
// raw rows (up to 1000 per page); an agent asking "who got liquidated in the
// last hour" needs totals, so the MCP pages through and aggregates.

import type { IronflowAPI } from "./api.js";

export const MAX_SUMMARY_MINUTES = 240; // API cap for queries without a market
export const MAX_SUMMARY_PAGES = 8;
const PAGE_SIZE = "1000";
const TOP_MARKETS = 10;

interface LiquidationRow {
  display_symbol?: string;
  market?: string;
  side: string; // the liquidated wallet's fill side: "sell" closes a long
  price: string;
  size: string;
  address: string;
  timestamp: number;
}

interface Page {
  data?: LiquidationRow[];
  pagination?: { has_more?: boolean; next_cursor?: string };
}

export interface LiquidationSummary {
  from: number;
  to: number;
  market: string | null;
  count: number;
  notional_usd: number;
  longs_liquidated_usd: number;
  shorts_liquidated_usd: number;
  by_market: { market: string; count: number; notional_usd: number }[];
  largest: { market: string; side: "long" | "short"; notional_usd: number; price: number; address: string; timestamp: number } | null;
  complete: boolean;
}

const round = (n: number) => Math.round(n * 100) / 100;

// summarizeLiquidations fetches every liquidation in the window (up to
// MAX_SUMMARY_PAGES pages) and returns totals. complete=false means the page
// cap was hit and the totals are a lower bound.
export async function summarizeLiquidations(
  api: IronflowAPI,
  minutes: number,
  market: string,
  now = Date.now()
): Promise<LiquidationSummary> {
  const from = now - minutes * 60_000;
  const byMarket = new Map<string, { count: number; notional: number }>();
  let count = 0;
  let longs = 0;
  let shorts = 0;
  let largest: LiquidationSummary["largest"] = null;
  let cursor = "";
  let complete = false;

  for (let page = 0; page < MAX_SUMMARY_PAGES; page++) {
    const params: Record<string, string> = { from: String(from), to: String(now), limit: PAGE_SIZE };
    if (market) params.market = market;
    if (cursor) params.cursor = cursor;
    const resp = (await api.get("/v1/liquidations", params)) as Page;

    for (const row of resp.data ?? []) {
      const notional = Number(row.price) * Number(row.size);
      if (!Number.isFinite(notional)) continue;
      const name = row.display_symbol || row.market || "?";
      const isLong = row.side === "sell";
      count++;
      if (isLong) longs += notional;
      else shorts += notional;
      const agg = byMarket.get(name) ?? { count: 0, notional: 0 };
      agg.count++;
      agg.notional += notional;
      byMarket.set(name, agg);
      if (!largest || notional > largest.notional_usd) {
        largest = {
          market: name,
          side: isLong ? "long" : "short",
          notional_usd: round(notional),
          price: Number(row.price),
          address: row.address,
          timestamp: row.timestamp,
        };
      }
    }

    const next = resp.pagination?.next_cursor;
    if (!resp.pagination?.has_more || !next) {
      complete = true;
      break;
    }
    cursor = next;
  }

  return {
    from,
    to: now,
    market: market || null,
    count,
    notional_usd: round(longs + shorts),
    longs_liquidated_usd: round(longs),
    shorts_liquidated_usd: round(shorts),
    by_market: [...byMarket.entries()]
      .sort((a, b) => b[1].notional - a[1].notional)
      .slice(0, TOP_MARKETS)
      .map(([m, a]) => ({ market: m, count: a.count, notional_usd: round(a.notional) })),
    largest,
    complete,
  };
}
