import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, type ToolOutcome } from "./server.js";
import type { IronflowAPI } from "./api.js";

async function connect(api: Partial<IronflowAPI>, outcomes: ToolOutcome[]): Promise<Client> {
  const stub = { ...api, withContext: () => stub } as unknown as IronflowAPI;
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
