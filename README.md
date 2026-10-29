# @ironflowsh/mcp

[![Smithery](https://img.shields.io/badge/Smithery-ironflow%2Fhyperliquid-FF5601)](https://smithery.ai/servers/ironflow/hyperliquid)

MCP server for [Ironflow](https://ironflow.sh): read-only Hyperliquid market data and wallet analytics for Claude, Cursor and any MCP client. It covers native perps, HIP-3 builder markets, HIP-4 outcome markets and spot. 36 tools, all read-only, including `run_query` for read-only SQL over every Hyperliquid fill, wallet, funding and liquidation table.

No API key needed to start: keyless calls get 10 requests per minute, 500 per day and 24 hours of history. A free key from [ironflow.sh/key](https://ironflow.sh/key) raises that to 60 requests per minute and 30 days.

## Install

The hosted server needs no install and no key: `https://mcp.ironflow.sh/mcp` (Streamable HTTP).

[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=ironflow&config=eyJ1cmwiOiJodHRwczovL21jcC5pcm9uZmxvdy5zaC9tY3AifQ%3D%3D)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Ironflow-0098FF?logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522ironflow%2522%252C%2522type%2522%253A%2522http%2522%252C%2522url%2522%253A%2522https%253A%252F%252Fmcp.ironflow.sh%252Fmcp%2522%257D)

**Claude Code**

```bash
claude mcp add --transport http ironflow https://mcp.ironflow.sh/mcp
```

**Claude (claude.ai and Claude Desktop)**: open Customize → Connectors, click Add custom connector, enter the name `Ironflow` and the URL `https://mcp.ironflow.sh/mcp`, then click Add. On Team and Enterprise plans an Owner adds it under Organization settings → Connectors → Add → Custom, and members then click Connect.

**Cursor**: the button above, or add this to `~/.cursor/mcp.json` (or a project's `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "ironflow": { "url": "https://mcp.ironflow.sh/mcp" }
  }
}
```

**VS Code**: the button above, or

```bash
code --add-mcp '{"name":"ironflow","type":"http","url":"https://mcp.ironflow.sh/mcp"}'
```

**Local server (stdio)**: `npx -y @ironflowsh/mcp`, see [Local server](#local-server).

### With a free key

Send it as `Authorization: Bearer if_your_api_key`, or as `?key=if_your_api_key` on the URL for clients that cannot set headers.

```bash
claude mcp add --transport http ironflow https://mcp.ironflow.sh/mcp \
  --header "Authorization: Bearer if_your_api_key"
```

In Cursor, add `"headers": { "Authorization": "Bearer if_your_api_key" }` next to `url`.

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

**Ask anything (SQL):** `describe_data` lists the queryable tables, columns and example queries; `run_query` runs one read-only ClickHouse SELECT over them (every fill, per-wallet daily totals, behaviour labels, funding, mark and oracle prices, open interest, liquidations, builder-code fills, transfers, vault flows); `get_wallet_behavior` returns 30-day trading-style labels per wallet. Keyless queries see the last 24 hours; a free key sees 30 days.

**Market data:** `get_price`, `get_recent_trades`, `get_candles`, `get_funding_rates`, `get_open_interest`, `get_liquidations`, `get_liquidation_summary`, `get_fills`, `get_mark_prices`, `get_vault_operations`, `list_markets`, `get_markets_snapshot`

**Market analytics:** `get_funding_stats`, `get_pnl_leaderboard`, `get_market_top_wallets`, `get_wallet_labels`, `get_vault_leaderboard` and `get_liquidation_levels` (needs a Builder or Enterprise key)

**Signals:** `get_top_traders`, `get_market_leaders`, `get_early_movers`, `get_trader_profile`

**Wallet analytics:** `get_user_state`, `get_user_summary`, `get_user_pnl_series`, `get_user_funding`, `get_user_maker_taker`, `get_user_ledger`

**Cohorts:** `list_cohorts`, `get_cohort_addresses`

**Status:** `get_status`, `get_status_metrics`, `get_status_history`

Markets can be given as display symbols (`BTC-PERP`, `xyz:NVDA-PERP`, `HYPE/USDC`) or Hyperliquid names (`BTC`, `@107`, `xyz:NVDA`), and times as Unix ms, Unix seconds or ISO 8601. When the API reads a name, or serves a window that starts later than asked because of the key's history limit, the result starts with a `notice` saying so. Fill history covers a rolling 12 months. There is no order book, order status or streaming tool.

## Configuration

| Env var | Default |
|---|---|
| `IRONFLOW_API_KEY` | optional; free key at [ironflow.sh/key](https://ironflow.sh/key) |
| `IRONFLOW_API_URL` | `https://api.ironflow.sh` |
| `PORT` (HTTP server) | `8080` |
| `MCP_LOG_SALT` (HTTP server) | random per process; keys the caller hash in the access log |

## Usage data

Each API call carries two headers so we can see which apps and tools people use: `X-Ironflow-Client` (the MCP client's name and version, e.g. `claude-code/2.1.0`) and `X-Ironflow-Tool` (the tool name). The hosted server logs each request's method, tool arguments, client name, status, whether the tool returned an error, the API status and error code behind it, and a salted hash of the caller's IP. It never logs IPs or API keys.

## Links

- Docs: [docs.ironflow.sh](https://docs.ironflow.sh)
- API reference: [docs.ironflow.sh/api-reference](https://docs.ironflow.sh/api-reference)
- Hyperliquid node guides: [ironflow.sh/guides](https://ironflow.sh/guides)

## License

MIT
