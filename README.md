# @ironflowsh/mcp

MCP server for [Ironflow](https://ironflow.sh): read-only Hyperliquid market data and wallet analytics for Claude Desktop, Cursor and any MCP client. It covers native perps, HIP-3 builder markets, HIP-4 outcome markets and spot. 30 tools, all read-only.

No API key needed to start: keyless calls get 10 requests per minute and 24 hours of history. A free key from [ironflow.sh/key](https://ironflow.sh/key) raises that to 60 requests per minute and 30 days.

## Example questions

> "What were the largest Hyperliquid liquidations in the last 24 hours?"

> "Show funding rates for the HIP-3 markets right now."

> "List the HIP-4 outcome markets that are live."

> "Summarize this wallet's last 30 days: PnL, fees, maker share, funding paid."

## Install

```bash
npx -y @ironflowsh/mcp
```

Requires Node.js 18+.

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%/Claude/claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "ironflow": {
      "command": "npx",
      "args": ["-y", "@ironflowsh/mcp"]
    }
  }
}
```

To use a key in Claude Desktop or Cursor, add `"env": { "IRONFLOW_API_KEY": "if_your_api_key" }` to the server block.

## Claude Code

```bash
claude mcp add ironflow -- npx -y @ironflowsh/mcp

# with a free key
claude mcp add ironflow -e IRONFLOW_API_KEY=if_your_api_key -- npx -y @ironflowsh/mcp
```

## Cursor

Add the same `mcpServers` block to `~/.cursor/mcp.json` or a project's `.cursor/mcp.json`.

## Tools

**Market data:** `get_price`, `get_recent_trades`, `get_candles`, `get_funding_rates`, `get_open_interest`, `get_liquidations`, `get_fills`, `get_mark_prices`, `get_vault_operations`, `list_markets`, `get_markets_snapshot`

**Market analytics:** `get_net_flows`, `get_liquidation_levels`, `get_order_flow`, `get_funding_stats`, `get_vault_leaderboard`, `get_pnl_leaderboard`, `get_market_top_wallets`, `get_wallet_labels`

**Wallet analytics:** `get_user_state`, `get_user_summary`, `get_user_pnl_series`, `get_user_funding`, `get_user_maker_taker`, `get_user_ledger`

**Cohorts:** `list_cohorts`, `get_cohort_addresses`

**Status:** `get_status`, `get_status_metrics`, `get_status_history`

Fill history covers a rolling 12 months. There is no order book, order status or streaming tool.

## Configuration

| Env var | Default |
|---|---|
| `IRONFLOW_API_KEY` | optional; free key at [ironflow.sh/key](https://ironflow.sh/key) |
| `IRONFLOW_API_URL` | `https://api.ironflow.sh` |

## Links

- Docs: [docs.ironflow.sh](https://docs.ironflow.sh)
- API reference: [docs.ironflow.sh/api-reference](https://docs.ironflow.sh/api-reference)
- Hyperliquid node guides: [ironflow.sh/guides](https://ironflow.sh/guides)

## License

MIT
