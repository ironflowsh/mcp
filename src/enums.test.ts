import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { closestAllowed, fitEnums } from "./enums.js";
import { IronflowAPI } from "./api.js";
import { createServer } from "./server.js";
import { tools } from "./tools.js";

const PROBE = "__outside_enum__";
const OI_WINDOWS = ["1h", "4h", "24h", "7d"];
const OUTCOME_WINDOWS = ["4h", "1d", "1w"];
const TRADER_WINDOWS = ["7d", "30d", "90d"];
const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"];

describe("closestAllowed", () => {
  it("reads the same length of time written another way", () => {
    expect(closestAllowed("1d", OI_WINDOWS)).toBe("24h");
    expect(closestAllowed("week", OI_WINDOWS)).toBe("7d");
    expect(closestAllowed("1 week", OI_WINDOWS)).toBe("7d");
    expect(closestAllowed("-24h", OI_WINDOWS)).toBe("24h");
    expect(closestAllowed("last 7 days", OI_WINDOWS)).toBe("7d");
    expect(closestAllowed("24h", OUTCOME_WINDOWS)).toBe("1d");
    expect(closestAllowed("7d", OUTCOME_WINDOWS)).toBe("1w");
    expect(closestAllowed("1w", TRADER_WINDOWS)).toBe("7d");
    expect(closestAllowed("month", TRADER_WINDOWS)).toBe("30d");
    expect(closestAllowed("60m", INTERVALS)).toBe("1h");
    expect(closestAllowed("15min", INTERVALS)).toBe("15m");
    expect(closestAllowed("daily", INTERVALS)).toBe("1d");
    expect(closestAllowed("hourly", ["1h", "1d", "raw"])).toBe("1h");
    expect(closestAllowed("1D", ["24h", "7d"])).toBe("24h");
  });

  it("does not guess between lengths of time", () => {
    expect(closestAllowed("2h", OI_WINDOWS)).toBeUndefined();
    expect(closestAllowed("14d", TRADER_WINDOWS)).toBeUndefined();
    // 1m is a minute, not a month; 1M is left unread.
    expect(closestAllowed("1m", TRADER_WINDOWS)).toBeUndefined();
    expect(closestAllowed("1M", TRADER_WINDOWS)).toBeUndefined();
    expect(closestAllowed("1M", INTERVALS)).toBeUndefined();
  });

  it("reads another case, spelling or plural of an allowed word", () => {
    expect(closestAllowed("PERP", ["perp", "spot", "prediction", "option"])).toBe("perp");
    expect(closestAllowed("perps", ["perp", "spot", "prediction", "option"])).toBe("perp");
    expect(closestAllowed("Market Maker", ["whale", "market_maker"])).toBe("market_maker");
    expect(closestAllowed("low-risk", ["top", "lowrisk", "new"])).toBe("lowrisk");
    expect(closestAllowed("longs", ["any", "long", "short"])).toBe("long");
    expect(closestAllowed("losses", ["realized_pnl", "loss", "volume"])).toBe("loss");
    expect(closestAllowed("spot", ["perps", "outcomes", "spot"])).toBe("spot");
    expect(closestAllowed("outcome", ["perps", "outcomes", "spot"])).toBe("outcomes");
  });

  it("reads plain synonyms, only where their target is allowed", () => {
    expect(closestAllowed("all", ["any", "long", "short"])).toBe("any");
    expect(closestAllowed("all", ["both", "long", "short"])).toBe("both");
    expect(closestAllowed("descending", ["desc", "asc"])).toBe("desc");
    expect(closestAllowed("percent", ["usd", "pct"])).toBe("pct");
    expect(closestAllowed("pnl", ["volume", "realized_pnl"])).toBe("realized_pnl");
    expect(closestAllowed("outcomes", ["perp", "spot", "prediction", "option"])).toBe("prediction");
    expect(closestAllowed("all", ["perp", "spot", "prediction", "option"])).toBeUndefined();
  });

  it("reads nothing into a probe or an empty value", () => {
    expect(closestAllowed(PROBE, OI_WINDOWS)).toBeUndefined();
    expect(closestAllowed("", OI_WINDOWS)).toBeUndefined();
    expect(closestAllowed("real", ["paper", "live"])).toBeUndefined();
  });
});

