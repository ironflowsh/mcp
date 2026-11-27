import { describe, expect, it } from "vitest";
import { ApiError } from "./api.js";
import { connectStep, dataKeyStep, limitText, waitFor } from "./limits.js";
import { qaClient } from "./server.js";

describe("waitFor", () => {
  it.each([
    [30, "about a minute"],
    [600, "about 10 minutes"],
    [3600, "about an hour"],
    [22347, "about 6 hours"],
  ])("%i s reads %s", (seconds, text) => {
    expect(waitFor(seconds)).toBe(text);
  });
});

describe("connectStep", () => {
  it("names the env var on stdio, whatever the app", () => {
    expect(connectStep("claude-ai/0.1.0", "stdio")).toBe("set IRONFLOW_API_KEY=if_... in the Ironflow server's env and restart the app");
  });

  it("reads a QA-tagged client name as the app", () => {
    expect(connectStep("qa_check claude-code/2.1.0", "http")).toContain("claude mcp add --transport http ironflow");
  });
});

describe("limitText", () => {
  const daily = new ApiError(
    "Ironflow API error 402 KEYLESS_DAILY_LIMIT: keyless access allows 100 credits per rolling 24 hours from one IP",
    402,
    "KEYLESS_DAILY_LIMIT"
  );

  it("leaves key holders, other errors and plain errors to the API's text", () => {
    expect(limitText(daily, { keyed: true, transport: "http" })).toBeUndefined();
    expect(limitText(new ApiError("Ironflow API error 404 NOT_FOUND: no market", 404, "NOT_FOUND"), { keyed: false, transport: "http" })).toBeUndefined();
    expect(limitText(new Error("boom"), { keyed: false, transport: "http" })).toBeUndefined();
  });

  it("says not to retry when the API gives no Retry-After", () => {
    expect(limitText(daily, { keyed: false, transport: "http" })).toContain("(100 credits in a rolling 24 hours). Every Ironflow tool fails for now, so make no more Ironflow calls. Tell the user, in two steps: 1. Get a free key: https://ironflow.sh/key");
  });

  it("names the claude.ai conversation or the claude.ai total when one ran out", () => {
    const ctx = { keyed: false, client: "claude-ai", transport: "http" as const };
    const own = new ApiError(
      "Ironflow API error 429 KEYLESS_DAILY_LIMIT: Keyless access allows 30 credits per rolling 24 hours for one claude.ai conversation; the next call is allowed in about 24 hours",
      429,
      "KEYLESS_DAILY_LIMIT",
      86400
    );
    const total = new ApiError(
      "Ironflow API error 429 KEYLESS_DAILY_LIMIT: Keyless access allows 3,000 credits per rolling 24 hours for all claude.ai conversations together; the next call is allowed in about 2 hours",
      429,
      "KEYLESS_DAILY_LIMIT",
      7200
    );
    expect(limitText(own, ctx)).toBe(
      "Ironflow API error 429 KEYLESS_DAILY_LIMIT: the keyless allowance for this conversation is used up (30 credits in a rolling 24 hours). Every Ironflow tool fails for about 24 hours, so make no more Ironflow calls until then. Tell the user, in two steps: 1. Get a free key: https://ironflow.sh/key?utm_source=mcp (one minute, no card; 1,000 credits a day, up to 3,000 a month, and 14 days of history). 2. Then in Customize > Connectors remove Ironflow and add it again with the URL https://mcp.ironflow.sh/mcp?key=if_...."
    );
    expect(limitText(total, ctx)).toContain(
      "the keyless allowance that all claude.ai conversations share is used up (3,000 credits in a rolling 24 hours). Every Ironflow tool fails for about 2 hours"
    );
    expect(limitText(own, ctx)).not.toContain("shared IP addresses");
  });

  it("knows claude.ai by the name its connector sends", () => {
    const text = limitText(daily, { keyed: false, client: "Anthropic/ClaudeAI/1.0.0", transport: "http" });
    expect(text).toContain("claude.ai connects from shared IP addresses");
    expect(text).toContain("in Customize > Connectors remove Ironflow");
  });

  it("asks a rate-limited agent to wait, with the key as an option", () => {
    const text = limitText(
      new ApiError("Ironflow API error 429 RATE_LIMIT_EXCEEDED: keyless access allows 30 requests per minute. Retry after 60 s.", 429, "RATE_LIMIT_EXCEEDED", 60),
      { keyed: false, client: "cursor-vscode/1.0.0", transport: "http" }
    );
    expect(text).toMatch(/Retry after 60 s\. Wait a minute, then call again\. For 60 requests a minute, get a free key at /);
    expect(text).not.toContain("Tell the user");
  });
});

describe("qaClient", () => {
  it("prefixes qa_check once", () => {
    expect(qaClient("claude-code/2.1.0")).toBe("qa_check claude-code/2.1.0");
    expect(qaClient("qa_check first-call")).toBe("qa_check first-call");
    expect(qaClient(undefined)).toBe("qa_check");
  });
});

describe("dataKeyStep", () => {
  const ctx = { keyed: false, client: "Anthropic/ClaudeAI/1.0.0", transport: "http" as const };
  const err = (code: string, retryAfterS?: number) => new ApiError(`Ironflow API error 402 ${code}: x`, 402, code, retryAfterS);

  it("says every tool fails until the daily limit frees up, then the key page and the /data step", () => {
    expect(dataKeyStep(err("KEYLESS_DAILY_LIMIT", 3600), ctx)).toBe(
      "Every Ironflow tool fails for about an hour, so make no more Ironflow calls until then. A free API key lifts this limit: https://ironflow.sh/key (to use it, in Customize > Connectors remove Ironflow and add it again with the URL https://mcp.ironflow.sh/data?key=if_...)."
    );
  });

  it("names no price, plan or tracked link", () => {
    for (const code of ["KEYLESS_DAILY_LIMIT", "HISTORY_OUT_OF_RANGE", "TIER_FORBIDDEN", "QUERY_WINDOW_EXCEEDED"]) {
      const step = dataKeyStep(err(code), { ...ctx, client: "cursor-vscode/1.0.0" }) ?? "";
      expect(step, code).toContain("A free API key lifts this limit: https://ironflow.sh/key");
      expect(step, code).not.toMatch(/utm_|\$\d|USDC|\b(Explorer|Builder|Pro)\b|credits a day|no card/);
    }
  });

  it("only says to wait on a per-minute limit, and nothing for key holders or other errors", () => {
    expect(dataKeyStep(err("RATE_LIMIT_EXCEEDED"), ctx)).toBe("Wait a minute, then call again.");
    expect(dataKeyStep(err("KEYLESS_DAILY_LIMIT"), { ...ctx, keyed: true })).toBeUndefined();
    expect(dataKeyStep(err("QUERY_ERROR"), ctx)).toBeUndefined();
    expect(dataKeyStep(new Error("network"), ctx)).toBeUndefined();
  });
});
