// Output schemas for every tool (MCP structured output). Written from real
// API responses. They describe fields without pinning JSON types or marking
// fields required: MCP clients validate structuredContent against these, and
// a schema stricter than the API (a number that arrives as a string, a
// field that is sometimes null) would turn a working tool into an error.

export type Schema = Record<string, unknown>;

const d = (description: string): Schema => ({ description });

const obj = (description: string, properties: Record<string, Schema>): Schema => ({
  type: "object",
  description,
  properties,
});

const arr = (description: string, items: Schema): Schema => ({ type: "array", description, items });

// Fields that recur across endpoints.
const F = {
  source: d("Venue, always hyperliquid"),
  market: d('Display symbol, e.g. "BTC-PERP" or "xyz:NVDA-PERP"'),
  display_symbol: d('Display symbol, e.g. "BTC-PERP" or "xyz:NVDA-PERP"'),
  issuer: d('HIP-3 builder code ("" for native markets)'),
  base_market: d("Display symbol without the HIP-3 issuer prefix"),
  market_type: d("perp, spot or prediction"),
  market_class: d("perp, spot, prediction or option"),
  timestamp: d("Unix milliseconds"),
  block_number: d("Hyperliquid block height"),
  address: d("Wallet address (0x…)"),
  side: d('Fill side, "buy" or "sell"'),
  price: d("Price in USD"),
  size: d("Size in base units"),
  fee: d("Fee paid in USD"),
  realized_pnl: d("Realized PnL in USD"),
  venue: d("Venue, always hyperliquid"),
  quote_asset: d("Quote asset, e.g. USDC"),
  sequence: d("Order of the event within its block"),
  from: d("Window start, Unix milliseconds"),
  to: d("Window end, Unix milliseconds"),
  window: d('Lookback window, e.g. "30d"'),
  win_rate: d("Share of closed trades that were profitable, 0 to 1"),
  profit_factor: d("Gross profit divided by gross loss"),
  trades: d("Closed trades in the window"),
  realized_pnl_usd: d("Realized PnL in USD"),
  avg_notional_usd: d("Average trade size in USD"),
  max_drawdown_pct: d("Largest peak-to-trough drop of the PnL curve, 0 to 1"),
  last_trade_ms: d("Last trade, Unix milliseconds"),
} satisfies Record<string, Schema>;

const ALERT = {
  id: d("Alert id (UUID)"),
  name: d("Label shown in each message"),
  type: d("webhook, discord, slack or telegram"),
  destination: d("Host it posts to, without the secret part of the URL"),
  markets: d("Markets watched; empty means every market"),
  side: d("any, long (longs liquidated) or short"),
  min_usd: d("Smallest liquidation reported, USD"),
  address: d("Only this wallet, when set"),
  status: d("active or disabled (after 20 failed deliveries in a row)"),
  failures: d("Failed deliveries in a row"),
  last_error: d("The destination's last error"),
  last_sent_at: d("Last delivery, RFC 3339; null before the first"),
  sent_count: d("Liquidations delivered so far"),
  created_at: d("Creation time, RFC 3339"),
};

const PAGINATION = obj("Cursor pagination", {
  next_cursor: d("Pass as cursor to fetch the next page; null on the last page"),
  has_more: d("Whether more rows exist"),
});

const page = (description: string, row: Record<string, Schema>): Schema =>
  obj(description, { data: arr(description, obj("One row", row)), pagination: PAGINATION });

const MARKET_ROW = {
  source: F.source,
  market: F.market,
  issuer: F.issuer,
  base_market: F.base_market,
  display_symbol: F.display_symbol,
  venue: F.venue,
  quote_asset: F.quote_asset,
  timestamp: F.timestamp,
};

const POSITION = obj("Open position", {
  market: F.market,
  market_class: F.market_class,
  size: d("Signed size: positive long, negative short"),
  entry_price: d("Average entry price"),
  mark_price: d("Current mark price"),
  position_value: d("Position value in USD"),
  unrealized_pnl: d("Unrealized PnL in USD"),
  realized_pnl: F.realized_pnl,
  return_on_equity: d("Unrealized PnL divided by margin"),
  leverage: d("Leverage"),
  leverage_type: d("cross or isolated"),
});

