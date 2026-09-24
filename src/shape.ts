// Reshaping for tools whose raw API responses are far larger than an MCP
// client accepts in one result: the market registry (about 9M characters with
// HIP-4 metadata), wallet labels (every vault address) and per-bucket wallet
// funding. Each keeps what an agent asks for and reports what it left out.

type Row = Record<string, unknown>;

export const DEFAULT_MARKETS_LIMIT = 100;
export const DEFAULT_FUNDING_ROWS = 200;

const MARKET_FIELDS = [
  "market_id",
  "display_symbol",
  "market_class",
  "issuer",
  "base_asset",
  "quote_asset",
  "base_market",
  "hl_coin",
  "max_leverage",
  "active_from_ms",
] as const;

const pick = (row: Row, keys: readonly string[]): Row =>
  Object.fromEntries(keys.filter((k) => k in row).map((k) => [k, row[k]]));

// shapeMarkets filters the registry by a case-insensitive search over the
// symbol, base asset and Hyperliquid coin, drops the per-market metadata blob
// and keeps the first `limit` rows.
export function shapeMarkets(resp: { data?: Row[] }, opts: { search?: string; limit?: number }) {
  const rows = resp.data ?? [];
  const q = opts.search?.trim().toLowerCase();
  const matched = q
    ? rows.filter((r) =>
        [r.display_symbol, r.base_asset, r.hl_coin].some((v) => String(v ?? "").toLowerCase().includes(q))
      )
    : rows;
  const data = matched.slice(0, opts.limit ?? DEFAULT_MARKETS_LIMIT).map((r) => pick(r, MARKET_FIELDS));
  return { total_markets: rows.length, matched: matched.length, returned: data.length, data };
}

const LISTED_KINDS = new Set(["whale", "smart_money"]);

// shapeWalletLabels returns labels for the requested addresses, or, without
// addresses, every whale and smart-money wallet (plain vault entries run into
// the thousands and are left out).
export function shapeWalletLabels(
  resp: { counts?: unknown; labels?: Record<string, Row[]> } & Row,
  opts: { addresses?: string[] }
) {
  const labels = resp.labels ?? {};
  const wanted = opts.addresses?.map((a) => a.toLowerCase());
  const keep = wanted
    ? Object.entries(labels).filter(([addr]) => wanted.includes(addr.toLowerCase()))
    : Object.entries(labels).filter(([, ls]) => ls.some((l) => LISTED_KINDS.has(String(l.kind))));
  return {
    counts: resp.counts,
    labels: Object.fromEntries(keep),
    note: wanted
      ? "Addresses without an entry have no label."
      : "Whales and smart money only. Pass addresses to check any wallet, including vaults and vault leaders.",
  };
}

// shapeUserFunding keeps the most recent `limit` funding rows.
export function shapeUserFunding(resp: { data?: Row[] } & Row, limit = DEFAULT_FUNDING_ROWS) {
  const rows = [...(resp.data ?? [])].sort((a, b) => Number(b.bucket_start ?? 0) - Number(a.bucket_start ?? 0));
  const data = rows.slice(0, limit);
  return { ...resp, total_rows: rows.length, returned: data.length, data };
}
