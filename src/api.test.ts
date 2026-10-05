import { afterEach, describe, expect, it, vi } from "vitest";
import { IronflowAPI } from "./api.js";

// sentHeaders captures the headers of the one fetch a call makes.
function stubFetch(): () => Record<string, string> {
  const fetchMock = vi.fn(async () => new Response("{}", { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  return () => (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IronflowAPI caller context", () => {
  it("sends no context headers by default", async () => {
    const headers = stubFetch();
    await new IronflowAPI("http://api", undefined, undefined, "0.10.0").get("/v1/status");
    expect(headers()["X-Ironflow-Client"]).toBeUndefined();
    expect(headers()["X-Ironflow-Tool"]).toBeUndefined();
    expect(headers()["User-Agent"]).toBe("ironflow-mcp/0.10.0");
  });

  it("tags requests with the client app and tool", async () => {
    const headers = stubFetch();
    const api = new IronflowAPI("http://api").withContext({ client: "claude-ai/0.1.0", tool: "run_query" });
    await api.post("/v1/query", { sql: "SELECT 1" });
    expect(headers()["X-Ironflow-Client"]).toBe("claude-ai/0.1.0");
    expect(headers()["X-Ironflow-Tool"]).toBe("run_query");
  });

  it("leaves the original client untouched", async () => {
    const headers = stubFetch();
    const base = new IronflowAPI("http://api");
    base.withContext({ tool: "get_status" });
    await base.get("/v1/status");
    expect(headers()["X-Ironflow-Tool"]).toBeUndefined();
  });

  it("drops values that are not plain names", async () => {
    const headers = stubFetch();
    await new IronflowAPI("http://api").withContext({ client: "bad\nname", tool: "Drop Table" }).get("/v1/status");
    expect(headers()["X-Ironflow-Client"]).toBeUndefined();
    expect(headers()["X-Ironflow-Tool"]).toBeUndefined();
  });
});
