import { describe, expect, it } from "vitest";
import { ApiError } from "./api.js";
import { connectStep, limitText, waitFor } from "./limits.js";
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
    expect(limitText(daily, { keyed: false, transport: "http" })).toContain("(100 credits in a rolling 24 hours). Every Ironflow tool fails for now, so make no more Ironflow calls. Tell the user:");
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
