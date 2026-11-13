// Plain text for the data toolset (?toolset=data), the build listed in
// assistant directories. Their rules leave out trading, payments and in-app
// purchases, so in that mode tool descriptions, notices and errors carry no
// paid plans, x402 pay-per-call, upgrade or key sign-up lines. The facts stay:
// "Without a key you get the 10 busiest levels" is kept, "A free key returns
// every level: https://ironflow.sh/key" is not.

import type { Schema } from "./schemas.js";

// SELLS matches a sentence or clause that sells something. Plan names are
// matched with their capital letter only, so HIP-3 "builder" markets stay.
const SELLS: RegExp[] = [
  /x402/i,
  /\bpay(s|ing)?[- ]per[- ]call\b/i,
  /\bupgrade/i,
  /\bfounding member/i,
  /\bpaid (plan|key|tier|call)/i,
  /\b(Explorer|Builder|Enterprise)\b/,
  /\bfree key\b/i,
  /\bPAYMENT-REQUIRED\b/,
  /ironflow\.sh\/(key|upgrade|pricing|plans)\b/i,
  /\/v1\/(keys|billing)\b/,
];

const sells = (text: string): boolean => SELLS.some((re) => re.test(text));

// A sentence ends at . ! or ? before a space and a capital letter, so dots in
// URLs, numbers and "if_..." never split one. A URL before a space and a
// capital letter ends one too: the API ends offers with a bare link, and the
// client adds "Retry after N s." after the message.
const SENTENCE_END = /(?<=[.!?])\s+(?=[A-Z])|(?<=https?:\/\/\S+)\s+(?=[A-Z])/;
const CLAUSE_END = /;\s+/;

// plainText drops every sentence, or clause between semicolons, that sells
// something, and keeps the rest as written. "" when nothing is left.
export function plainText(text: string): string {
  if (!text || !sells(text)) return text;
  const kept: string[] = [];
  for (const sentence of text.split(SENTENCE_END)) {
    if (!sells(sentence)) {
      kept.push(sentence);
      continue;
    }
    const clauses = sentence.split(CLAUSE_END).filter((c) => !sells(c));
    if (clauses.length === 0) continue;
    const joined = clauses.join("; ").replace(/[\s,:;]+$/, "");
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
  description: "A note from the API: how a market name was read, or why data starts later than asked",
};

// Top-level result fields that only offer plans or payment.
const OFFER_FIELDS = ["upgrade", "get_key", "pay_per_call", "x402"];

// plainResult takes the selling out of a tool result in the data toolset:
// its notice is made plain and fields that only offer plans are dropped.
// describe_data also lists every plan's limits (tiers); the caller's own
// limits stay.
export function plainResult(tool: string, result: Record<string, unknown>): Record<string, unknown> {
  const out = { ...result };
  for (const key of OFFER_FIELDS) {
    if (out[key] !== null && typeof out[key] === "object") delete out[key];
  }
  if (tool === "describe_data") delete out.tiers;
  if (typeof out.notice === "string") {
    const notice = plainText(out.notice);
    if (notice) out.notice = notice;
    else delete out.notice;
  }
  return out;
}
