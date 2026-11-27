// Plain text for the data toolset (mcp.ironflow.sh/data, or ?toolset=data),
// the build listed in assistant directories. Their rules leave out trading,
// payments and promotion, so in that mode notices and errors are data
// caveats only: how a name was read, a delay or a sample, a coverage gap, a
// partial result, a limit and when it frees up. Plan names and prices,
// upgrade, pricing and tracked links, x402 pay-per-call, free key sign-up
// lines and pitches for other products (live streams, datasets) are left
// out. The facts stay: "Without a key you get the 10 busiest levels" is
// kept, "A free key returns every level: https://ironflow.sh/key" is not. A
// keyless refusal a free key lifts gets one plain step of ours instead
// (limits.ts dataKeyStep).

import type { Schema } from "./schemas.js";

// SELLS matches a sentence or clause that sells something rather than
// describing the data. Plan names are matched with their capital letter
// only, so HIP-3 "builder" markets stay.
const SELLS: RegExp[] = [
  /x402/i,
  /\bpay(s|ing)?[- ]per[- ]call\b/i,
  /\bupgrade/i,
  /\bfounding member/i,
  /\bpaid (plan|key|tier|call)/i,
  /\b(Explorer|Builder|Enterprise|Pro)\b/,
  /\bIronflow Edge\b/i,
  /\bIronbox\b/i,
  /\bdedicated node/i,
  /\bfree key\b/i,
  /\bSend a key as\b/i,
  /\bno card\b/i,
  /\btrial\b/i,
  /\bsign[- ]?up\b/i,
  /\bPAYMENT-REQUIRED\b/,
  // Prices: "$49/mo", "49 USDC per 30 days", "1,250 USD per month".
  /\$\d[\d,.]*\s*(\/|per |a )\s*(mo|month|year|yr)\b/i,
  /\b\d[\d,.]*\s*USDC? (per|a|every)\b/i,
  // Tracked links and our sales pages.
  /[?&]utm_[a-z]+=/i,
  /ironflow\.sh\/(key|upgrade|pricing|plans|nodes|ironbox|edge|datasets)\b/i,
  /\/v1\/(keys|billing)\b/,
  // Other products: the live streams (no tool here) and the free datasets.
  /\bInstead of polling\b/i,
  /\/v1\/[\w/-]*stream\b/,
  /huggingface\.co\//i,
];

const sells = (text: string): boolean => SELLS.some((re) => re.test(text));

// A sentence ends at . ! or ? before a space and a capital letter, so dots in
// URLs, numbers and "if_..." never split one. A URL before a space and a
// capital letter ends one too: the API ends offers with a bare link, and the
// client adds "Retry after N s." after the message.
const SENTENCE_END = /(?<=[.!?])\s+(?=[A-Z])|(?<=https?:\/\/\S+)\s+(?=[A-Z])/;
const CLAUSE_END = /;\s+/;

// plainText drops every sentence, or clause between semicolons, that sells
// something, and keeps the rest as written. A short question that leads
// into a dropped sentence ("Backfilling? Every trade ... is a free file")
// goes with it. "" when nothing is left.
export function plainText(text: string): string {
  if (!text || !sells(text)) return text;
  const sentences = text.split(SENTENCE_END);
  const kept: string[] = [];
  for (const [i, sentence] of sentences.entries()) {
    const next = sentences[i + 1];
    if (/\?$/.test(sentence.trim()) && next !== undefined && sells(next)) continue;
    if (!sells(sentence)) {
      kept.push(sentence);
      continue;
    }
    const clauses = sentence.split(CLAUSE_END).filter((c) => !sells(c));
    if (clauses.length === 0) continue;
    let joined = clauses.join("; ").replace(/[\s,:;]+$/, "");
    if (/^[A-Z]/.test(sentence)) joined = joined.charAt(0).toUpperCase() + joined.slice(1);
    const stop = /[.!?]$/.test(sentence.trim()) && !/[.!?]$/.test(joined) ? "." : "";
    kept.push(joined + stop);
  }
  return kept.join(" ").trim();
}

// plainError keeps the start of an error when every sentence of it sells
// something, so the agent still learns the call failed and why.
export function plainError(text: string): string {
  const plain = plainText(text);
  if (plain) return plain;
  const head = /^Error: Ironflow API error \d{3}(?: [A-Z0-9_]+)?/.exec(text);
  return head ? `${head[0]}.` : "Error: the request was refused.";
}

// plainSchema returns a copy of a JSON schema with every description plain.
export function plainSchema<T>(schema: T): T {
  if (Array.isArray(schema)) return schema.map((s) => plainSchema(s)) as T;
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === "description" && typeof value === "string") {
      const text = plainText(value);
      if (text) out[key] = text;
    } else {
      out[key] = plainSchema(value);
    }
  }
  return out as T;
}

// The notice field of every output schema, worded for the data toolset.
export const DATA_NOTICE: Schema = {
  description: "A caveat about the data: how a market name was read, a delay or sample, or why data starts later than asked",
};

// Top-level result fields that only offer plans, payment or other products.
const OFFER_FIELDS = [
  "upgrade", "get_key", "free_key", "pay_per_call", "x402", "ironbox", "teaser", "pro_pass",
  "pro_page", "trial", "recommended_plan", "plans_url", "buy_pro_yearly",
];

// plainResult takes the selling out of a tool result in the data toolset:
// its notice is made plain and fields that only offer plans or products
// are dropped.
// describe_data also lists every plan's limits (tiers); the caller's own
// limits stay.
export function plainResult(tool: string, result: Record<string, unknown>): Record<string, unknown> {
  const out = { ...result };
  for (const key of OFFER_FIELDS) delete out[key];
  if (tool === "describe_data") delete out.tiers;
  if (typeof out.notice === "string") {
    const notice = plainText(out.notice);
    if (notice) out.notice = notice;
    else delete out.notice;
  }
  return out;
}
