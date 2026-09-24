// Ranking for get_markets_snapshot. The API returns every active market
// (about 140k characters for perps alone), more than MCP clients accept in one
// tool result, so the tool sorts, filters and trims before answering.

export const SORT_KEYS = ["volume", "open_interest", "funding", "abs_funding", "change_24h", "abs_change_24h"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 200;

type Row = Record<string, unknown>;

export interface RankOptions {
  sortBy?: SortKey;
  order?: "asc" | "desc";
  limit?: number;
  minVolumeUsd?: number;
}

export interface RankedSnapshot {
  sort_by: SortKey;
  order: "asc" | "desc";
  total_markets: number;
  matched: number;
  returned: number;
  data: Row[];
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

// sortValue maps a row to the number it is ranked by.
const sortValue: Record<SortKey, (r: Row) => number> = {
  volume: (r) => num(r.volume_24h_usd),
  open_interest: (r) => num(r.open_interest_usd),
  funding: (r) => num(r.funding_rate),
  abs_funding: (r) => Math.abs(num(r.funding_rate)),
  change_24h: (r) => num(r.change_24h_pct),
  abs_change_24h: (r) => Math.abs(num(r.change_24h_pct)),
};

// rankSnapshot filters rows by 24h volume, sorts them and keeps the top
// `limit`. total_markets counts every row; matched counts rows past the
// volume floor.
export function rankSnapshot(rows: Row[], opts: RankOptions): RankedSnapshot {
  const sortBy = opts.sortBy ?? "volume";
  if (!SORT_KEYS.includes(sortBy)) {
    throw new Error(`"sort_by" must be one of ${SORT_KEYS.join(", ")}`);
  }
  const order = opts.order ?? "desc";
  const limit = opts.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`"limit" must be between 1 and ${MAX_LIMIT}`);
  }
  const floor = opts.minVolumeUsd ?? 0;
  const value = sortValue[sortBy];
  const matched = rows.filter((r) => num(r.volume_24h_usd) >= floor);
  const sorted = [...matched].sort((a, b) => (order === "desc" ? value(b) - value(a) : value(a) - value(b)));
  const data = sorted.slice(0, limit);
  return { sort_by: sortBy, order, total_markets: rows.length, matched: matched.length, returned: data.length, data };
}
