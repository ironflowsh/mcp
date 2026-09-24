# @ironflowsh/mcp

MCP server for [Ironflow](https://ironflow.sh): read-only Hyperliquid market data and wallet analytics for Claude, Cursor and any MCP client. It covers native perps, HIP-3 builder markets, HIP-4 outcome markets and spot. 33 tools, all read-only.

No API key needed to start: keyless calls get 10 requests per minute and 24 hours of history. A free key from [ironflow.sh/key](https://ironflow.sh/key) raises that to 60 requests per minute and 30 days.

## Example questions

> "What were the largest Hyperliquid liquidations in the last 24 hours?"

> "Show funding rates for the HIP-3 markets right now."

> "List the HIP-4 outcome markets that are live."

> "Summarize this wallet's last 30 days: PnL, fees, maker share, funding paid."

## Hosted server (no install)

Connect by URL: `https://mcp.ironflow.sh/mcp` (Streamable HTTP).

```bash
# Claude Code
claude mcp add --transport http ironflow https://mcp.ironflow.sh/mcp

# with a free key
claude mcp add --transport http ironflow https://mcp.ironflow.sh/mcp \
  --header "Authorization: Bearer if_your_api_key"
```

Claude desktop and claude.ai: Settings → Connectors → Add custom connector, paste the URL.

Cursor (`~/.cursor/mcp.json` or a project's `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "ironflow": { "url": "https://mcp.ironflow.sh/mcp" }
  }
}
```

Clients that cannot send headers can pass the key as `?key=if_your_api_key` on the URL.

## Local server

```bash
npx -y @ironflowsh/mcp
```

Requires Node.js 18+. Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%/Claude/claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "ironflow": {
      "command": "npx",
      "args": ["-y", "@ironflowsh/mcp"],
      "env": { "IRONFLOW_API_KEY": "if_your_api_key" }
    }
  }
}
```

The `env` block is optional. Claude Code: `claude mcp add ironflow -- npx -y @ironflowsh/mcp`.

To host the HTTP server yourself: `npx -y -p @ironflowsh/mcp ironflow-mcp-http` (listens on `PORT`, default 8080, path `/mcp`).

## Tools

**Market data:** `get_price`, `get_recent_trades`, `get_candles`, `get_funding_rates`, `get_open_interest`, `get_liquidations`, `get_liquidation_summary`, `get_fills`, `get_mark_prices`, `get_vault_operations`, `list_markets`, `get_markets_snapshot`

**Market analytics:** `get_funding_stats`, `get_pnl_leaderboard`, `get_market_top_wallets`, `get_wallet_labels`, `get_liquidation_levels` and `get_vault_leaderboard` (these two need a Builder or Enterprise key)

**Signals:** `get_top_traders`, `get_market_leaders`, `get_early_movers`, `get_trader_profile`

**Wallet analytics:** `get_user_state`, `get_user_summary`, `get_user_pnl_series`, `get_user_funding`, `get_user_maker_taker`, `get_user_ledger`

**Cohorts:** `list_cohorts`, `get_cohort_addresses`

**Status:** `get_status`, `get_status_metrics`, `get_status_history`

Fill history covers a rolling 12 months. There is no order book, order status or streaming tool.

## Configuration

| Env var | Default |
|---|---|
| `IRONFLOW_API_KEY` | optional; free key at [ironflow.sh/key](https://ironflow.sh/key) |
| `IRONFLOW_API_URL` | `https://api.ironflow.sh` |
| `PORT` (HTTP server) | `8080` |

## Links

- Docs: [docs.ironflow.sh](https://docs.ironflow.sh)
- API reference: [docs.ironflow.sh/api-reference](https://docs.ironflow.sh/api-reference)
- Hyperliquid node guides: [ironflow.sh/guides](https://ironflow.sh/guides)

## License

MIT
