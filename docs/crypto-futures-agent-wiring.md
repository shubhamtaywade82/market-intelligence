# Crypto futures + agentic AI wiring

This guide connects **USDⓈ-M perp candles**, **deterministic evidence**, and **Ollama research** to **read-only trading signals** in `crypto-agent`.

## A. Futures-aligned historical data

### Problem

Live klines use **Binance futures WebSocket**, but historical research defaulted to **spot REST** — backtests did not match live perp charts.

### Fix in this repo

| API | Purpose |
|-----|---------|
| `createBinanceFuturesAdapter()` | USDⓈ-M REST `/fapi/v1/klines` + futures WS + funding/OI/mark |
| `createBinanceAdapter()` | Spot klines (legacy default on REST adapter) |
| `RESEARCH_KLINE_MARKET=usdm_futures` | Env default for research CLIs |
| `--market futures` / `--market spot` | CLI override |

### Commands (perp default)

```bash
# Cached perp dataset: .datasets/BTCUSDT-15m-usdm.json
pnpm run live-study -- --symbol BTCUSDT --timeframe 15m --days 14 --market futures

# Effectiveness matrix on futures klines
pnpm run cli -- --symbol BTCUSDT --timeframes 15m,1h --market futures

# Agent research on cached perp file
pnpm run research -- \
  --dataset packages/market-research/.datasets/BTCUSDT-15m-usdm.json \
  --question "Summarize FVG +2R edge vs controls and walk-forward stability."
```

Programmatic:

```ts
import { createBinanceFuturesAdapter } from '@nemesis-oss/market-data';
import { createResearchBinanceAdapter, DEFAULT_RESEARCH_KLINE_MARKET } from '@nemesis-oss/market-research';

const adapter = createResearchBinanceAdapter(DEFAULT_RESEARCH_KLINE_MARKET); // usdm_futures
```

## B. crypto-agent signal bridge (read-only)

### Layers

```text
market-research  →  ResearchResult / FvgEvidenceTradingSignal  →  crypto-agent kernel
research-agent   →  ResearchOutcome (status + report excerpt)     ↗ (narrative only)
```

**Gating uses `ResearchResult` + optional walk-forward flag — never LLM prose.**

### Types (`@nemesis-oss/market-research`)

- `FvgEvidenceTradingSignal` — `readOnly: true`, `mayConsiderSetup`, reach/uplift/p/FDR, `walkForwardStable`, optional `agentRunStatus`
- `buildFvgEvidenceSignal(fvgResearchResult, options)`

### crypto-agent module

`src/engines/mi-agent-signal.ts`:

```ts
import { buildMiFvgTradingSignal } from './engines/mi-agent-signal.js';
import { getMiEvidenceCache } from './engines/mi-evidence-cache.js';

const snap = await getMiEvidenceCache().getOrRefresh(deps, 'BTCUSDT', '15m');
const signal = buildMiFvgTradingSignal({
  evidence: snap!,
  klineMarket: 'usdm_futures',
  agentOutcome: researchRun, // optional ResearchOutcome from research-agent
  walkForwardStable: true,
});

if (signal?.mayConsiderSetup) {
  // feed setup engine / council — still no orders from the LLM
}
```

Existing **`mi-evidence-gate.ts`** continues to gate by setup type; **`buildMiFvgTradingSignal`** adds an explicit FVG struct for logging, API responses, and council prompts.

### Sync vendor packages

After changing `market-intelligence`, refresh **source + build output** in crypto-agent vendors (keep vendored `package.json` with `file:` deps — do not overwrite from the monorepo):

```bash
MI=../quant-libraries/market-intelligence/packages
CA=../crypto-trading/crypto-agent/vendor

for pkg in market-data market-research; do
  rsync -a --delete --exclude node_modules --exclude package.json \
    "$MI/$pkg/src/" "$CA/$pkg/src/"
  rsync -a --delete "$MI/$pkg/dist/" "$CA/$pkg/dist/"
done
rsync -a --delete --exclude node_modules --exclude package.json \
  "$MI/research-agent/src/" "$CA/research-agent/src/"
rsync -a --delete "$MI/research-agent/dist/" "$CA/research-agent/dist/"
```

Ensure `vendor/market-research/package.json` lists `"@nemesis-oss/market-data": "file:../market-data"`.

Then in crypto-agent: `pnpm install && pnpm test`.

## End-to-end futures + agent workflow

1. **Research (offline):** `live-study --market futures` → confirm FVG uplift + walk-forward.
2. **Cache evidence:** `MiEvidenceCache` runs `runEvidenceStudy` on kernel klines (futures REST from your provider).
3. **Agent (optional):** `pnpm run research -- --dataset ...-usdm.json` → sealed report for humans/council.
4. **Gate:** `buildMiFvgTradingSignal` + `verdictForSetup` → allow/deny setup candidates.
5. **Execute:** your existing crypto-agent order path (never driven by `result.report` numbers alone).

## Environment

| Variable | Meaning |
|----------|---------|
| `RESEARCH_KLINE_MARKET` | `usdm_futures` (default) or `spot` |
| `MI_EVIDENCE_ENABLED` | `false` to disable evidence cache |
| `MI_EVIDENCE_GATE_STRICT` | `true` → require `robust` evidence only |
| `OLLAMA_BASE_URL` / `RESEARCH_AGENT_MODEL` | Agent CLI |
