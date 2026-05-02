# @ironflowsh/mcp

Model Context Protocol (MCP) server for [Ironflow](https://ironflow.sh) — real-time and historical market data for on-chain derivatives, designed for AI agents.

Exposes 32 tools for market data, analytics, triggers, cohorts, bulk export, and system status. Works with Claude Desktop, Cursor, any MCP-compatible client.

## Install

```bash
# Run directly (no install)
npx @ironflowsh/mcp

# Or install globally
npm install -g @ironflowsh/mcp
```

Requires Node.js 18+.

## Use with Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%/Claude/claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "ironflow": {
      "command": "npx",
      "args": ["-y", "@ironflowsh/mcp"],
      "env": {
        "IRONFLOW_API_KEY": "if_your_api_key"
      }
    }
  }
}
```

Restart Claude Desktop.

## Authentication

Without an API key: 10 req/min, 24h history, REST only. Sign up at [ironflow.sh](https://ironflow.sh/dashboard/login) for higher limits.

```bash
IRONFLOW_API_KEY=if_xxx npx @ironflowsh/mcp
```

## Tools

**Market data** — `get_price`, `get_orderbook`, `get_recent_trades`, `get_candles`, `get_funding_rates`, `get_open_interest`, `get_liquidations`, `get_fills`, `get_mark_prices`, `get_deposits`, `get_withdrawals`, `get_order_statuses`, `get_vault_operations`, `list_markets`

**Analytics** (Builder+) — `get_net_flows`, `get_liquidation_levels`, `get_order_flow`, `get_vault_leaderboard`, `get_funding_stats`

**Export** (Builder+) — `export_data`

**Triggers** — `list_triggers`, `create_trigger`, `test_trigger`, `toggle_trigger`, `delete_trigger`

**Cohorts** — `list_cohorts`, `get_cohort_addresses`, `delete_cohort`

**Account & status** — `get_me`, `get_status`, `get_status_metrics`, `get_status_history`

## Configuration

| Env var | Default |
|---|---|
| `IRONFLOW_API_KEY` | — |
| `IRONFLOW_API_URL` | `https://api.ironflow.sh` |

## Links

- Dashboard: [ironflow.sh/dashboard](https://ironflow.sh/dashboard)
- Docs: [docs.ironflow.sh](https://docs.ironflow.sh)
- API reference: [docs.ironflow.sh/api-reference](https://docs.ironflow.sh/api-reference)

## License

MIT
