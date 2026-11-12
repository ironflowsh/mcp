import { describe, expect, it } from "vitest";

import { plainError, plainResult, plainSchema, plainText } from "./plain.js";

// Notices and errors as the API words them (solar, November 2026).
const KEYLESS_DELAY =
  'Without a key, liquidations and trades run 60 s behind live. A free key reads them live, no card: https://ironflow.sh/key, or POST https://api.ironflow.sh/v1/keys with {"email": "you@example.com"}.';
const MAP_SAMPLE =
  "Keyless sample: the 10 largest levels within 10% of mark. A free key returns every level out to 50%: https://ironflow.sh/key?utm_source=api";
const LEVELS_SAMPLE =
  "Keyless sample: the 10 busiest price levels in the last 24 hours. A free key returns every level and 14 days of history: https://ironflow.sh/key?utm_source=api. These are past liquidations; for where open positions would be liquidated next, GET /v1/liquidations/map?market=...";
const DAILY_LIMIT =
  'Error: Ironflow API error 402 KEYLESS_DAILY_LIMIT: keyless access allows 300 requests per rolling 24 hours from one IP; the next one is allowed in 3 h 20 min (Retry-After). Get a free key for 60 requests per minute and 14 days of history, and send it as "Authorization: Bearer if_...": https://ironflow.sh/key?utm_source=api, or POST https://api.ironflow.sh/v1/keys with {"email": "you@example.com"} (the key is emailed to that address, never returned, so a person has to open the email). Or stop polling: the live stream pushes each row as it lands, with no daily limit (one stream per IP without a key): GET /v1/liquidations/stream';
const FOUNDING =
  "Founding member: Explorer limits for 19 USDC per 30 days, price kept while you renew, first 50 accounts: https://ironflow.sh/upgrade?utm_source=api&plan=founding";
const X402 =
  "Agents with a USDC wallet on Base can also pay per call with x402, from $0.001, with no key: https://docs.ironflow.sh/guides/pay-per-call.";

describe("plainText", () => {
  it("keeps text that sells nothing exactly as written", () => {
    const text = "Market \"BTC\" was read as BTC-PERP. HIP-3 builder perps and HYPE/USDC spot are covered; $10k orders count.";
    expect(plainText(text)).toBe(text);
    expect(plainText("")).toBe("");
  });

  it("drops the key sign-up sentence and keeps the fact before it", () => {
    expect(plainText(KEYLESS_DELAY)).toBe("Without a key, liquidations and trades run 60 s behind live.");
    expect(plainText(MAP_SAMPLE)).toBe("Keyless sample: the 10 largest levels within 10% of mark.");
    expect(plainText(LEVELS_SAMPLE)).toBe(
      "Keyless sample: the 10 busiest price levels in the last 24 hours. These are past liquidations; for where open positions would be liquidated next, GET /v1/liquidations/map?market=..."
    );
  });

  it("drops a selling clause between semicolons and keeps the rest of its sentence", () => {
    expect(plainText("Keyless: last 24 hours, 5 s per query; a free key from https://ironflow.sh/key gives 30 days of history.")).toBe(
      "Keyless: last 24 hours, 5 s per query."
    );
    expect(plainText("Days covered (keyless: 1); absent when served by the Builder endpoint")).toBe("Days covered (keyless: 1)");
  });

  it("drops plan offers, upgrades and x402 pay-per-call", () => {
    expect(plainText(FOUNDING)).toBe("");
    expect(plainText(X402)).toBe("");
    expect(plainText(`Rows are capped at 1,000. ${X402}`)).toBe("Rows are capped at 1,000.");
    expect(plainText("Upgrade to lift this limit. Use a narrower window.")).toBe("Use a narrower window.");
  });
});

describe("plainError", () => {
  it("keeps the refusal and its timing, without the key offer", () => {
    expect(plainError(DAILY_LIMIT)).toBe(
      "Error: Ironflow API error 402 KEYLESS_DAILY_LIMIT: keyless access allows 300 requests per rolling 24 hours from one IP; the next one is allowed in 3 h 20 min (Retry-After). Or stop polling: the live stream pushes each row as it lands, with no daily limit (one stream per IP without a key): GET /v1/liquidations/stream"
    );
  });

  it("keeps the status and code when every sentence sells", () => {
    expect(plainError(`Error: Ironflow API error 403 TIER_FORBIDDEN: ${FOUNDING}`)).toBe("Error: Ironflow API error 403 TIER_FORBIDDEN.");
    expect(plainError(X402)).toBe("Error: the request was refused.");
  });
});

describe("plainSchema", () => {
  it("makes every description plain and drops one left empty", () => {
    const schema = {
      type: "object",
      description: "Vaults. A free key gives 30 days: https://ironflow.sh/key",
      properties: {
        days: { description: "Days covered (keyless: 1); absent when served by the Builder endpoint" },
        plan: { description: "Explorer and Builder limits" },
        market: { type: "string", description: "Display symbol, e.g. BTC-PERP" },
      },
    };
    expect(plainSchema(schema)).toEqual({
      type: "object",
      description: "Vaults.",
      properties: {
        days: { description: "Days covered (keyless: 1)" },
        plan: {},
        market: { type: "string", description: "Display symbol, e.g. BTC-PERP" },
      },
    });
  });
});

describe("plainResult", () => {
  it("makes the notice plain and drops plan offers, leaving the data alone", () => {
    const result = {
      notice: MAP_SAMPLE,
      upgrade: { plan: "explorer", price_usdc: 49 },
      get_key: { how: "POST https://api.ironflow.sh/v1/keys" },
      levels: [{ name: "Builder vault", px: "70000" }],
    };
    expect(plainResult("get_liquidation_map", result)).toEqual({
      notice: "Keyless sample: the 10 largest levels within 10% of mark.",
      levels: [{ name: "Builder vault", px: "70000" }],
    });
    expect(result.upgrade).toBeDefined();
  });

  it("drops a notice with nothing left, and describe_data's plan table", () => {
    const result = { notice: FOUNDING, limits: { history_days: 1 }, tiers: [{ tier: "explorer" }] };
    expect(plainResult("describe_data", result)).toEqual({ limits: { history_days: 1 } });
    expect(plainResult("run_query", { tiers: [] })).toEqual({ tiers: [] });
  });
});
