import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, type ToolOutcome } from "./server.js";
import { IronflowAPI } from "./api.js";
import { ALERT_TOOLS, type Toolset } from "./tools.js";

async function connect(api: Partial<IronflowAPI>, outcomes: ToolOutcome[], toolset?: Toolset): Promise<Client> {
  const stub = { notice: () => "", hasKey: () => true, ...api, withContext: () => stub } as unknown as IronflowAPI;
  const server = createServer(stub, "test", { onToolResult: (o) => outcomes.push(o), toolset });
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
    expect(outcomes).toEqual([{ tool: "get_vault_operations", isError: true, error: expect.stringMatching(/^Error: /) }]);
  });

  it("reports a successful call", async () => {
    const outcomes: ToolOutcome[] = [];
    const client = await connect({ getPrice: vi.fn().mockResolvedValue("1.5") }, outcomes);
    const res = await client.callTool({ name: "get_price", arguments: { market: "BTC-PERP" } });
    expect(res.isError).toBeFalsy();
    expect(outcomes).toEqual([{ tool: "get_price", isError: false, error: undefined }]);
  });
});

describe("tool listing", () => {
  it("gives every tool a title and annotations that say what it changes", async () => {
    const client = await connect({}, []);
    const { tools } = await client.listTools();
    expect(tools.length).toBe(46);
    const writes: Record<string, { destructive: boolean; idempotent: boolean }> = {
      create_liquidation_alert: { destructive: false, idempotent: false },
      test_liquidation_alert: { destructive: false, idempotent: false },
      delete_liquidation_alert: { destructive: true, idempotent: true },
    };
    for (const t of tools) {
      expect(t.title?.trim(), t.name).toBeTruthy();
      expect(t.annotations?.title, t.name).toBe(t.title);
      expect(t.annotations?.openWorldHint, t.name).toBe(true);
      const w = writes[t.name];
      if (w) {
        expect(t.annotations?.readOnlyHint, t.name).toBe(false);
        expect(t.annotations?.destructiveHint, t.name).toBe(w.destructive);
        expect(t.annotations?.idempotentHint, t.name).toBe(w.idempotent);
      } else {
        expect(t.annotations?.readOnlyHint, t.name).toBe(true);
        expect(t.annotations?.destructiveHint, t.name).not.toBe(true);
      }
    }
  });
});

describe("first contact", () => {
  const FIRST_CALLS = ["get_liquidation_summary", "get_liquidation_map", "get_markets_snapshot", "get_user_state"];

  it.each(["all", "data"] as Toolset[])("%s: instructions say when to use the tools and name the first calls", async (toolset) => {
    const client = await connect({}, [], toolset);
    const instructions = client.getInstructions() ?? "";
    // Users ask "what's BTC funding right now?" without naming Hyperliquid.
    expect(instructions).toContain(
      "Use these tools for crypto market questions about prices, funding, liquidations, open interest, top traders or a 0x wallet, also when the user does not name Hyperliquid"
    );
    for (const name of FIRST_CALLS) expect(instructions, name).toContain(name);
    // The common questions each name their first call.
    for (const pair of [
      "biggest liquidations, get_liquidation_summary",
      "liquidation levels, get_liquidation_map",
      "funding now, get_mark_prices",
      "top traders, get_top_traders",
      "a wallet, get_user_state",
    ]) {
      expect(instructions, pair).toContain(pair);
    }
    expect(instructions).toContain("an error can end with a step for the user; pass it on.");
    // Older Claude Code builds cut server instructions at 2 KB.
    expect(instructions.length).toBeLessThan(2048);
    expect(instructions).not.toContain("—");
    // Limits are in credits since 0.19.3; requests a day are gone.
    expect(instructions).toContain("100 credits a day");
    expect(instructions).toContain("https://docs.ironflow.sh/concepts/rate-limits");
    expect(instructions).not.toMatch(/\bper day\b|300 a day|requests a day/);
  });

  it("all: names the free key's credits", async () => {
    const client = await connect({}, []);
    expect(client.getInstructions()).toContain(
      "a free key from https://ironflow.sh/key raises that to 60 a minute, 1,000 credits a day (3,000 a month) and 14 days."
    );
  });

  it.each(["all", "data"] as Toolset[])("%s: lists the first calls at the top", async (toolset) => {
    const client = await connect({}, [], toolset);
    const names = (await client.listTools()).tools.map((t) => t.name);
    // Some clients pass only the first 40 tools to the model.
    for (const name of [...FIRST_CALLS, "list_markets", "describe_data", "run_query"]) {
      expect(names.indexOf(name), name).toBeGreaterThanOrEqual(0);
      expect(names.indexOf(name), name).toBeLessThan(16);
    }
  });

  it("lists the alert tools last", async () => {
    const client = await connect({}, []);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names.slice(-4)).toEqual([...ALERT_TOOLS]);
  });

  it.each(["all", "data"] as Toolset[])("%s: offers prompts a client can show as starts", async (toolset) => {
    const client = await connect({}, [], toolset);
    expect(client.getServerCapabilities()?.prompts).toBeDefined();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain("liquidation_map");
    const res = await client.getPrompt({ name: "liquidation_map", arguments: { market: "ETH" } });
    expect(res.messages[0]).toEqual({
      role: "user",
      content: { type: "text", text: expect.stringContaining("get_liquidation_map with market ETH") },
    });
    await expect(client.getPrompt({ name: "wallet_check", arguments: {} })).rejects.toThrow(/needs address/);
  });
});

