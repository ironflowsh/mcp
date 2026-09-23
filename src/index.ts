#!/usr/bin/env node

// Ironflow MCP Server (stdio): read-only Hyperliquid data for AI agents.
//
// Usage:
//   IRONFLOW_API_KEY=if_xxx npx -y @ironflowsh/mcp
//
// The key is optional: keyless calls get 10 requests per minute and 24 hours
// of history; a free key from https://ironflow.sh/key gives 60 and 30 days.
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
    "IRONFLOW_API_KEY is not set: running keyless (10 requests per minute, 24 hours of history). Free key for more: https://ironflow.sh/key",
  );
}

const version = packageVersion();
const server = createServer(new IronflowAPI(apiUrl, apiKey, undefined, version), version);
await server.connect(new StdioServerTransport());
