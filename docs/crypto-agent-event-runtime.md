# Event-driven crypto agent runtime

How **crypto-agent** should behave with Binance WS, market-intelligence, deterministic gates, agentic LLM, and Telegram.

## Mental model

The kernel is a **24/7 event-driven runtime**, not a 5-minute cron that “asks the LLM what to do.”

```text
Binance WS (klines 5m/15m/1h/4h, mark, book) + REST recovery
  → MarketStateStore (persistent per symbol)
  → detectors on candle close / state change
  → EventStore audit + SymbolLanes (per-symbol queue)
  → setup engine + MI evidence gate
  → LLM only when confidence / policy says so
  → Telegram (alert vs trading bots)
  → optional execution FSM (paper / live)
```

The **5-minute scan** remains useful as **reconciliation / watchdog**, not the primary intelligence trigger.

## What is already wired in crypto-agent

| Layer | Module |
|-------|--------|
| WS → state | `kernel-streams.ts`, `BinanceMarketStream` |
| Persistent MTF state | `MarketStateStore`, `market-state-engine` |
| Event council | `event-council.ts` (candle close on 1h/4h by default) |
| MI events | `mi-event-scan.ts` (CHoCH + liquidity sweep on bar close) |
| Setups | `setup-engine.ts` |
| Evidence | `mi-evidence-cache`, `mi-evidence-gate`, `mi-agent-signal` |
| LLM council | `analyzeMarket` + pipeline trace |
| Telegram | `signal-telegram.ts`, `council-telegram.ts`, `telegram.ts` |

## Notification flow (after this wiring)

1. **Alert bot** (`TELEGRAM_ALERTBOT_BOT_TOKEN`): deterministic cards  
   - `mi.event.detected` → immediate “Market event” message  
   - regime change, new setup count  
   - council cards for WAIT / analysis (non-trade)

2. **Trading bot** (`TELEGRAM_TRADING_BOT_TOKEN`): actionable signals  
   - price-watch breakout cards  
   - council when status is `APPROVED`, `EXECUTED`, `EXIT_SIGNALLED`

Shared: `TELEGRAM_CHAT_ID`.

## LLM gate (market events)

On `MARKET_EVENT`, Ollama **Analyst** runs only if a setup in the pipeline trace has  
`confidence >= COUNCIL_LLM_MIN_CONFIDENCE` (default **0.75**).  
Set `COUNCIL_LLM_ENABLED=false` to disable LLM entirely.

Deterministic pipeline + EventStore still run; you still get alert-bot messages for raw events.

## Env checklist

```bash
MARKET_STREAM_ENABLED=true
EVENT_COUNCIL_ENABLED=true
MI_EVENT_COUNCIL=true
COUNCIL_CANDLE_TFS=1h,4h,15m   # add 15m for faster event cadence
TELEGRAM_CHAT_ID=...
TELEGRAM_ALERTBOT_BOT_TOKEN=...
TELEGRAM_TRADING_BOT_TOKEN=...
TELEGRAM_EVENT_ALERTS=true
```

Boot: kernel CLI or TUI calls `startStreams()` then `bootEventCouncil()`.

## Gaps to close next (platform)

- Expand `mi-event-scan` to BOS, FVG, OB (same pattern as CHoCH/sweep).  
- Location tracker events (`price.approached_liquidity`, zone enter/leave) from live state.  
- Wire `buildMiFvgTradingSignal` into council gating beside `verdictForSetup`.  
- Align MI evidence klines with **USDⓈ-M futures** REST (see market-intelligence wiring doc).

See also: `market-intelligence/docs/crypto-futures-agent-wiring.md`.