describe("toolsets", () => {
  it("serves the alert tools and their instruction by default", async () => {
    const client = await connect({}, []);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("create_liquidation_alert");
    expect(client.getInstructions()).toContain("create_liquidation_alert posts liquidations");
    expect(client.getInstructions()).not.toMatch(/Ironbox|paper|sandbox/i);
  });

  it("data hides the alert tools and their instructions, and will not call them", async () => {
    const outcomes: ToolOutcome[] = [];
    const post = vi.fn();
    const del = vi.fn();
    const client = await connect({ post, del }, outcomes, "data");
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toHaveLength(42);
    expect(names.some((n) => n.includes("alert"))).toBe(false);
    const instructions = client.getInstructions() ?? "";
    expect(instructions).not.toMatch(/alert|x402|pay per call|free key|ironflow\.sh\/key/i);
    expect(instructions).toContain("Every tool only reads.");
    expect(instructions).toContain(
      "Each call costs credits: 1 for a read, 5 for analytics, 10 for run_query, none for describe_data or status. Keyless use allows 30 requests a minute, 100 credits a day and 24 hours of history. Limits: https://docs.ironflow.sh/concepts/rate-limits."
    );
    expect(client.getServerVersion()?.description).not.toMatch(/alert/i);
    for (const name of ["create_liquidation_alert", "delete_liquidation_alert", "test_liquidation_alert"]) {
      const res = (await client.callTool({ name, arguments: { id: "6f1c2a3b-0000-4000-8000-000000000000" } })) as {
        isError?: boolean;
        content: { text: string }[];
      };
      expect(res.isError, name).toBe(true);
      expect(res.content[0].text).toBe(`Unknown tool: ${name}`);
    }
    expect(post).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("data lists every tool as read-only, with output schemas that sell nothing", async () => {
    const client = await connect({}, [], "data");
    const { tools } = await client.listTools();
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint, t.name).toBe(true);
      expect(t.annotations?.destructiveHint, t.name).not.toBe(true);
      expect(t.annotations?.openWorldHint, t.name).toBe(true);
      const schema = JSON.stringify(t.outputSchema);
      expect(schema, t.name).not.toMatch(/free key|ironflow\.sh\/key|x402|\b(Explorer|Builder|Enterprise)\b/);
      expect((t.outputSchema?.properties as Record<string, { description?: string }>).notice.description, t.name).toBe(
        "A note from the API: how a market name was read, or why data starts later than asked"
      );
    }
  });
});

