import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, type ToolOutcome } from "./server.js";
import { IronflowAPI } from "./api.js";

async function connect(api: Partial<IronflowAPI>, outcomes: ToolOutcome[]): Promise<Client> {
  const stub = { notice: () => "", ...api, withContext: () => stub } as unknown as IronflowAPI;
  const server = createServer(stub, "test", { onToolResult: (o) => outcomes.push(o) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(b);
  return client;
}

describe("createServer onToolResult", () => {
  it("reports a tool error that the client receives with HTTP 200", async () => {
    const outcomes: ToolOutcome[] = [];
    const client = await connect({}, outcomes);
    const res = await client.callTool({ name: "get_vault_operations", arguments: {} });
    expect(res.isError).toBe(true);
    expect(outcomes).toEqual([{ tool: "get_vault_operations", isError: true }]);
  });

  it("reports a successful call", async () => {
    const outcomes: ToolOutcome[] = [];
    const client = await connect({ getPrice: vi.fn().mockResolvedValue("1.5") }, outcomes);
    const res = await client.callTool({ name: "get_price", arguments: { market: "BTC-PERP" } });
    expect(res.isError).toBeFalsy();
    expect(outcomes).toEqual([{ tool: "get_price", isError: false }]);
  });
});

describe("tool listing", () => {
  it("gives every tool a title and the read-only annotations the Claude directory requires", async () => {
    const client = await connect({}, []);
    const { tools } = await client.listTools();
    expect(tools.length).toBe(36);
    for (const t of tools) {
      expect(t.title?.trim(), t.name).toBeTruthy();
      expect(t.annotations?.title, t.name).toBe(t.title);
      expect(t.annotations?.readOnlyHint, t.name).toBe(true);
      expect(t.annotations?.destructiveHint, t.name).not.toBe(true);
      expect(t.annotations?.openWorldHint, t.name).toBe(true);
    }
  });
});

describe("API notices in tool results", () => {
  // A real IronflowAPI over a stubbed fetch, so the headers go the whole way.
  async function realClient(response: () => Response): Promise<Client> {
    vi.stubGlobal("fetch", vi.fn(async () => response()));
    const server = createServer(new IronflowAPI("http://api"), "test");
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(b);
    return client;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("puts the notice first, in the text and the structured result", async () => {
    const client = await realClient(
      () =>
        new Response(JSON.stringify({ data: [{ mark_price: "100" }] }), {
          headers: {
            "content-type": "application/json",
            "X-Ironflow-Market": "BTC-PERP",
          },
        })
    );
    const res = (await client.callTool({ name: "get_price", arguments: { market: "BTC" } })) as {
      content: { text: string }[];
      structuredContent: Record<string, unknown>;
    };
    expect(res.content[0].text).toMatch(/^\{"notice":"Market \\"BTC\\" was read as BTC-PERP\."/);
    expect(res.structuredContent).toEqual({ notice: 'Market "BTC" was read as BTC-PERP.', market: "BTC", price: "100" });
  });

  it("adds the history notice with the time data starts", async () => {
    const client = await realClient(
      () =>
        new Response(JSON.stringify({ data: [] }), {
          headers: {
            "content-type": "application/json",
            "X-Ironflow-History-Clamped": "1793232000000",
            "X-Ironflow-Notice":
              "keyless access reaches 24 hours back, so data starts at X-Ironflow-History-Clamped. A free key reaches 30 days: https://ironflow.sh/key",
          },
        })
    );
    const res = (await client.callTool({
      name: "get_user_summary",
      arguments: { address: "0x9b3cafa1209ac61f02d7bc3b219697fb171c9c91", from: "2026-10-01" },
    })) as { structuredContent: Record<string, unknown> };
    expect(res.structuredContent.notice).toBe(
      "Keyless access reaches 24 hours back, so data starts at 2026-10-29T00:00:00Z (1793232000000). A free key reaches 30 days: https://ironflow.sh/key"
    );
    expect(res.structuredContent.data).toEqual([]);
  });

  it("leaves a result without notice headers unchanged", async () => {
    const client = await realClient(
      () => new Response(JSON.stringify({ data: [{ mark_price: "100" }] }), { headers: { "content-type": "application/json" } })
    );
    const res = (await client.callTool({ name: "get_price", arguments: { market: "BTC-PERP" } })) as {
      structuredContent: Record<string, unknown>;
    };
    expect(res.structuredContent).toEqual({ market: "BTC-PERP", price: "100" });
  });

  it("returns the API's error message, with its key link, as the tool error", async () => {
    const client = await realClient(
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: "KEYLESS_DAILY_LIMIT",
              message:
                'keyless access allows 500 requests per day from one IP. Get a free key for 60 requests per minute and 30 days of history, and send it as "Authorization: Bearer if_...": https://ironflow.sh/key',
            },
          }),
          { status: 429, headers: { "content-type": "application/json", "Retry-After": "3600" } }
        )
    );
    const res = (await client.callTool({ name: "get_recent_trades", arguments: { market: "BTC-PERP" } })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/^Error: Ironflow API error 429 KEYLESS_DAILY_LIMIT: keyless access allows 500/);
    expect(res.content[0].text).toContain("https://ironflow.sh/key");
    expect(res.content[0].text).toContain("Retry after 3600 s.");
  });
});
