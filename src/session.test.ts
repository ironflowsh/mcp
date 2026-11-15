import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IronflowAPI } from "./api.js";
import { isClaudeAI, issueSession, readSession, sessionForAPI } from "./session.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isClaudeAI", () => {
  it.each([
    ["Anthropic/ClaudeAI/1.0.0", true],
    ["claude-ai/0.1.0", true],
    ["claude-code/2.1.325", false],
    ["Claude-User", false],
    [undefined, false],
  ])("%s is claude.ai: %s", (client, want) => {
    expect(isClaudeAI(client)).toBe(want);
  });
});

describe("claude.ai sessions", () => {
  it("reads back the ids it issued", () => {
    const token = issueSession("s1");
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/);
    expect(readSession(token, "s1")).toBe(token.split(".")[0]);
    expect(readSession([token], "s1")).toBe(token.split(".")[0]);
    expect(issueSession("s1")).not.toBe(token);
  });

  it("refuses ids it did not issue", () => {
    const token = issueSession("s1");
    const [id, sig] = token.split(".");
    expect(readSession(token, "s2")).toBeUndefined();
    expect(readSession(`${id}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`, "s1")).toBeUndefined();
    expect(readSession(`${"A".repeat(22)}.${sig}`, "s1")).toBeUndefined();
    expect(readSession(id, "s1")).toBeUndefined();
    expect(readSession("", "s1")).toBeUndefined();
    expect(readSession(undefined, "s1")).toBeUndefined();
  });

  it("signs the session for the API with the shared secret", () => {
    const want = createHmac("sha256", "s1").update("claude-ai-session:abc").digest("hex");
    expect(sessionForAPI("abc", "s1")).toEqual({ id: "abc", auth: want });
    // The API's TestMCPSessionMACMatchesTheMCP pins the same vector.
    expect(sessionForAPI("abc", "test-session-secret").auth).toBe("02b08271cec0faf7ff9a64e6736ce6c73c52d9009ea49aa792a28ae4f5bf03bc");
  });

  it("sends the session on keyless calls only, and never in a session note", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const session = sessionForAPI("abc", "s1");
    await new IronflowAPI("http://api", undefined, undefined, "0.20.0-hosted", "203.0.113.9", session).get("/v1/status");
    await new IronflowAPI("http://api", "if_secretkey1", undefined, "0.20.0-hosted", "203.0.113.9", session).get("/v1/status");
    await new IronflowAPI("http://api", undefined, undefined, "0.20.0-hosted", "203.0.113.9", session).noteRPC("tools/list", false);
    const sent = fetchMock.mock.calls.map((c) => (c as unknown as [string, RequestInit])[1].headers as Record<string, string>);
    expect(sent[0]["X-Ironflow-Mcp-Session"]).toBe("abc");
    expect(sent[0]["X-Ironflow-Mcp-Session-Auth"]).toBe(session.auth);
    expect(sent[1]["X-Ironflow-Mcp-Session"]).toBeUndefined();
    expect(sent[1]["X-Ironflow-Mcp-Session-Auth"]).toBeUndefined();
    expect(sent[2]["X-Ironflow-Mcp-Session"]).toBeUndefined();
  });
});
