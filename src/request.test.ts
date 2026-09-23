import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { clientIP, HttpError, readKey } from "./request.js";

const req = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;
const url = (q = "") => new URL(`http://localhost/mcp${q}`);
const KEY = "if_abcdef1234567890";

describe("readKey", () => {
  it("is undefined without a key (keyless)", () => {
    expect(readKey(req({}), url())).toBeUndefined();
  });
  it("reads a bearer header", () => {
    expect(readKey(req({ authorization: `Bearer ${KEY}` }), url())).toBe(KEY);
  });
  it("reads ?key= for clients that cannot set headers", () => {
    expect(readKey(req({}), url(`?key=${KEY}`))).toBe(KEY);
  });
  it("prefers the header over the query", () => {
    expect(readKey(req({ authorization: `Bearer ${KEY}` }), url("?key=if_otherkey12345"))).toBe(KEY);
  });
  it("rejects a malformed key instead of silently going keyless", () => {
    expect(() => readKey(req({ authorization: "Bearer nope" }), url())).toThrow(HttpError);
  });
});

describe("clientIP", () => {
  it("ignores X-Forwarded-For unless the proxy is trusted", () => {
    expect(clientIP(req({ "x-forwarded-for": "1.2.3.4" }), false)).toBeUndefined();
  });
  it("takes the first X-Forwarded-For entry behind a trusted proxy", () => {
    expect(clientIP(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.3" }), true)).toBe("1.2.3.4");
    expect(clientIP(req({ "x-forwarded-for": "2a01:4f8::1" }), true)).toBe("2a01:4f8::1");
  });
  it("drops values that are not IPs", () => {
    expect(clientIP(req({ "x-forwarded-for": "evil\r\nX: y" }), true)).toBeUndefined();
  });
});
