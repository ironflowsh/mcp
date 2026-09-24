// SQL query tools: run_query passes the caller's SQL to POST /v1/query;
// get_wallet_behavior builds a fixed query over hl.wallet_behavior from
// validated inputs (addresses, a label from a fixed list), so no caller text
// is ever spliced into SQL.

import { IronflowAPI } from "./api.js";

export const BEHAVIOR_LABELS = [
  "market_maker",
  "high_frequency",
  "whale",
  "directional",
  "consistent_winner",
  "big_loser",
  "revenge_sizing",
  "often_liquidated",
  "hip3_trader",
  "spot_trader",
  "prediction_trader",
] as const;

export const BEHAVIOR_SORT_KEYS = ["volume", "pnl", "fills", "liquidations"] as const;
type BehaviorSort = (typeof BEHAVIOR_SORT_KEYS)[number];

const SORT_COLUMN: Record<BehaviorSort, string> = {
  volume: "volume_usd",
  pnl: "realized_pnl_usd",
  fills: "fills",
  liquidations: "liquidations",
};

export const MAX_BEHAVIOR_ADDRESSES = 50;
export const MAX_BEHAVIOR_LIMIT = 100;

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;

export interface BehaviorQuery {
  addresses: string[];
  label: string;
  sortBy: BehaviorSort;
  limit: number;
  minVolumeUsd: number;
}

// behaviorSQL returns the SELECT for get_wallet_behavior. Every input is
// validated here; anything unexpected throws instead of reaching SQL.
export function behaviorSQL(q: BehaviorQuery): string {
  const where: string[] = [];
  if (q.addresses.length > 0) {
    if (q.addresses.length > MAX_BEHAVIOR_ADDRESSES) {
      throw new Error(`at most ${MAX_BEHAVIOR_ADDRESSES} addresses per call`);
    }
    const addrs = q.addresses.map((a) => a.trim().toLowerCase());
    for (const a of addrs) {
      if (!ADDRESS_RE.test(a)) throw new Error(`not a wallet address: ${a}`);
    }
    where.push(`address IN (${addrs.map((a) => `'${a}'`).join(", ")})`);
  }
  if (q.label) {
    if (!(BEHAVIOR_LABELS as readonly string[]).includes(q.label)) {
      throw new Error(`label must be one of: ${BEHAVIOR_LABELS.join(", ")}`);
    }
    where.push(`has(labels, '${q.label}')`);
  }
  if (!Number.isFinite(q.minVolumeUsd) || q.minVolumeUsd < 0) {
    throw new Error("min_volume_usd must be zero or more");
  }
  if (q.minVolumeUsd > 0) where.push(`volume_usd >= ${Math.floor(q.minVolumeUsd)}`);
  const limit = Math.min(Math.max(1, Math.floor(q.limit)), MAX_BEHAVIOR_LIMIT);
  const col = SORT_COLUMN[q.sortBy];
  if (!col) throw new Error(`sort_by must be one of: ${BEHAVIOR_SORT_KEYS.join(", ")}`);
  return [
    "SELECT address, labels, active_days, round(volume_usd) AS volume_usd, fills,",
    "  round(realized_pnl_usd) AS realized_pnl_usd, round(maker_share, 3) AS maker_share,",
    "  round(flow_imbalance, 3) AS flow_imbalance, round(avg_fill_usd) AS avg_fill_usd,",
    "  round(fills_per_day, 1) AS fills_per_day, round(green_day_share, 3) AS green_day_share,",
    "  round(profit_factor, 2) AS profit_factor, markets_traded, liquidations,",
    "  round(revenge_ratio, 2) AS revenge_ratio, as_of",
    "FROM hl.wallet_behavior",
    where.length ? `WHERE ${where.join(" AND ")}` : "",
    `ORDER BY ${col} DESC`,
    `LIMIT ${limit}`,
  ]
    .filter(Boolean)
    .join("\n");
}

interface QueryResponse {
  columns: { name: string; type: string }[];
  rows: unknown[][];
  row_count: number;
  truncated: boolean;
  stats: unknown;
  limits: unknown;
  budget_remaining_seconds: number;
}

// runQuery calls POST /v1/query and returns a compact shape: column names
// once, then positional rows.
export async function runQuery(api: IronflowAPI, sql: string, maxRows: number): Promise<unknown> {
  const res = (await api.post("/v1/query", { sql, max_rows: maxRows })) as QueryResponse;
  return {
    columns: res.columns.map((c) => c.name),
    column_types: res.columns.map((c) => c.type),
    rows: res.rows,
    row_count: res.row_count,
    truncated: res.truncated,
    stats: res.stats,
    limits: res.limits,
    budget_remaining_seconds: res.budget_remaining_seconds,
  };
}

// rowsToObjects turns positional rows into objects keyed by column name,
// for tools whose callers read single wallets.
export function rowsToObjects(result: { columns: string[]; rows: unknown[][] }): Record<string, unknown>[] {
  return result.rows.map((r) => Object.fromEntries(result.columns.map((c, i) => [c, r[i]])));
}
