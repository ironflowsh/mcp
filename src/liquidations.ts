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

// ─── /v1/liquidations/summary ──────────────────────────────────────────────
// get_liquidation_summary reads the API's summary (since 2026-11-03): totals
// over every liquidation in the window, where adding up pages of raw rows
// here stopped at a page cap and reached 60 minutes without a key.

export const SUMMARY_WINDOWS = ["15m", "1h", "4h", "12h", "24h", "7d"] as const;
export const WINDOW_MINUTES: Record<string, number> = { "15m": 15, "1h": 60, "4h": 240, "12h": 720, "24h": 1440, "7d": 10080 };

interface SummaryTotals {
  long_usd: number;
  short_usd: number;
  liquidations: number;
  wallets: number;
}

interface SummaryLargest {
  market: string;
  side: string;
  usd: number;
  price?: number;
  address: string;
  timestamp: number;
}

export interface LiquidationSummaryResponse {
  as_of: number;
  windows: {
    window: string;
    from: number;
    total: SummaryTotals;
    largest?: SummaryLargest;
    markets: (SummaryTotals & { market: string })[];
  }[];
}

// summaryOutput keeps the tool's earlier output shape (count, notional_usd,
// longs/shorts, by_market, largest, complete) and adds window and wallets.
export function summaryOutput(res: LiquidationSummaryResponse, market: string) {
  const w = res.windows?.[0];
  if (!w) {
    return { window: null, from: null, to: res.as_of ?? null, market: market || null, count: 0, wallets: 0, notional_usd: 0,
      longs_liquidated_usd: 0, shorts_liquidated_usd: 0, by_market: [], largest: null, complete: true };
  }
  const t = w.total;
  return {
    window: w.window,
    from: w.from,
    to: res.as_of,
    market: market || null,
    count: t.liquidations,
    wallets: t.wallets,
    notional_usd: t.long_usd + t.short_usd,
    longs_liquidated_usd: t.long_usd,
    shorts_liquidated_usd: t.short_usd,
    by_market: (w.markets ?? []).slice(0, 10).map((m) => ({ market: m.market, count: m.liquidations, notional_usd: m.long_usd + m.short_usd })),
    largest: w.largest
      ? { market: w.largest.market, side: w.largest.side, notional_usd: w.largest.usd, price: w.largest.price ?? null, address: w.largest.address, timestamp: w.largest.timestamp }
      : null,
    complete: true,
  };
}
