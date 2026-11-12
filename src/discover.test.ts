import { describe, expect, it } from "vitest";
import { DISCOVER_MESSAGE, discoverReply } from "./discover.js";

const discover = (id: unknown) => ({ jsonrpc: "2.0", id, method: "server/discover", params: {} });

describe("discoverReply", () => {
  it("answers server/discover method not found, echoing the id", () => {
    expect(discoverReply(discover(7))).toEqual({ jsonrpc: "2.0", id: 7, error: { code: -32601, message: DISCOVER_MESSAGE } });
    expect(discoverReply(discover("a1"))).toMatchObject({ id: "a1", error: { code: -32601 } });
  });

  it("tells the client to send initialize", () => {
    expect(DISCOVER_MESSAGE).toContain("initialize");
    expect(DISCOVER_MESSAGE).not.toMatch(/—/);
  });

  it("answers a batch of only server/discover requests, one reply each", () => {
    expect(discoverReply([discover(1), discover(2)])).toEqual([
      { jsonrpc: "2.0", id: 1, error: { code: -32601, message: DISCOVER_MESSAGE } },
      { jsonrpc: "2.0", id: 2, error: { code: -32601, message: DISCOVER_MESSAGE } },
    ]);
  });

  it("leaves initialize, other methods and mixed batches to the transport", () => {
    expect(discoverReply({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })).toBeUndefined();
    expect(discoverReply({ jsonrpc: "2.0", id: 1, method: "tools/list" })).toBeUndefined();
    expect(discoverReply([discover(1), { jsonrpc: "2.0", id: 2, method: "tools/list" }])).toBeUndefined();
    expect(discoverReply([])).toBeUndefined();
    expect(discoverReply(null)).toBeUndefined();
    expect(discoverReply("server/discover")).toBeUndefined();
  });

  it("replies with id null when the request has no usable id", () => {
    expect(discoverReply(discover({ nested: true }))).toMatchObject({ id: null });
  });
});
