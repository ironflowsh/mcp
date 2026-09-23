#!/usr/bin/env node

// Ironflow MCP Server: read-only Hyperliquid data for AI agents.
//
// Usage:
//   IRONFLOW_API_KEY=if_xxx npx -y @ironflowsh/mcp
//
// The key is optional: keyless calls get 10 requests per minute and 24 hours
// of history; a free key from https://ironflow.sh/key gives 60 and 30 days.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { IronflowAPI } from "./api.js";
import { tools } from "./tools.js";

const apiUrl = process.env.IRONFLOW_API_URL || "https://api.ironflow.sh";
const apiKey = process.env.IRONFLOW_API_KEY;

if (!apiKey) {
  // stderr: stdout carries the MCP protocol.
  console.error(
    "IRONFLOW_API_KEY is not set: running keyless (10 requests per minute, 24 hours of history). Free key for more: https://ironflow.sh/key",
  );
}

// Read the package version from package.json so MCP clients see the
// real installed version in serverInfo, not a hardcoded constant that
// drifts on every release.
const here = dirname(fileURLToPath(import.meta.url));
let pkgVersion = "unknown";
try {
  const pkgRaw = readFileSync(join(here, "..", "package.json"), "utf-8");
  pkgVersion = (JSON.parse(pkgRaw).version as string) ?? "unknown";
} catch {
  // Fall through with "unknown" — the server still functions; only
  // the version string in initialize() is affected.
}

const api = new IronflowAPI(apiUrl, apiKey, undefined, pkgVersion);

const server = new Server(
  {
    name: "ironflow",
    version: pkgVersion,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List all available tools.
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  };
});

// Handle tool calls.
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    const result = await tool.handler(args ?? {}, api);
    return {
      content: [{ type: "text", text: result }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
