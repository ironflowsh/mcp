# @ironflowsh/mcp

MCP server for [Ironflow](https://ironflow.sh), the agent cloud for Hyperliquid. It gives Claude, Cursor and any MCP client Hyperliquid market data, wallet analytics, liquidation alerts and Ironbox sandboxes. It covers native perps, HIP-3 builder markets, HIP-4 outcome markets and spot, with every fill since 25 May 2025.

54 tools:

- 42 read data, including `run_query` for read-only SQL over every fill, wallet, funding and liquidation table.
- 4 manage liquidation alerts that Ironflow posts to your Discord, Slack, Telegram or webhook.
- 8 run [Ironbox](https://ironflow.sh/ironbox), a cloud sandbox for trading agents next to Hyperliquid. Test a Hyperliquid trading bot on a paper account with 10,000 USD and live prices, or run breakout, grid and DCA strategies on it. A paper box never places a real order.

No API key needed to start: keyless calls get 30 requests a minute, 100 credits a day and 24 hours of history. A free key from [ironflow.sh/key](https://ironflow.sh/key) gives 60 requests a minute, 1,000 credits a day and 14 days. A read costs 1 credit, analytics 5 and SQL 10 (see [Limits](#limits)). Agents with a USDC wallet on Base can also pay per call with x402, from $0.001, with no key and no credits ([pay per call](https://docs.ironflow.sh/guides/pay-per-call)).

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

Get one at [ironflow.sh/key](https://ironflow.sh/key), or `POST https://api.ironflow.sh/v1/keys` with `{"email": "you@example.com"}`; the key is emailed to you. Send it as `Authorization: Bearer if_your_api_key`, or as `?key=if_your_api_key` on the URL for clients that cannot set headers.

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

**Ask anything (SQL):** `describe_data` lists the queryable tables, columns and example queries; `run_query` runs one read-only ClickHouse SELECT over them (every fill, per-wallet daily totals, behaviour labels, funding, mark and oracle prices, open interest, liquidations, builder-code fills, transfers, vault flows); `get_wallet_behavior` returns 30-day trading-style labels per wallet. A query costs 10 credits and `describe_data` none. Keyless queries see the last 24 hours; a free key sees 30 days.

**Market data:** `get_price`, `get_recent_trades`, `get_candles`, `get_funding_rates`, `get_open_interest`, `get_open_interest_changes`, `get_premium`, `get_outcome_markets`, `get_liquidations`, `get_liquidation_summary`, `get_auto_deleveraging`, `get_fills`, `get_mark_prices`, `get_vault_operations`, `list_markets`, `get_markets_snapshot`

**Market analytics:** `get_funding_stats`, `get_pnl_leaderboard`, `get_market_top_wallets`, `get_wallet_labels`, `get_vault_leaderboard`, `get_liquidation_levels` (past liquidations by price; a 10-level sample without a key, every level with a free one) and `get_liquidation_map` (where open positions would be liquidated if the price moved, from every open position on our node)

**Signals:** `get_top_traders`, `get_market_leaders`, `get_early_movers`, `get_trader_profile`

**Wallet analytics:** `get_user_state`, `get_positions_at`, `get_user_summary`, `get_user_pnl_series`, `get_user_funding`, `get_user_maker_taker`, `get_user_ledger`

**Cohorts:** `list_cohorts`, `get_cohort_addresses`

**Status:** `get_status`, `get_status_metrics`, `get_status_history`

**Liquidation alerts** (need an API key; a free key allows one): `create_liquidation_alert` has Ironflow post matching liquidations to a Discord channel, Slack channel, Telegram chat or HTTPS webhook within seconds, filtered by market, side, size and wallet, and keeps posting after the conversation ends; `list_liquidation_alerts`, `test_liquidation_alert` and `delete_liquidation_alert` manage them. Guide: [docs.ironflow.sh/guides/liquidation-alerts](https://docs.ironflow.sh/guides/liquidation-alerts).

**Ironbox**: `create_ironbox` spins up a secure sandbox next to Hyperliquid where an agent trades on paper. With no key it makes a 24-hour trial paper box; a free key keeps a box. `start_box_strategy`, `list_box_strategies`, `stop_box_strategy` and `get_box_activity` run breakout, grid and DCA strategies on a paper box with no client connected, and need only its URL. `get_ironbox` and `delete_ironbox` need a key; `list_ironboxes` without a key says how to make a trial box. Called without a key, a tool that needs one answers with the free key link instead of calling the API. `https://mcp.ironflow.sh/data` serves only the 42 read-only data tools, without the alert and Ironbox tools.

**Prompts:** `biggest_liquidations`, `liquidation_map`, `market_movers` and `wallet_check` are ready-made starts. Claude Code shows them as slash commands; other clients list them in a prompt menu. Each asks only for read-only tools, on both addresses.

Markets can be given as display symbols (`BTC-PERP`, `xyz:NVDA-PERP`, `HYPE/USDC`) or Hyperliquid names (`BTC`, `@107`, `xyz:NVDA`), and times as Unix ms, Unix seconds, ISO 8601 or relative to now (`-7d`, `-24h`, `now`). When the API reads a name, or serves a window that starts later than asked because of the key's history limit, the result starts with a `notice` saying so. Fill history starts on 25 May 2025. There is no order book, order status or streaming tool; for live feeds the REST API has `/v1/liquidations/stream` and `/v1/trades/stream` (Server-Sent Events, 1 credit to open and 1 a minute).

## Limits

Every call costs credits: a read 1, analytics 5 (such as the liquidation map and summary and wallet analytics), SQL 10. Status and `describe_data` cost nothing.

| | Requests a minute | Credits | History |
|---|---|---|---|
| No key | 30 | 100 a day per IP (rolling 24 hours) | 24 hours |
| Free key | 60 | 1,000 a day and 3,000 a month | 14 days |
| Explorer, 49 USDC per 30 days | 100 | 25,000 a day | 90 days |
| Builder, 149 USDC per 30 days | 1,000 | 250,000 a day | 1 year |

Enterprise has no credit cap. A keyless app that names itself in its `User-Agent` gets 300 credits a day across all its IPs. Key credits count per account, all its keys together, over the UTC day and, on a free key, the UTC month. Past them a tool returns the API's error: `KEYLESS_DAILY_LIMIT` without a key, `DAILY_QUOTA_EXCEEDED` (back at 00:00 UTC) or `MONTHLY_QUOTA_EXCEEDED` (free keys, back on the 1st at 00:00 UTC) with one. Plans: [ironflow.sh/upgrade](https://ironflow.sh/upgrade). Calls paid one by one with [x402](https://docs.ironflow.sh/guides/pay-per-call) (USDC on Base, from $0.001 a call, no key) cost no credits, have free key limits and are for personal use. Every limit: [docs.ironflow.sh/concepts/rate-limits](https://docs.ironflow.sh/concepts/rate-limits).

## Configuration

| Env var | Default |
|---|---|
| `IRONFLOW_API_KEY` | optional; free key at [ironflow.sh/key](https://ironflow.sh/key) |
| `IRONFLOW_API_URL` | `https://api.ironflow.sh` |
| `PORT` (HTTP server) | `8080` |
| `MCP_LOG_SALT` (HTTP server) | random per process; keys the caller hash in the access log |

## Usage data

Each API call carries two headers so we can see which apps and tools people use: `X-Ironflow-Client` (the MCP client's name and version, e.g. `claude-code/2.1.0`) and `X-Ironflow-Tool` (the tool name). The hosted server logs each request's method, tool arguments, client name, status, whether the tool returned an error, the API status and error code behind it, and a salted hash of the caller's IP. It also tells the API about each `initialize` and `tools/list` (the client name and version, and whether a key was set, not the key), so sessions are counted next to tool calls. It never logs IPs or API keys.

## Links

- Docs: [docs.ironflow.sh](https://docs.ironflow.sh)
- API reference: [docs.ironflow.sh/api-reference](https://docs.ironflow.sh/api-reference)
- Hyperliquid node guides: [ironflow.sh/guides](https://ironflow.sh/guides)

## License

MIT