describe("fitEnums", () => {
  const schema = tools.find((t) => t.name === "get_open_interest_changes")!.inputSchema;

  it("leaves out a value it cannot read, so the default applies", () => {
    const { args, fixes } = fitEnums(schema, { window: PROBE, sort: "pct", limit: 5 });
    expect(args).toEqual({ sort: "pct", limit: 5 });
    expect(fixes).toEqual([{ key: "window", given: PROBE, allowed: OI_WINDOWS, usedAs: undefined }]);
  });

  it("reads an obvious value as the allowed one", () => {
    const { args, fixes } = fitEnums(schema, { window: "1d", sort: "Percent" });
    expect(args).toEqual({ window: "24h", sort: "pct" });
    expect(fixes.map((f) => [f.key, f.usedAs])).toEqual([
      ["window", "24h"],
      ["sort", "pct"],
    ]);
  });

  it("passes allowed values, blanks and options without a list through, and does not change its input", () => {
    const input = { window: "4h", sort: " ", dex: PROBE, min_oi_usd: 1 };
    const { args, fixes } = fitEnums(schema, input);
    expect(args).toEqual({ window: "4h", dex: PROBE, min_oi_usd: 1 });
    expect(fixes).toEqual([]);
    expect(input.sort).toBe(" ");
  });

  it("leaves out values of the wrong type", () => {
    const { args, fixes } = fitEnums(schema, { window: 24, sort: { by: "usd" } });
    expect(args).toEqual({});
    expect(fixes.map((f) => f.key)).toEqual(["window", "sort"]);
  });

  it("throws for a required option it cannot read, which has no default", () => {
    const s = { properties: { side: { type: "string", enum: ["long", "short"] } }, required: ["side"] };
    expect(() => fitEnums(s, { side: PROBE })).toThrow(`"side" must be one of long, short, not "${PROBE}"`);
    expect(fitEnums(s, { side: "shorts" }).args).toEqual({ side: "short" });
  });

  it("throws instead of falling back when strict, and still reads obvious values", () => {
    const s = { properties: { side: { type: "string", enum: ["any", "long", "short"] } } };
    expect(() => fitEnums(s, { side: PROBE }, { strict: true })).toThrow(
      `"side" must be one of any, long, short, not "${PROBE}"; nothing was changed`
    );
    expect(fitEnums(s, { side: "Longs" }, { strict: true })).toEqual({
      args: { side: "long" },
      fixes: [{ key: "side", given: "Longs", allowed: ["any", "long", "short"], usedAs: "long" }],
    });
    expect(fitEnums(s, { side: "all" }, { strict: true }).args).toEqual({ side: "any" });
    expect(fitEnums(s, { side: "short" }, { strict: true })).toEqual({ args: { side: "short" }, fixes: [] });
    expect(fitEnums(s, {}, { strict: true })).toEqual({ args: {}, fixes: [] });
  });

  it("fits each entry of a list option and keeps the list when every entry is allowed", () => {
    const s = { properties: { markets: { type: "array", items: { enum: ["perps", "outcomes", "spot"] } } } };
    expect(fitEnums(s, { markets: ["perps", "spot"] })).toEqual({ args: { markets: ["perps", "spot"] }, fixes: [] });
    expect(fitEnums(s, { markets: "perps,spot" })).toEqual({ args: { markets: "perps,spot" }, fixes: [] });

    const { args, fixes } = fitEnums(s, { markets: ["Perp", PROBE, "spot"] });
    expect(args).toEqual({ markets: ["perps", "spot"] });
    expect(fixes).toEqual([
      { key: "markets", given: "Perp", allowed: ["perps", "outcomes", "spot"], usedAs: "perps", inList: true },
      { key: "markets", given: PROBE, allowed: ["perps", "outcomes", "spot"], usedAs: undefined, inList: true },
    ]);
    expect(fitEnums(s, { markets: `${PROBE}, futures` }).args).toEqual({});

    // Strict: one entry that cannot be read refuses the whole list.
    expect(() => fitEnums(s, { markets: ["perps", "futures"] }, { strict: true })).toThrow(
      '"markets" must be one of perps, outcomes, spot, not "futures"; nothing was changed'
    );
    expect(fitEnums(s, { markets: ["Perp", "spot"] }, { strict: true }).args).toEqual({ markets: ["perps", "spot"] });
  });
});

