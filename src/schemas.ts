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
export const outputSchemas: Record<string, Schema> = {
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

  get_liquidation_summary: obj("Liquidation totals over the window", {
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
    complete: d("False when the page cap was hit and totals are a lower bound"),
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
  }),

  get_vault_leaderboard: obj("Vaults ranked by net deposits", {
    data: arr("Vaults", obj("One vault", { vault: d("Vault address") })),
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

  list_markets: obj("Active markets", {
    total_markets: d("Active markets before search"),
    matched: d("Markets matching the search"),
    returned: d("Rows in data"),
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
        max_leverage: d("Maximum leverage"),
      })
    ),
  }),
};
