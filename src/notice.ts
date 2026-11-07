// API notices: what an Ironflow API response says beside its body, turned
// into one plain line the agent reads at the top of the tool result.
//
//   X-Ironflow-Market            the symbol a Hyperliquid name resolved to
//                                (market=BTC is served as BTC-PERP)
//   X-Ironflow-History-Clamped   the earliest time served, Unix ms, when
//                                `from` reached past the caller's history
//   X-Ironflow-Notice            a plain-text next step, e.g. where to get
//                                a free key for longer history
//
// The server adds notices of its own the same way, first: an option value it
// read as an allowed one or left out (enumNotice, see enums.ts).

import { type EnumFix, shownValue } from "./enums.js";

const CLAMP_HEADER = "X-Ironflow-History-Clamped";
// Our own API's notices run to about 350 characters; 1000 keeps them whole.
const MAX_HEADER_CHARS = 1000;
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

// enumNotice words one option value the server did not pass on as given:
// the value it was read as, or that it was ignored, and the values the
// option takes, so the agent sends one of them next time.
export function enumNotice(fix: EnumFix): string {
  const given = shownValue(fix.given);
  const allowed = `(allowed: ${fix.allowed.join(", ")})`;
  if (fix.usedAs !== undefined) return `Read ${fix.key} ${given} as ${fix.usedAs} ${allowed}.`;
  if (fix.inList) return `Ignored ${fix.key} ${given} ${allowed}.`;
  return `Ignored ${fix.key} ${given} ${allowed}, so the default applies.`;
}

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
// The API copies its X-Ironflow-Notice header into a JSON body as "notice",
// so a body notice that ours already says is dropped rather than repeated
// (the hosted MCP printed the keyless notice twice until 0.15.2).
export function attachNotice(result: Record<string, unknown>, notice: string): Record<string, unknown> {
  if (!notice) return result;
  const { notice: existing, ...rest } = result;
  if (existing === undefined || typeof existing === "string") {
    if (!existing || sameText(notice).includes(sameText(existing))) return { notice, ...rest };
    return { notice: `${notice} ${existing}`, ...rest };
  }
  return { api_notice: notice, ...result };
}

// sameText compares notices the way formatNotices words them: one space
// between words, the first letter upper case and no closing full stop.
function sameText(s: string): string {
  const t = s.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
