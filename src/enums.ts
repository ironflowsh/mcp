// Option values outside a tool's list. An input schema lists the values an
// option takes (window: 1h, 4h, 24h, 7d), and clients still send others: a
// value the user typed ("1d", "week") or a probe of whether the schema is
// enforced ("__outside_enum__"). Passed on, the API answers 400
// INVALID_PARAMETER and the agent gets nothing, so the server reads an
// obvious equivalent as the allowed value ("1d" as 24h), leaves anything else
// out so the tool's default applies, and says which in the result's notice.

// EnumFix is one option value the server did not pass on as given.
export interface EnumFix {
  key: string;
  given: unknown;
  allowed: readonly string[];
  // The allowed value it was read as; undefined when it was left out.
  usedAs?: string;
  // Set when the value was one entry of a list option (markets: [...]).
  inList?: boolean;
}

// The part of a tool's input schema fitEnums reads.
export interface EnumSchema {
  properties: Record<string, { type?: string; enum?: readonly string[]; items?: { enum?: readonly string[] } }>;
  required?: readonly string[];
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

const UNITS: Record<string, number> = {
  m: MINUTE, min: MINUTE, mins: MINUTE, minute: MINUTE, minutes: MINUTE,
  h: HOUR, hr: HOUR, hrs: HOUR, hour: HOUR, hours: HOUR, hourly: HOUR,
  d: DAY, day: DAY, days: DAY, daily: DAY,
  w: WEEK, wk: WEEK, wks: WEEK, week: WEEK, weeks: WEEK, weekly: WEEK,
  mo: MONTH, month: MONTH, months: MONTH, monthly: MONTH,
};

// "1M" means a month in charting tools and a minute elsewhere, so it is
// never read as either.
const AMBIGUOUS = /^\d*\s*M$/;

// durationMs reads a window or interval written any common way (1d, 24h,
// 60m, 15min, 1 week, week, daily, -7d, last 30 days) as milliseconds.
function durationMs(value: string): number | undefined {
  const m = /^(?:(?:last|past)\s+)?-?(\d+(?:\.\d+)?)?\s*([a-z]+)$/i.exec(value.trim());
  const unit = m ? UNITS[m[2].toLowerCase()] : undefined;
  if (!m || !unit) return undefined;
  const n = m[1] === undefined ? 1 : Number(m[1]);
  return n > 0 ? n * unit : undefined;
}

// Other words for an allowed value, by compact form. Only the ones that can
// mean nothing else; each is used only where its target is allowed.
const SYNONYMS: Record<string, readonly string[]> = {
  all: ["any", "both"],
  any: ["both"],
  both: ["any"],
  ascending: ["asc"],
  descending: ["desc"],
  percent: ["pct"],
  percentage: ["pct"],
  pnl: ["realized_pnl"],
  realizedpnl: ["pnl"],
  realisedpnl: ["realized_pnl", "pnl"],
  perpetual: ["perp", "perps"],
  outcome: ["prediction", "outcomes"],
  hip4: ["prediction", "outcomes"],
};

// compact drops case and separators: "Market Maker", "market-maker" and
// "MARKET_MAKER" are all marketmaker.
const compact = (s: string): string => s.trim().toLowerCase().replace(/[\s_-]+/g, "");

// closestAllowed returns the allowed value that value obviously means, or
// undefined when none does. Obvious: the same word in another case or
// spelling (PERP, low-risk, longs), a plain synonym (descending, all), or
// the same length of time (1d for 24h, week for 7d). A different length of
// time is not obvious (2h is neither 1h nor 4h), so it is left out.
export function closestAllowed(value: string, allowed: readonly string[]): string | undefined {
  const c = compact(value);
  if (!c || AMBIGUOUS.test(value.trim())) return undefined;
  // The word itself, then its singular or plural.
  const forms = [c, c.replace(/s$/, ""), c.replace(/es$/, ""), `${c}s`];
  for (const f of forms) {
    const hit = allowed.find((a) => compact(a) === f);
    if (hit) return hit;
  }
  for (const f of forms) {
    const hit = SYNONYMS[f]?.find((s) => allowed.includes(s));
    if (hit) return hit;
  }
  const ms = durationMs(value);
  return ms === undefined ? undefined : allowed.find((a) => durationMs(a) === ms);
}

// fitOne reads one given value against allowed: undefined when it cannot
// be read as one of them.
function fitOne(given: unknown, allowed: readonly string[]): string | undefined {
  return typeof given === "string" || typeof given === "number" ? closestAllowed(String(given), allowed) : undefined;
}

// fitEnums checks every option with a list of values (enum, or items.enum
// for a list option) and returns the arguments to call the tool with, and
// what it changed. A value in the list passes as sent; one that obviously
// means an allowed value is replaced by it; anything else is left out, so
// the tool's default applies. A blank value is left out without a fix: the
// tools read it as not set. A required option has no default, so a value
// that cannot be read throws an error naming the allowed values.
export function fitEnums(schema: EnumSchema, args: Record<string, unknown>): { args: Record<string, unknown>; fixes: EnumFix[] } {
  const out = { ...args };
  const fixes: EnumFix[] = [];
  const required = (key: string, allowed: readonly string[]): Error =>
    new Error(`"${key}" must be one of ${allowed.join(", ")}`);

  for (const [key, prop] of Object.entries(schema.properties)) {
    const value = out[key];
    if (value === undefined || value === null) continue;

    if (prop.enum) {
      const allowed = prop.enum;
      if (typeof value === "string" && allowed.includes(value)) continue;
      if (typeof value === "string" && value.trim() === "") {
        delete out[key];
        continue;
      }
      const usedAs = fitOne(value, allowed);
      if (usedAs === undefined && schema.required?.includes(key)) throw required(key, allowed);
      if (usedAs === undefined) delete out[key];
      else out[key] = usedAs;
      fixes.push({ key, given: value, allowed, usedAs });
      continue;
    }

    const allowed = prop.type === "array" ? prop.items?.enum : undefined;
    if (!allowed) continue;
    // A list option: agents send a list or a comma-separated string.
    const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : undefined;
    if (!list) continue;
    const kept: string[] = [];
    const listFixes: EnumFix[] = [];
    for (const entry of list) {
      if (typeof entry === "string" && entry.trim() === "") continue;
      if (typeof entry === "string" && allowed.includes(entry.trim())) {
        kept.push(entry.trim());
        continue;
      }
      const usedAs = fitOne(entry, allowed);
      if (usedAs !== undefined) kept.push(usedAs);
      listFixes.push({ key, given: entry, allowed, usedAs, inList: true });
    }
    // A list whose entries are all allowed passes as sent.
    if (listFixes.length === 0) continue;
    if (kept.length === 0 && schema.required?.includes(key)) throw required(key, allowed);
    if (kept.length > 0) out[key] = [...new Set(kept)];
    else delete out[key];
    fixes.push(...listFixes);
  }
  return { args: out, fixes };
}