describe("data toolset results", () => {
  async function dataClient(response: () => Response): Promise<Client> {
    vi.stubGlobal("fetch", vi.fn(async () => response()));
    const server = createServer(new IronflowAPI("http://api"), "test", { toolset: "data" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(b);
    return client;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const json = (body: unknown, headers: Record<string, string> = {}, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

  it("takes the key offer out of the API's notice and the body's", async () => {
    const offer = "Keyless sample: the 10 largest levels within 10% of mark. A free key returns every level out to 50%: https://ironflow.sh/key?utm_source=api";
    const client = await dataClient(() => json({ notice: offer, market: "BTC-PERP", levels: [] }, { "X-Ironflow-Notice": offer }));
    const res = (await client.callTool({ name: "get_liquidation_map", arguments: { market: "BTC" } })) as {
      content: { text: string }[];
      structuredContent: Record<string, unknown>;
    };
    expect(res.structuredContent).toEqual({
      notice: "Keyless sample: the 10 largest levels within 10% of mark.",
      market: "BTC-PERP",
      levels: [],
    });
    expect(res.content[0].text).not.toMatch(/free key|ironflow\.sh\/key/);
  });

  it("keeps the key offer in the default toolset", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: [] }, { "X-Ironflow-Notice": "A free key reads them live: https://ironflow.sh/key" })));
    const server = createServer(new IronflowAPI("http://api"), "test");
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(b);
    const res = (await client.callTool({ name: "get_liquidations", arguments: { market: "BTC-PERP" } })) as {
      structuredContent: Record<string, unknown>;
    };
    expect(res.structuredContent.notice).toBe("A free key reads them live: https://ironflow.sh/key");
  });

  it("errors keep the refusal and drop the key and payment offer", async () => {
    const message =
      'keyless access allows 100 credits per rolling 24 hours from one IP; the next call is allowed in 3 h (Retry-After). A read costs 1 credit, analytics 5, SQL 10 and a stream 1 a minute: https://docs.ironflow.sh/concepts/rate-limits. Get a free key for 1,000 credits a day, 60 requests per minute and 14 days of history, and send it as "Authorization: Bearer if_...": https://ironflow.sh/key?utm_source=api';
    const client = await dataClient(() =>
      json({ error: { code: "KEYLESS_DAILY_LIMIT", message, upgrade: { plan: "explorer" } } }, { "Retry-After": "10800", "PAYMENT-REQUIRED": "x" }, 402)
    );
    const res = (await client.callTool({ name: "get_liquidations", arguments: { market: "BTC-PERP" } })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe(
      "Error: Ironflow API error 402 KEYLESS_DAILY_LIMIT: keyless access allows 100 credits per rolling 24 hours from one IP; the next call is allowed in 3 h (Retry-After). A read costs 1 credit, analytics 5, SQL 10 and a stream 1 a minute: https://docs.ironflow.sh/concepts/rate-limits. Retry after 10800 s."
    );
  });

  it("describe_data leaves out the plan table and keeps the caller's limits", async () => {
    const client = await dataClient(() =>
      json({ dialect: "clickhouse", tables: [], limits: { history_days: 1 }, tiers: [{ tier: "explorer", history_days: 90 }] })
    );
    const res = (await client.callTool({ name: "describe_data", arguments: {} })) as { structuredContent: Record<string, unknown> };
    expect(res.structuredContent).toEqual({ dialect: "clickhouse", tables: [], limits: { history_days: 1 } });
  });
});

