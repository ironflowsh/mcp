// API notices: what an Ironflow API response says beside its body, turned
// into one plain line the agent reads at the top of the tool result.
//
//   X-Ironflow-Market            the symbol a Hyperliquid name resolved to
//                                (market=BTC is served as BTC-PERP)
//   X-Ironflow-History-Clamped   the earliest time served, Unix ms, when
//                                `from` reached past the caller's history
//   X-Ironflow-Notice            a plain-text next step, e.g. where to get
//                                a free key for longer history

const CLAMP_HEADER = "X-Ironflow-History-Clamped";
const MAX_HEADER_CHARS = 400;
const MAX_NOTICE_CHARS = 1200;

export interface ApiNotice {
  requestedMarket?: string;
  market?: string;
  historyClampedMs?: number;
  notice?: string;
}

// clean keeps a header value printable and short: it is our own API's text,
// but it lands in the model's context, so no control characters or walls.
function clean(value: string | null): string | undefined {
  const v = (value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return v ? v.slice(0, MAX_HEADER_CHARS) : undefined;
}

// readNotice returns what a response's headers say, or undefined when they
// say nothing.
export function readNotice(headers: Headers, requestedMarket?: string): ApiNotice | undefined {
  const market = clean(headers.get("x-ironflow-market"));
  const clamped = Number(headers.get("x-ironflow-history-clamped"));
  const notice = clean(headers.get("x-ironflow-notice"));
  const out: ApiNotice = {};
  if (market) {
    out.market = market;
    const asked = clean(requestedMarket ?? null);
    if (asked && asked !== market) out.requestedMarket = asked;
  }
  if (Number.isFinite(clamped) && clamped > 0) out.historyClampedMs = Math.floor(clamped);
  if (notice) out.notice = notice;
  return Object.keys(out).length > 0 ? out : undefined;
}

// Whole seconds; the exact Unix ms is written beside it.
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const sentence = (s: string): string => {
  const t = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?]$/.test(t) || /https?:\/\/\S+$/.test(t) ? t : `${t}.`;
};

// noticeLines words one response's notice for the agent. The API's notice
// names the clamp header; the agent never sees headers, so the time it
// carries is written in instead.
function noticeLines(n: ApiNotice): string[] {
  const lines: string[] = [];
  if (n.market) {
    lines.push(n.requestedMarket ? `Market "${n.requestedMarket}" was read as ${n.market}.` : `Market: ${n.market}.`);
  }
  const start = n.historyClampedMs ? `${iso(n.historyClampedMs)} (${n.historyClampedMs})` : "";
  if (n.notice) {
    lines.push(sentence(start ? n.notice.split(CLAMP_HEADER).join(start) : n.notice));
  } else if (start) {
    lines.push(`Data starts at ${start}, later than the requested from: that is as far back as this key reaches.`);
  }
  return lines;
}

// formatNotices joins the notices of every API call one tool made into one
// line, each distinct sentence once ("" when there is nothing to say).
export function formatNotices(notices: ApiNotice[]): string {
  const seen = new Set<string>();
  for (const n of notices) for (const line of noticeLines(n)) seen.add(line);
  return [...seen].join(" ").slice(0, MAX_NOTICE_CHARS);
}

// attachNotice puts the notice first in a tool result, where an agent reads
// it before the data. A result that already has a string notice keeps it,
// after ours.
export function attachNotice(result: Record<string, unknown>, notice: string): Record<string, unknown> {
  if (!notice) return result;
  const { notice: existing, ...rest } = result;
  if (existing === undefined || typeof existing === "string") {
    return { notice: existing ? `${notice} ${existing}` : notice, ...rest };
  }
  return { api_notice: notice, ...result };
}