const USER_STATE = obj("Open positions right now", {
  address: F.address,
  as_of_ts: d("Snapshot time, Unix milliseconds"),
  asset_positions: arr("Open positions", POSITION),
  margin_summary: obj("Account totals", {
    total_position_value: d("Sum of position values in USD"),
    total_unrealized_pnl: d("Sum of unrealized PnL in USD"),
    total_realized_pnl: d("Sum of realized PnL in USD"),
    open_markets_count: d("Markets with an open position"),
  }),
});

const WALLET_STATS = {
  address: F.address,
  fills: d("Fills in the window"),
  volume_usd: d("Traded notional in USD"),
  realized_pnl: F.realized_pnl,
  wins: d("Profitable closing fills"),
  losses: d("Losing closing fills"),
  maker_fills: d("Fills as maker"),
  taker_fills: d("Fills as taker"),
  pct_maker: d("Share of fills as maker, 0 to 1"),
};

const TRADER = {
  address: F.address,
  win_rate: F.win_rate,
  profit_factor: F.profit_factor,
  trades: F.trades,
  realized_pnl_usd: F.realized_pnl_usd,
  avg_notional_usd: F.avg_notional_usd,
  last_trade_ms: F.last_trade_ms,
};

// Keyed by tool name. Every tool in tools.ts has an entry (pinned by a test).
const toolSchemas: Record<string, Schema> = {
  get_price: obj("Latest mark price", { market: F.market, price: F.price }),

  get_recent_trades: page("Trades, newest first", {
    ...MARKET_ROW,
    market_type: F.market_type,
    block_number: F.block_number,
    sequence: F.sequence,
    price: F.price,
    size: F.size,
    side: F.side,
    address: F.address,
    fee: F.fee,
    realized_pnl: F.realized_pnl,
  }),

  get_candles: page("OHLCV candles", {
    ...MARKET_ROW,
    interval: d("Candle interval"),
    open: d("Open price"),
    high: d("High price"),
    low: d("Low price"),
    close: d("Close price"),
    volume: d("Volume in base units"),
    trade_count: d("Trades in the candle"),
  }),

  get_funding_rates: page("Hourly funding rates", {
    ...MARKET_ROW,
    rate: d("Hourly funding rate; positive means longs pay shorts"),
    sequence: F.sequence,
  }),

  get_open_interest: page("Open interest samples", {
    ...MARKET_ROW,
    open_interest: d("Open interest in base units"),
    volume_24h: d("24h volume in USD"),
  }),

  get_liquidations: page("Liquidations", {
    ...MARKET_ROW,
    market_type: F.market_type,
    block_number: F.block_number,
    address: d("Liquidated wallet"),
    side: d('The liquidated wallet\'s fill side: "sell" closed a long, "buy" closed a short'),
    price: F.price,
    size: F.size,
    realized_pnl: F.realized_pnl,
  }),

  get_open_interest_changes: obj("Perps ranked by open interest change", {
    window: d("Lookback window: 1h, 4h, 24h or 7d"),
    sort: d("usd or pct"),
    count: d("Markets returned"),
    data: arr("Markets", obj("One market", {
      market: F.market,
      dex: d('HIP-3 dex, e.g. "xyz" (absent for native perps)'),
      oi_start: d("Open interest at the window start, in coins"),
      oi_end: d("Open interest now, in coins"),
      change_pct: d("Change in percent"),
      change_usd: d("Change in USD at the latest mark"),
      oi_end_usd: d("Open interest now in USD"),
      mark: d("Latest mark price"),
    })),
  }),

  get_outcome_markets: obj("HIP-4 outcome markets overview", {
    window_hours: d("Window of the totals, in hours"),
    notional_total: d("Volume in USD over the window"),
    fills_total: d("Fills over the window"),
    wallets_total: d("Wallets that traded over the window"),
    markets_active: d("Outcome markets listed now"),
    computed_at: d("When the summary was computed, Unix seconds"),
    top_markets: arr("Most traded outcomes, highest 24h volume first", obj("One outcome side", {
      market_id: d("Ironflow market id"),
      display_symbol: d('Outcome symbol, e.g. "BTC-77719-20261105-Yes"'),
      hl_coin: d('Hyperliquid coin, e.g. "#14730"'),
      last_price: d("Last traded price, the implied probability (0 to 1)"),
      last_fill_ms: d("Last fill, Unix milliseconds"),
      fills_24h: d("Fills in the last 24 hours"),
      notional_24h: d("Volume in USD in the last 24 hours"),
    })),
  }),

  get_premium: obj("Mark against oracle premium", {
    market: F.market,
    interval: d("Bucket size"),
    summary: obj("Premium over the window, in basis points", {
      latest_bps: d("Latest bucket"),
      mean_bps: d("Mean over the buckets"),
      min_bps: d("Lowest bucket"),
      max_bps: d("Highest bucket"),
      buckets: d("Number of buckets"),
    }),
    data: arr("Buckets, oldest first", obj("One bucket", {
      t: d("Bucket start, Unix milliseconds"),
      mark: d("Average mark price"),
      oracle: d("Average oracle price"),
      premium_bps: d("(mark / oracle - 1) x 10,000"),
    })),
  }),

  get_auto_deleveraging: obj("Auto-deleveraging fills, newest first", {
    count: d("Fills returned"),
    recorded_from: d("First moment recorded, Unix milliseconds"),
    data: arr("ADL fills", obj("One fill", {
      timestamp: F.timestamp,
      market: F.market,
      address: d("Wallet whose position was closed"),
      side: F.side,
      price: F.price,
      size: F.size,
      notional: d("Notional in USD"),
      realized_pnl: F.realized_pnl,
      tid: d("Trade id, shared with the liquidated side"),
      block: F.block_number,
      hash: d("Transaction hash (0x…)"),
    })),
  }),

  describe_data: obj("Catalog of the SQL tables run_query can read", {
    dialect: d("SQL dialect and database name"),
    tables: arr("Queryable tables", obj("One table", {
      name: d("Table name, e.g. hl.fills"),
      description: d("What one row is"),
      time_column: d("Column the history window filters on"),
      data_from: d("How far back the table goes"),
      columns: arr("Columns", obj("One column", { name: d("Name"), type: d("ClickHouse type"), description: d("Meaning") })),
    })),
    tips: arr("Query tips", d("One tip")),
    examples: arr("Worked examples", obj("One example", { question: d("Question"), sql: d("SQL that answers it") })),
    limits: d("Your tier's limits: history_days, max_execution_seconds, max_rows, budget_seconds_per_hour"),
    tiers: arr("Every tier's limits", d("One tier")),
  }),
  create_liquidation_alert: obj("The new alert", {
    ...ALERT,
    signing_secret: d("Webhooks only: HMAC key for the X-Ironflow-Signature header, shown only here"),
    setup: d("What to do before the first message arrives (Telegram: the bot to add to the chat)"),
  }),
  list_liquidation_alerts: obj("The account's liquidation alerts", {
    alerts: arr("Alerts", obj("One alert", ALERT)),
    limit: d("Alerts this tier allows"),
  }),
  test_liquidation_alert: obj("Test delivery result", {
    delivered: d("Whether the destination accepted the test message"),
    status: d("The alert's status afterwards"),
    error: d("The destination's answer when it was not delivered"),
  }),
  delete_liquidation_alert: obj("Deletion", { deleted: d("true"), id: d("The deleted alert's id") }),
  run_query: obj("Query result", {
    columns: arr("Column names in row order", d("Name")),
    column_types: arr("ClickHouse types in row order", d("Type")),
    rows: arr("Rows as positional arrays", d("One row")),
    row_count: d("Rows returned"),
    truncated: d("true when more rows existed than were returned"),
    stats: d("elapsed_ms, rows_read, bytes_read"),
    limits: d("Your tier's limits"),
    budget_remaining_seconds: d("Query seconds left this hour"),
  }),
  get_wallet_behavior: obj("Wallet trading behaviour over the last 30 days", {
    window_days: d("Days the features cover"),
    wallets: arr("Wallets", obj("One wallet", {
      address: d("Wallet address"),
      labels: arr("Behaviour labels", d("Label")),
      volume_usd: d("30-day volume in USD"),
      realized_pnl_usd: d("30-day realized PnL in USD"),
      maker_share: d("Maker volume / volume"),
      fills_per_day: d("Fills per active day"),
      liquidations: d("Liquidation events"),
    })),
  }),
  get_liquidation_summary: obj("Liquidation totals over the window", {
    window: d("Trailing window, e.g. 1h"),
    wallets: d("Distinct wallets liquidated"),
    from: F.from,
    to: F.to,
    market: d("Market filter, or null for all markets"),
    count: d("Number of liquidations"),
    notional_usd: d("Liquidated notional in USD"),
    longs_liquidated_usd: d("Notional of liquidated longs in USD"),
    shorts_liquidated_usd: d("Notional of liquidated shorts in USD"),
    by_market: arr(
      "Top markets by liquidated notional",
      obj("One market", { market: F.market, count: d("Liquidations"), notional_usd: d("Notional in USD") })
    ),
    largest: obj("Largest single liquidation, or null when there were none", {
      market: F.market,
      side: d('"long" or "short"'),
      notional_usd: d("Notional in USD"),
      price: F.price,
      address: F.address,
      timestamp: F.timestamp,
    }),
    complete: d("Always true: totals cover every liquidation in the window"),
  }),

  get_fills: page("Fills for one wallet, newest first", {
    ...MARKET_ROW,
    market_type: F.market_type,
    block_number: F.block_number,
    price: F.price,
    size: F.size,
    side: F.side,
    direction: d('e.g. "Open Long", "Close Short"'),
    fee: F.fee,
    realized_pnl: F.realized_pnl,
    address: F.address,
  }),

  get_mark_prices: page("Mark price samples", {
    ...MARKET_ROW,
    mark_price: d("Mark price"),
    oracle_price: d("Oracle price"),
    funding_rate: d("Current hourly funding rate"),
  }),

  get_vault_operations: page("Vault deposits and withdrawals", {
    source: F.source,
    timestamp: F.timestamp,
    block_number: F.block_number,
    address: d("Depositor"),
    vault: d("Vault address"),
    operation: d("deposit or withdraw"),
    token: d("Token, usually USDC"),
    requested_amount: d("Requested amount"),
    net_amount: d("Amount after commission and closing cost"),
    commission: d("Leader commission"),
    closing_cost: d("Cost of closing positions for the withdrawal"),
  }),

  get_liquidation_levels: obj("Liquidated notional by price bucket", {
    data: arr("Price buckets", obj("One bucket", { market: F.market })),
    bucket_size: d("Bucket width used (the one picked for auto)"),
    notice: d("Present without a key: the result is a 10-level sample"),
  }),

  get_liquidation_map: obj("Projected liquidations by price for one market", {
    market: F.market,
    mark_px: d("Current mark price"),
    as_of: d("When the map was priced (RFC 3339)"),
    snapshot: obj("The node state snapshot the positions come from", {
      height: d("Block height"),
      time: d("Block time (RFC 3339)"),
      age_s: d("Seconds since the snapshot"),
    }),
    bucket_size: d("Price range width used"),
    range_pct: d("Percent from the price covered"),
    side: d("both, long or short"),
    levels: arr("Price ranges, low to high", obj("One range", {
      price_lo: d("Range low"),
      price_hi: d("Range high"),
      long_usd: d("Long notional liquidated in this range"),
      short_usd: d("Short notional liquidated in this range"),
      cum_long_usd: d("Long notional liquidated from the price down to here"),
      cum_short_usd: d("Short notional liquidated from the price up to here"),
    })),
    coverage: obj("What the map covers", {
      notional_usd: d("Open notional on the market"),
      with_liq_px_pct: d("Percent of it with a liquidation price"),
      portfolio_margin_pct: d("Percent priced with Hyperliquid's own liquidationPx"),
    }),
    stale: d("True when the last snapshot could not be read and an older map is served"),
    notice: d("Present without a key: the result is a 10-range sample"),
  }),

  get_vault_leaderboard: obj("Vaults ranked by net deposits", {
    window_days: d("Days covered (keyless: 1); absent when served by the Builder endpoint"),
    data: arr(
      "Vaults",
      obj("One vault", {
        source: F.source,
        vault: d("Vault address"),
        total_deposits: d("USDC deposited in the window"),
        total_withdrawals: d("USDC withdrawn in the window"),
        net_flow: d("Deposits minus withdrawals, USDC"),
        unique_users: d("Distinct depositors and withdrawers"),
      })
    ),
  }),

  get_funding_stats: obj("Funding statistics per time bucket", {
    data: arr(
      "Buckets",
      obj("One bucket", {
        source: F.source,
        market: F.market,
        bucket: d("Bucket start, Unix milliseconds"),
        avg_rate: d("Average hourly rate"),
        min_rate: d("Lowest hourly rate"),
        max_rate: d("Highest hourly rate"),
        cumulative_rate: d("Sum of hourly rates in the bucket"),
      })
    ),
  }),

  get_user_state: USER_STATE,

  get_positions_at: obj("Perp positions at a past moment", {
    address: F.address,
    at: d("The moment, Unix milliseconds"),
    count: d("Positions returned"),
    method: d("How the sizes were rebuilt"),
    positions: arr("Positions, largest notional first", obj("One position", {
      market: F.market,
      side: d("long or short"),
      size: d("Signed size in coins: positive long, negative short"),
      mark_price: d("Last mark price at or before the moment"),
      notional: d("Size times mark price, in USD"),
      size_now: d("Signed size today"),
      fills_since: d("Fills in this market after the moment"),
    })),
  }),

  get_user_funding: obj("Funding paid or received per market per bucket", {
    total_rows: d("Rows in the window before the limit"),
    returned: d("Rows in data, most recent first"),
    address: F.address,
    bucket: d("Bucket size"),
    from: F.from,
    to: F.to,
    data: arr(
      "Buckets",
      obj("One bucket and market", {
        bucket_start: d("Bucket start, Unix milliseconds"),
        market: F.market,
        market_class: F.market_class,
        funding_payment: d("USD; positive received, negative paid"),
        avg_position: d("Average position size"),
        avg_funding_rate: d("Average hourly rate"),
        interval_count: d("Hourly payments in the bucket"),
      })
    ),
  }),

  get_user_maker_taker: obj("Maker vs taker breakdown", {
    address: F.address,
    from: F.from,
    to: F.to,
    data: arr("Per market", obj("One market", { market: F.market })),
    total: obj("All markets", {
      maker_fills: d("Fills as maker"),
      taker_fills: d("Fills as taker"),
      maker_notional: d("Maker notional in USD"),
      taker_notional: d("Taker notional in USD"),
      maker_fee: d("Maker fees in USD; negative means rebates"),
      taker_fee: d("Taker fees in USD"),
      total_fills: d("All fills"),
      pct_maker: d("Share of fills as maker, 0 to 1"),
    }),
  }),

  get_user_ledger: obj("Vault and transfer ledger", {
    address: F.address,
    from: F.from,
    to: F.to,
    data: arr(
      "Ledger entries",
      obj("One entry", { timestamp: F.timestamp, type: d("Event type"), amount: d("USD; positive into the account") })
    ),
  }),

  get_pnl_leaderboard: obj("Wallets ranked over the window", {
    from: F.from,
    to: F.to,
    sort_by: d("Ranking metric"),
    data: arr(
      "Wallets",
      obj("One wallet", {
        ...WALLET_STATS,
        win_rate: F.win_rate,
        markets_count: d("Markets traded"),
        max_drawdown_pct: F.max_drawdown_pct,
      })
    ),
  }),

  get_market_top_wallets: obj("Top wallets on one market", {
    market: F.market,
    from: F.from,
    to: F.to,
    sort_by: d("Ranking metric"),
    data: arr(
      "Wallets",
      obj("One wallet", {
        ...WALLET_STATS,
        first_seen_ms: d("First fill in the window, Unix milliseconds"),
        last_seen_ms: d("Last fill in the window, Unix milliseconds"),
      })
    ),
  }),

  get_markets_snapshot: obj("Markets ranked by the requested key", {
    sort_by: d("Ranking key used"),
    order: d("desc or asc"),
    total_markets: d("Active markets before filtering"),
    matched: d("Markets past the volume floor"),
    returned: d("Rows in data"),
    data: arr(
      "Ranked markets",
      obj("One market", {
        market_id: d("Stable market id"),
        display_symbol: F.display_symbol,
        market_class: F.market_class,
        issuer: F.issuer,
        mark_price: d("Current mark price"),
        mark_24h_ago: d("Mark price 24h ago"),
        change_24h_pct: d("24h change as a fraction, e.g. -0.031 for -3.1%"),
        open_interest_base: d("Open interest in base units"),
        open_interest_usd: d("Open interest in USD"),
        funding_rate: d("Current hourly funding rate"),
        mark_ts_ms: d("Mark sample time, Unix milliseconds"),
        volume_24h_usd: d("24h volume in USD"),
      })
    ),
  }),

  get_user_summary: obj("One wallet over a window", {
    address: F.address,
    from: F.from,
    to: F.to,
    state: USER_STATE,
    window: obj("Window totals", {
      fill_count: d("Fills"),
      volume_usd: d("Traded notional in USD"),
      realized_pnl: F.realized_pnl,
      wins: d("Profitable closing fills"),
      losses: d("Losing closing fills"),
      win_rate: F.win_rate,
      fees: d("Fees in USD"),
      maker_notional: d("Maker notional in USD"),
      taker_notional: d("Taker notional in USD"),
      maker_fills: d("Fills as maker"),
      taker_fills: d("Fills as taker"),
      pct_maker: d("Share of fills as maker, 0 to 1"),
    }),
  }),

  get_wallet_labels: {
    ...obj("Labels for notable wallets", {
      generated_at: d("Unix milliseconds"),
      ttl_seconds: d("Cache lifetime"),
      source: F.source,
      labels: {
        type: "object",
        description: "Address to its labels",
        additionalProperties: arr(
          "Labels",
          obj("One label", { kind: d("whale, smart_money, vault or vault_leader"), name: d("Display label"), rank: d("Rank") })
        ),
      },
      counts: d("Wallets per label kind"),
      note: d("What the labels map includes"),
    }),
  },

  get_user_pnl_series: obj("Realized PnL per bucket", {
    address: F.address,
    from: F.from,
    to: F.to,
    bucket: d("Bucket size"),
    data: arr(
      "Buckets",
      obj("One bucket", { ts: d("Bucket start, Unix milliseconds"), realized_pnl: F.realized_pnl, fees_usd: d("Fees in USD") })
    ),
  }),

  get_top_traders: obj("Traders ranked across all markets", {
    window: F.window,
    sort: d("Ranking used"),
    traders: arr(
      "Traders",
      obj("One trader", {
        ...TRADER,
        max_drawdown_pct: F.max_drawdown_pct,
        first_trade_ms: d("First trade, Unix milliseconds"),
        taker_share: d("Share of volume as taker, 0 to 1"),
        liquidations: d("Liquidations in the window"),
        top_pairs: d("Best markets with their win rates"),
      })
    ),
    aggregate: obj("Totals", {
      trader_count: d("Traders ranked"),
      total_pnl_usd: d("Sum of realized PnL in USD"),
      active_today: d("Traders active today"),
    }),
  }),

  get_market_leaders: obj("Best traders on one market", {
    market: F.market,
    window: F.window,
    traders: arr("Traders", obj("One trader", TRADER)),
  }),

  get_early_movers: obj("Wallets whose large orders preceded moves", {
    market: F.market,
    window: F.window,
    formula: d("How the lead score is computed"),
    signals: arr(
      "Wallets",
      obj("One wallet", {
        address: F.address,
        events: d("Scored large orders"),
        notional_usd: d("Notional of scored orders in USD"),
        lead_score_bps: d("Notional-weighted 30-minute forward return, basis points"),
        hit_rate: d("Share of orders followed by a move in their direction"),
        last_event_ms: d("Last scored order, Unix milliseconds"),
        cancel_ratio_30d: d("Share of large orders cancelled without a fill"),
      })
    ),
  }),

  get_trader_profile: obj("One wallet's trading record", {
    address: F.address,
    window: F.window,
    overall: obj("Headline stats", {
      win_rate: F.win_rate,
      profit_factor: F.profit_factor,
      trades: F.trades,
      max_drawdown_pct: F.max_drawdown_pct,
      realized_pnl_usd: F.realized_pnl_usd,
      first_trade_ms: d("First trade, Unix milliseconds"),
    }),
    markets: arr(
      "Best markets, ranked",
      obj("One market", {
        market: F.market,
        win_rate: F.win_rate,
        profit_factor: F.profit_factor,
        trades: F.trades,
        avg_notional_usd: F.avg_notional_usd,
        realized_pnl_usd: F.realized_pnl_usd,
        rank: d("Rank among the wallet's markets"),
        last_trade_ms: F.last_trade_ms,
      })
    ),
    liquidation_count: d("Liquidations in the window"),
    trades: d("Recent round-trip trades"),
  }),

  list_cohorts: obj("Wallet cohorts", {
    data: arr("Cohorts", obj("One cohort", { name: d("Cohort name"), description: d("What the cohort contains") })),
  }),

  get_cohort_addresses: obj("Wallets in a cohort", {
    addresses: arr("Wallets", obj("One wallet", { address: F.address, value: d("The metric the cohort ranks by") })),
    fetched_at: d("Unix milliseconds"),
  }),

  get_status: obj("Service status", {
    status: d("operational, degraded or down"),
    timestamp: F.timestamp,
    uptime: d("Time since the last incident"),
    platform: d("Event and market counts"),
    venues: d("Freshness per venue"),
    components: d("data_pipeline, rest_api and streaming health"),
  }),

  get_status_metrics: obj("Rolling performance metrics", {
    api: d("Latency and error rate"),
    pipeline: d("Ingestion latency and throughput"),
    synthetic: d("Synthetic probe latencies"),
    timestamp: F.timestamp,
  }),

  get_status_history: obj("Hourly status timeline", {
    points: arr(
      "Hourly buckets",
      obj("One hour", { ts: d("Hour start, Unix milliseconds"), status: d("Worst status in the hour"), fresh_sec: d("Data age in seconds") })
    ),
    uptime_percent: d("Share of operational hours"),
    period: d("24h or 7d"),
  }),

  list_markets: obj("One page of markets", {
    matched: d("Markets matching the filters and search, across all pages"),
    returned: d("Rows in data"),
    pagination: obj("Cursor pagination", {
      next_cursor: d("Pass as cursor, with the same filters, for the next page; null on the last page"),
      has_more: d("Whether more pages exist"),
      total: d("Markets matching the filters and search"),
    }),
    data: arr(
      "Markets",
      obj("One market", {
        market_id: d("Stable market id"),
        source: F.source,
        market_class: F.market_class,
        issuer: F.issuer,
        base_asset: d("Base asset"),
        quote_asset: F.quote_asset,
        base_market: F.base_market,
        display_symbol: F.display_symbol,
        hl_coin: d("Hyperliquid coin string"),
        active_from_ms: d("Listing time, Unix milliseconds"),
        active_to_ms: d("Close time, Unix milliseconds; only on closed markets (include_inactive)"),
        max_leverage: d("Maximum leverage"),
      })
    ),
  }),
};

// NOTICE is the line the server puts first in a result when the API said
// something beside the data: how a Hyperliquid name was read, that the data
// starts later than asked (the tier's history window), or a next step.
const NOTICE = d(
  "Present when the API added a note: how a market name was read, that data starts later than asked because of the history window, or a next step such as a free key"
);


export const outputSchemas: Record<string, Schema> = Object.fromEntries(
  Object.entries(toolSchemas).map(([name, schema]) => [
    name,
    { ...schema, properties: { notice: NOTICE, ...(schema.properties as Record<string, Schema>) } },
  ])
);