describe("API notices in tool results", () => {
  // A real IronflowAPI over a stubbed fetch, so the headers go the whole way.
  async function realClient(response: () => Response, key?: string): Promise<Client> {
    vi.stubGlobal("fetch", vi.fn(async () => response()));
    const server = createServer(new IronflowAPI("http://api", key), "test");
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

  it("without a key, key-only tools say how to get one and never call the API", async () => {
    // 8 of 116 MCP-made calls in the week to 2026-11-12 were keyless calls
    // of key-only tools answered a bare 401.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const server = createServer(new IronflowAPI("http://api"), "test");
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(b);
    for (const [name, args] of [
      ["list_liquidation_alerts", {}],
      ["create_liquidation_alert", { url: "https://hooks.slack.com/services/T0/B0/x" }],
      ["test_liquidation_alert", { id: "6f1c2a3b-0000-4000-8000-000000000000" }],
      ["delete_liquidation_alert", { id: "6f1c2a3b-0000-4000-8000-000000000000" }],
    ] as const) {
      const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
      expect(res.isError, name).toBe(true);
      expect(res.content[0].text, name).toBe(
        `Error: ${name} needs an API key (a free key works). Tell the user: get a free key at https://ironflow.sh/key?utm_source=mcp (it takes a minute and gives 1,000 credits a day, up to 3,000 a month, and 14 days of history), then set IRONFLOW_API_KEY=if_... in the Ironflow server's env and restart the app.`
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The API's refusal of a keyless call past its daily credits.
  const dailyLimit = (): Response =>
    new Response(
      JSON.stringify({
        error: {
          code: "KEYLESS_DAILY_LIMIT",
          message:
            'keyless access allows 100 credits per rolling 24 hours from one IP; the next call is allowed in about 6 hours (Retry-After). Get a free key for 1,000 credits a day, 60 requests per minute and 14 days of history, and send it as "Authorization: Bearer if_...": https://ironflow.sh/key, or POST https://api.ironflow.sh/v1/keys with {"email": "you@example.com"}',
        },
      }),
      { status: 402, headers: { "content-type": "application/json", "Retry-After": "22347" } }
    );

  it("words a keyless daily limit as what to tell the user, with the stdio key step", async () => {
    const client = await realClient(dailyLimit);
    const res = (await client.callTool({ name: "get_recent_trades", arguments: { market: "BTC-PERP" } })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe(
      "Error: Ironflow API error 402 KEYLESS_DAILY_LIMIT: the keyless allowance for this IP address is used up (100 credits in a rolling 24 hours). Every Ironflow tool fails for about 6 hours, so make no more Ironflow calls until then. Tell the user: get a free key at https://ironflow.sh/key?utm_source=mcp (it takes a minute and gives 1,000 credits a day, up to 3,000 a month, and 14 days of history), then set IRONFLOW_API_KEY=if_... in the Ironflow server's env and restart the app."
    );
    // The email route asks the agent for the user's email; the key page does not.
    expect(res.content[0].text).not.toContain("/v1/keys");
  });

  it.each([
    ["claude-code", 'run claude mcp remove ironflow, then claude mcp add --transport http ironflow https://mcp.ironflow.sh/mcp --header "Authorization: Bearer if_..."'],
    ["claude-ai", "in Customize > Connectors remove Ironflow and add it again with the URL https://mcp.ironflow.sh/mcp?key=if_..."],
    ["cursor-vscode", 'add "headers": {"Authorization": "Bearer if_..."} next to the Ironflow url in .cursor/mcp.json'],
    ["Visual Studio Code", 'add "headers": {"Authorization": "Bearer if_..."} to the Ironflow server in mcp.json'],
    ["some-agent", "send the header Authorization: Bearer if_... with the Ironflow connection, or use https://mcp.ironflow.sh/mcp?key=if_... as its URL"],
  ])("on the hosted server, names the key step for %s", async (app, step) => {
    vi.stubGlobal("fetch", vi.fn(async () => dailyLimit()));
    const server = createServer(new IronflowAPI("http://api"), "test", { transport: "http" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: app, version: "1.0.0" });
    await client.connect(b);
    const res = (await client.callTool({ name: "get_liquidation_map", arguments: { market: "ETH" } })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain(`Tell the user: get a free key at https://ironflow.sh/key?utm_source=mcp`);
    expect(res.content[0].text.endsWith(`, then ${step}.`), res.content[0].text).toBe(true);
    // claude.ai calls from shared IP addresses, so its users share the allowance.
    expect(res.content[0].text.includes("claude.ai connects from shared IP addresses")).toBe(app === "claude-ai");
  });

  it("keeps the API's text for a key holder's limit", async () => {
    const message = "This call costs 5 credits, and this account (free plan, all its keys together) has 3 of its 1,000 credits left for today.";
    const client = await realClient(
      () =>
        new Response(JSON.stringify({ error: { code: "DAILY_QUOTA_EXCEEDED", message } }), {
          status: 429,
          headers: { "content-type": "application/json", "Retry-After": "3600" },
        }),
      "if_test_key_123"
    );
    const res = (await client.callTool({ name: "get_recent_trades", arguments: { market: "BTC-PERP" } })) as {
      content: { text: string }[];
    };
    expect(res.content[0].text).toBe(`Error: Ironflow API error 429 DAILY_QUOTA_EXCEEDED: ${message} Retry after 3600 s.`);
  });

  it("adds the key step to other keyless limits a key lifts", async () => {
    const client = await realClient(
      () =>
        new Response(JSON.stringify({ error: { code: "HISTORY_OUT_OF_RANGE", message: "keyless access reaches 24 hours back" } }), {
          status: 403,
          headers: { "content-type": "application/json" },
        })
    );
    const res = (await client.callTool({ name: "get_recent_trades", arguments: { market: "BTC-PERP" } })) as {
      content: { text: string }[];
    };
    expect(res.content[0].text).toMatch(
      /^Error: Ironflow API error 403 HISTORY_OUT_OF_RANGE: keyless access reaches 24 hours back\. A free key lifts this\. Tell the user: get a free key at https:\/\/ironflow\.sh\/key\?utm_source=mcp/
    );
  });

  it("tags a QA check's API calls with a qa_check client name", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: [{ mark_price: "100" }] }), { headers: { "content-type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    const server = createServer(new IronflowAPI("http://api"), "test", { transport: "http", qaCheck: true });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "claude-code", version: "2.1.0" });
    await client.connect(b);
    await client.callTool({ name: "get_price", arguments: { market: "BTC-PERP" } });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Ironflow-Client"]).toBe("qa_check claude-code/2.1.0");
  });
});
