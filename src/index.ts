#!/usr/bin/env node

// Ironflow MCP Server (stdio): read-only Hyperliquid data for AI agents.
//
// Usage:
//   IRONFLOW_API_KEY=if_xxx npx -y @ironflowsh/mcp
//
// The key is optional: keyless calls get 30 requests a minute, 100 credits a
// day and 24 hours of history; a free key from https://ironflow.sh/key gives
// 60 a minute, 1,000 credits a day (3,000 a month) and 14 days. A read costs
// 1 credit, analytics 5, SQL 10: https://docs.ironflow.sh/concepts/rate-limits
// No install needed at all with the hosted server:
//   claude mcp add --transport http ironflow https://mcp.ironflow.sh/mcp

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { IronflowAPI } from "./api.js";
import { createServer, packageVersion } from "./server.js";

const apiUrl = process.env.IRONFLOW_API_URL || "https://api.ironflow.sh";
const apiKey = process.env.IRONFLOW_API_KEY;

if (!apiKey) {
  // stderr: stdout carries the MCP protocol.
  console.error(
    "IRONFLOW_API_KEY is not set: running keyless (30 requests a minute, 100 credits a day, 24 hours of history). Free key for 1,000 credits a day: https://ironflow.sh/key?utm_source=mcp",
  );
}

const version = packageVersion();
const server = createServer(new IronflowAPI(apiUrl, apiKey, undefined, version), version);
await server.connect(new StdioServerTransport());
