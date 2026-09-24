// Size budget for tool results. MCP clients cap a single tool result (Claude
// Code at about 25k tokens, roughly 75k characters of JSON) and fail the call
// when it is larger, so a broad query would return nothing at all. Results are
// sent as compact JSON, and anything still over budget has its largest list
// or map trimmed from the end (lists are ranked, so the head is kept) with a
// note telling the model how to narrow the query.

export const MAX_RESULT_CHARS = 60_000;

type Container = { owner: Record<string, unknown>; key: string; path: string; size: number };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// collections lists the arrays and maps at the root and one level down.
function collections(root: Record<string, unknown>): Container[] {
  const out: Container[] = [];
  const visit = (owner: Record<string, unknown>, prefix: string, depth: number) => {
    for (const [key, v] of Object.entries(owner)) {
      if (Array.isArray(v) || isPlainObject(v)) {
        out.push({ owner, key, path: prefix + key, size: JSON.stringify(v).length });
      }
      if (isPlainObject(v) && depth === 0) visit(v, `${prefix}${key}.`, 1);
    }
  };
  visit(root, "", 0);
  return out;
}

const countOf = (v: unknown): number => (Array.isArray(v) ? v.length : Object.keys(v as object).length);

function keepFirst(v: unknown, n: number): unknown {
  if (Array.isArray(v)) return v.slice(0, n);
  return Object.fromEntries(Object.entries(v as object).slice(0, n));
}

// fitToBudget serializes value as compact JSON no longer than maxChars when
// trimming can get it there.
export function fitToBudget(value: unknown, maxChars = MAX_RESULT_CHARS): string {
  let text = JSON.stringify(value);
  if (text.length <= maxChars || !isPlainObject(value)) return text;

  const root = { ...value };
  const trimmed = new Map<string, { from: number; to: number }>();
  for (let round = 0; round < 30 && text.length > maxChars; round++) {
    // The largest collection that still has something to cut.
    const target = collections(root)
      .filter((c) => countOf(c.owner[c.key]) > 1)
      .sort((a, b) => b.size - a.size)[0];
    if (!target) break;
    const current = target.owner[target.key];
    const count = countOf(current);
    const excess = text.length - maxChars * 0.95;
    const keep = Math.max(1, Math.min(count - 1, Math.floor(count * (1 - excess / target.size))));
    target.owner[target.key] = keepFirst(current, keep);
    const prev = trimmed.get(target.path);
    trimmed.set(target.path, { from: prev?.from ?? count, to: keep });
    root.truncated = [...trimmed]
      .map(([path, t]) => `${path} trimmed from ${t.from} to ${t.to} entries`)
      .join("; ")
      .concat(". The result was too large for one tool call; narrow the query (market, address, window, limit or search) to see the rest.");
    text = JSON.stringify(root);
  }
  return text;
}
