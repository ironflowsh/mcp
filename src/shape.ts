// Reshaping for tools whose raw API responses are far larger than an MCP
// client accepts in one result: market registry pages (HIP-4 metadata blobs),
// wallet labels (every vault address) and per-bucket wallet
// funding. Each keeps what an agent asks for and reports what it left out.

type Row = Record<string, unknown>;

export const DEFAULT_MARKETS_LIMIT = 100;
// A page of 100 shaped markets stays under the 40k-character result budget
// even with long HIP-4 names (about 330 characters a row at most). A larger
// page would be trimmed, and its next_cursor would then skip the trimmed rows.
export const MAX_MARKETS_LIMIT = 100;
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
  "active_to_ms",
] as const;

const pick = (row: Row, keys: readonly string[]): Row =>
  Object.fromEntries(keys.filter((k) => k in row).map((k) => [k, row[k]]));

type MarketsPage = {
  data?: Row[];
  pagination?: { next_cursor?: string | null; has_more?: boolean; total?: number };
};

// shapeMarkets drops the per-market metadata blob (HIP-4 outcomes carry a
// large one) from a page of /v1/markets. The API searches and pages; an API
// that predates q and limit returns the whole registry without pagination,
// and then the search and limit are applied here.
export function shapeMarkets(resp: MarketsPage, opts: { search?: string; limit?: number }) {
  const limit = opts.limit ?? DEFAULT_MARKETS_LIMIT;
  let rows = resp.data ?? [];
  let pagination = resp.pagination;
  if (!pagination) {
    const q = opts.search?.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) =>
        [r.display_symbol, r.base_asset, r.hl_coin, r.issuer].some((v) => String(v ?? "").toLowerCase().includes(q))
      );
    }
    pagination = { next_cursor: null, has_more: rows.length > limit, total: rows.length };
  }
  const data = rows.slice(0, limit).map((r) => pick(r, MARKET_FIELDS));
  return {
    matched: pagination.total ?? data.length,
    returned: data.length,
    data,
    pagination: { next_cursor: pagination.next_cursor ?? null, has_more: Boolean(pagination.has_more), total: pagination.total },
  };
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