// Every tool with an option list, called with the probe in each option: the
// value never reaches the API. A read-only tool runs with its default and
// the notice names the value; a tool that changes something (readOnlyHint
// false) answers with an error and sends nothing.
describe("tools called with values outside their lists", () => {
  const REQUIRED: Record<string, unknown> = {
    market: "BTC-PERP",
    address: "0x9b3cafa1209ac61f02d7bc3b219697fb171c9c91",
    id: "6f1c2a3b-1111-4222-8333-944455556666",
    at: "2026-11-01T00:00:00Z",
    sql: "SELECT 1",
    name: "top_pnl_30d",
  };
  const EXTRA: Record<string, Record<string, unknown>> = {
    create_liquidation_alert: { url: "https://hooks.slack.com/services/T0/B0/x" },
  };

  type Result = { isError?: boolean; content: { text: string }[]; structuredContent?: Record<string, unknown> };
  let sent: string[] = [];

  async function connect(): Promise<Client> {
    sent = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        sent.push(`${url} ${init?.body ?? ""}`);
        return new Response(JSON.stringify({ data: [], columns: [], rows: [], windows: [] }), {
          headers: { "content-type": "application/json" },
        });
      })
    );
    const server = createServer(new IronflowAPI("http://api", "if_test"), "test");
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(b);
    return client;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const listed = (t: (typeof tools)[number]) =>
    Object.entries(t.inputSchema.properties)
      .filter(([, p]) => p.enum)
      .map(([k]) => k);
  const enumTools = tools.filter((t) => listed(t).length > 0);
  const writes = (t: (typeof tools)[number]) => t.annotations?.readOnlyHint === false;

  it("covers every tool with an option list", () => {
    // 19 tools when this was written, the three that failed in production
    // among them; tools added later are swept below without a change here.
    expect(enumTools.length).toBeGreaterThanOrEqual(19);
    expect(enumTools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["get_open_interest_changes", "get_top_traders", "get_markets_snapshot", "create_liquidation_alert"])
    );
  });

  it("has write tools among them, which are strict", () => {
    expect(enumTools.filter(writes).map((t) => t.name)).toEqual(expect.arrayContaining(["create_liquidation_alert"]));
  });

  for (const tool of enumTools.filter(writes)) {
    it(`${tool.name} changes something, so it refuses the probe and sends nothing`, async () => {
      const client = await connect();
      const args: Record<string, unknown> = { ...EXTRA[tool.name] };
      for (const key of tool.inputSchema.required) args[key] = REQUIRED[key];
      for (const key of listed(tool)) args[key] = PROBE;
      const res = (await client.callTool({ name: tool.name, arguments: args })) as Result;

      expect(res.isError).toBe(true);
      expect(sent).toEqual([]);
      const first = listed(tool)[0];
      const allowed = tool.inputSchema.properties[first].enum!.join(", ");
      expect(res.content[0].text).toBe(`Error: "${first}" must be one of ${allowed}, not "${PROBE}"; nothing was changed`);
    });
  }

  for (const tool of enumTools.filter((t) => !writes(t))) {
    it(`${tool.name} never sends the probe and names it in the notice`, async () => {
      const client = await connect();
      const args: Record<string, unknown> = { ...EXTRA[tool.name] };
      for (const key of tool.inputSchema.required) args[key] = REQUIRED[key];
      for (const key of listed(tool)) args[key] = PROBE;
      const res = (await client.callTool({ name: tool.name, arguments: args })) as Result;

      expect(res.isError, res.content[0].text).toBeFalsy();
      expect(sent.length).toBeGreaterThan(0);
      for (const request of sent) expect(request).not.toContain(PROBE);
      const notice = String(res.structuredContent?.notice);
      expect(res.content[0].text.startsWith('{"notice":"Ignored ')).toBe(true);
      for (const key of listed(tool)) {
        const allowed = tool.inputSchema.properties[key].enum!.join(", ");
        expect(notice).toContain(`Ignored ${key} "${PROBE}" (allowed: ${allowed}), so the default applies.`);
      }
    });
  }

  it("runs the three calls that failed in production with their defaults", async () => {
    const client = await connect();
    await client.callTool({ name: "get_open_interest_changes", arguments: { window: PROBE } });
    await client.callTool({ name: "get_top_traders", arguments: { window: PROBE } });
    await client.callTool({ name: "get_markets_snapshot", arguments: { market_class: PROBE } });
    const urls = sent.map((s) => new URL(s.split(" ")[0]));
    expect(urls[0].pathname).toBe("/v1/open-interest/changes");
    expect(urls[0].searchParams.get("window")).toBe("24h");
    expect(urls[1].pathname).toBe("/v1/copy-feed");
    expect(urls[1].searchParams.get("window")).toBe("30d");
    expect(urls[2].searchParams.has("market_class")).toBe(false);
  });

  it("sends the value an obvious one maps to and says so first", async () => {
    const client = await connect();
    const res = (await client.callTool({
      name: "get_open_interest_changes",
      arguments: { window: "1d", sort: "pct" },
    })) as Result;
    expect(new URL(sent[0].split(" ")[0]).searchParams.get("window")).toBe("24h");
    expect(res.structuredContent?.notice).toBe('Read window "1d" as 24h (allowed: 1h, 4h, 24h, 7d).');
  });

  it("puts its notice before the API's", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: [] }), {
        headers: { "content-type": "application/json", "X-Ironflow-Market": "BTC-PERP" },
      }))
    );
    const server = createServer(new IronflowAPI("http://api", "if_test"), "test");
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(b);
    const res = (await client.callTool({ name: "get_candles", arguments: { market: "BTC", interval: "hourly" } })) as Result;
    expect(res.structuredContent?.notice).toBe(
      'Read interval "hourly" as 1h (allowed: 1m, 5m, 15m, 1h, 4h, 1d). Market "BTC" was read as BTC-PERP.'
    );
  });

  it("keeps the notice on an error result", async () => {
    const client = await connect();
    // get_candles needs a market, so it fails before any request; the error
    // still names the ignored interval.
    const res = (await client.callTool({ name: "get_candles", arguments: { interval: PROBE } })) as Result;
    expect(res.isError).toBe(true);
    expect(sent).toEqual([]);
    expect(res.content[0].text).toBe(
      `Error: "market" is required and must be a non-empty string Ignored interval "${PROBE}" (allowed: 1m, 5m, 15m, 1h, 4h, 1d), so the default applies.`
    );
  });

  it("creates an alert with a value an obvious one maps to, and says so", async () => {
    const client = await connect();
    const res = (await client.callTool({
      name: "create_liquidation_alert",
      arguments: { url: "https://hooks.slack.com/services/T0/B0/x", side: "longs" },
    })) as Result;
    expect(res.isError).toBeFalsy();
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0].slice(sent[0].indexOf(" ") + 1))).toEqual({ url: "https://hooks.slack.com/services/T0/B0/x", side: "long" });
    expect(res.structuredContent?.notice).toBe('Read side "longs" as long (allowed: any, long, short).');
  });

  it("does not create an alert for any side when the side cannot be read", async () => {
    const client = await connect();
    const res = (await client.callTool({
      name: "create_liquidation_alert",
      arguments: { url: "https://hooks.slack.com/services/T0/B0/x", side: "liquidated longs", min_usd: 100000 },
    })) as Result;
    expect(res.isError).toBe(true);
    expect(sent).toEqual([]);
    expect(res.content[0].text).toBe('Error: "side" must be one of any, long, short, not "liquidated longs"; nothing was changed');
  });
});
