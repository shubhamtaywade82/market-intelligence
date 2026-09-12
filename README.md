# market-intelligence

A high-assurance quantitative research engine for deterministic market event detection, trajectory evaluation, counterfactual matched controls, and statistical evidence generation — exposed through an agentic research interface for autonomous AI agents.

Built as the empirical evidence layer for systematic trading systems and autonomous AI agents like [`crypto-agent`](https://github.com/shubhamtaywade82/crypto-agent).

> **Roadmap:** See [ROADMAP.md](ROADMAP.md) for the evolution from research library to full market intelligence platform (live data, regime engine, hypothesis engine, strategy discovery).

---

## Architecture & Monorepo Structure

```text
              @nemesis-oss/agentic-runtime
                            │
                            ▼
                     research-agent
                      /          \
                     ▼            ▼
           market-events    market-research
                                    │
                                    ▼
                        crypto-agent / Execution Systems
                  (Evidence Consumers)
```

| Package | Purpose | Primary Responsibilities |
| :--- | :--- | :--- |
| [`@nemesis-oss/market-data`](packages/market-data) | Exchange data adapters | Binance + Bybit REST (historical klines, funding, OI, mark price) and Binance WebSocket (live klines with reconnect/recovery). Normalizes to canonical Decimal-typed `Candle`. |
| [`@nemesis-oss/market-stream`](packages/market-stream) | Live market intelligence | Continuously maintained `MarketState` from exchange WebSocket feeds: price, trend regime, volatility, ATR, session, active events. Multi-symbol/multi-timeframe orchestration with rolling candle buffers. |
| [`@nemesis-oss/market-events`](packages/market-events) | Deterministic event detection | Zero-lookahead detection of FVGs, Structure Breaks (BOS/CHoCH/MSS), Order Blocks, Sweeps, VSA, Derivatives, and Wyckoff with strict lifecycle timelines. |
| [`@nemesis-oss/market-research`](packages/market-research) | Empirical validation kernel | Trajectory excursion metrics (MFE/MAE/R), matched counterfactual controls, cluster bootstrap, FDR correction, walk-forward validation, negative-evidence impact. |
| [`@nemesis-oss/market-research-agent`](packages/research-agent) | Agentic research interface | LLM-driven research planning, tool selection, and interpretation on top of the deterministic engines. Uses `@nemesis-oss/agentic-runtime` for the ReAct loop, tool dispatch, budgets, and terminal synthesis seal. Owns no domain logic. |

### Dependency direction

The dependency direction is one-way and strict:

- `market-data` depends only on `market-events` (for the canonical `Candle` type).
- `market-events` depends on nothing inside the monorepo.
- `market-research` depends on `market-events`.
- `research-agent` depends on `market-events` + `market-research` + `@nemesis-oss/agentic-runtime` + `market-data` (optional peer).
- `crypto-agent` depends on `research-agent` and may add higher-level strategy code on top.

No package imports upward. The LLM never becomes part of either deterministic package.

---

## Core Principles & Guarantees

### 1. Strict Causal Timeline (Zero Lookahead)

Every detected event enforces monotonic ordering across all lifecycle stages:

$$\text{originIndex} \le \text{formedAtIndex} \le \text{confirmedAtIndex} \le \text{availableAtIndex}$$

Evaluations never reference bars before `availableAtIndex` or future data. Verified at runtime by [`validateEventCausality()`](packages/market-events/src/types.ts).

### 2. Separation of Market Behavior and Trade Execution

- **[`BaseOutcome`](packages/market-research/src/types.ts)**: Measures pure price excursion (`mfeAtr`, `maeAtr`, `reached1R`, `reached2R`, `reached3R`, `timeTo1R`, collision resolution).
- **[`TradeOutcome`](packages/market-research/src/types.ts)**: Separate execution simulation layer handling entry/exit fills, fees, slippage, and `realizedR`.

### 3. Matched Counterfactual Controls

Detecting that a pattern reached +2R 60% of the time in a bull market is meaningless if a random candle also reached +2R 60% of the time. Every event is evaluated against synthetic controls matched on trend regime, volatility, and session ([`generateMatchedControls()`](packages/market-research/src/matched-controls.ts)).

### 4. Clustered & Paired Resampling

Consecutive structure breaks or FVGs are autocorrelated. The engine clusters events into independent episodes ([`clusterEventsIntoEpisodes()`](packages/market-research/src/episode-clustering.ts)) and uses paired/cluster bootstrapping for valid confidence intervals.

### 5. Multiple-Testing Correction

Controls False Discovery Rate (FDR) using Benjamini-Hochberg and Family-Wise Error Rate (FWER) using Holm-Bonferroni across multi-hypothesis scans ([`adjustBenjaminiHochberg()`](packages/market-research/src/multiple-testing.ts)).

### 6. LLM Never Owns Numerical Claims

The agentic layer exposes deterministic tools to the model — every statistic in a final research report must originate from a tool call. The runtime's No-Tools Guarantee contract enforces this at seal time. See [`packages/research-agent/README.md`](packages/research-agent/README.md) for the tool surface.

---

## Quickstart

### Installation & Build

```bash
# Requires Node.js >= 20 and pnpm 9.x (pinned via packageManager field).
pnpm install
pnpm run build      # builds all 3 workspace packages in topological order
pnpm run test       # 97 tests across the monorepo
pnpm run typecheck  # type-checks every package (requires build first)
```

### Detecting Events (`market-events`)

```typescript
import { detectSwings, detectBos, detectFvg } from '@nemesis-oss/market-events';

// Detect swing points with strict causal confirmation
const swings = detectSwings(candles, { leftBars: 2, rightBars: 2 });

// Detect Break of Structure (continuation)
const bosEvents = detectBos(candles, swings, { symbol: 'ETHUSDT', timeframe: '15m' });

// Detect Fair Value Gaps
const fvgEvents = detectFvg(candles, { symbol: 'ETHUSDT', timeframe: '15m' });
```

### Running an Empirical Study (`market-research`)

```typescript
import { runObservationStudy } from '@nemesis-oss/market-research';

const study = runObservationStudy(candles, {
  symbol: 'ETHUSDT',
  timeframe: '15m',
  horizonCandles: 24,
  ambiguityPolicy: 'pessimistic'
});

// Component results with matched controls and FDR p-values
for (const res of study.results) {
  console.log(`${res.eventType}: reachRate2R=${res.reachRates.r2}, pValue=${res.baselineComparisonR2?.pValueEstimate}`);
}
```

### Agentic Research (`research-agent`)

```typescript
import { createResearchAgent } from '@nemesis-oss/market-research-agent';

const agent = createResearchAgent({
  symbol: 'SOLUSDT',
  timeframe: '15m',
  candles,
  // optional higher-timeframe datasets for HTF-conflict analysis
  htfCandles: { '1h': htfCandles1h, '4h': htfCandles4h },
});

const result = await agent.research(`
  Investigate whether bullish FVGs on SOLUSDT 15m have statistically
  meaningful 2R follow-through. Compare against matched controls and
  report whether the result survives multiple-testing correction.
`);

console.log(result.report);     // sealed string
console.log(result.status);     // 'ACHIEVED' | 'PARTIAL' | 'CEDED' | 'FAILED'
```

### From Exchange Data (`market-data` + `research-agent`)

Fetch candles directly from Binance and construct an agent in one call:

```typescript
import { createBinanceAdapter } from '@nemesis-oss/market-data';
import { createResearchAgentFromExchange } from '@nemesis-oss/market-research-agent';

const agent = await createResearchAgentFromExchange({
  adapter: createBinanceAdapter(),
  symbol: 'ETHUSDT',
  timeframe: '15m',
  startTime: Date.now() - 30 * 24 * 60 * 60 * 1000,  // 30 days
  endTime: Date.now(),
  htfTimeframes: ['1h', '4h'],
});

const result = await agent.research(
  'Does bullish FVG continuation on ETHUSDT 15m provide statistically significant 2R edge?',
);
console.log(result.report);
```

### Live Market Intelligence (`market-stream`)

Subscribe to live exchange WebSocket feeds and maintain a continuously-updated `MarketState`:

```typescript
import { createBinanceAdapter } from '@nemesis-oss/market-data';
import { createMarketStream } from '@nemesis-oss/market-stream';

const stream = createMarketStream(
  {
    adapter: createBinanceAdapter(),
    streams: [
      { symbol: 'ETHUSDT', timeframe: '15m' },
      { symbol: 'ETHUSDT', timeframe: '15m' },
    ],
    detectors: ['fvg', 'bos', 'liquidity_sweep'],
    eventLookbackBars: 10,
  },
  {
    onState: (state) => {
      console.log(`${state.symbol} ${state.timeframe}: price=${state.price}, trend=${state.trendRegime}, volatility=${state.volatilityRegime}, events=${state.activeEvents.length}`);
    },
    onEvent: (event, key) => {
      console.log(`[${key.symbol}] NEW ${event.type} ${event.direction} at ${event.originTimestamp}`);
    },
  },
);

await stream.start();
// Later: await stream.stop();
```

Answers "What is happening to SOLUSDT *right now*?" — the live counterpart to the historical research layer.

For non-LLM direct invocation (backtest harness, CLI, unit test), call tools without spinning up Ollama:

```typescript
const summary = await agent.invokeTool('dataset_summary', {});
const fvgStudy = await agent.invokeTool('run_event_study', {
  eventType: 'fvg',
  horizonCandles: 24,
});
```

### Walk-Forward Validation

```typescript
import { runWalkForwardValidation, formatStabilityMarkdown } from '@nemesis-oss/market-research';

const { windows, stability } = runWalkForwardValidation(candles, {
  symbol: 'ETHUSDT',
  timeframe: '15m',
  trainCandlesCount: 1000,
  testCandlesCount: 250,
  stepCandlesCount: 250,
  horizonCandles: 24,
  warmupBars: 50
});

console.log(formatStabilityMarkdown(stability));
```

### Research CLI Runner

Generate a multi-timeframe effectiveness report for any asset (Binance spot klines):

```bash
cd packages/market-research
pnpm run cli -- --symbol ETHUSDT --timeframes 15m,1h,4h --horizon 24 --lookback 1000
```

---

## CI/CD

GitHub Actions workflows live in [`.github/workflows/`](.github/workflows/):

| Workflow | Trigger | Purpose |
| :--- | :--- | :--- |
| [`ci.yml`](.github/workflows/ci.yml) | push to `main`, PRs to `main` | Node 20 + 22 matrix: `install → build → test`. Uploads `dist/` artifacts. Build runs before test because workspace packages resolve each other via `types` in `package.json`. |
| [`codeql.yml`](.github/workflows/codeql.yml) | push to `main`, PRs to `main`, weekly cron | JS/TS security analysis (prototype pollution, regex DoS, SSRF, command injection). Relevant because downstream `crypto-agent` ingests untrusted exchange data. |

[Dependabot](.github/dependabot.yml) opens weekly grouped PRs for npm and GitHub Actions. Major-version bumps to `@types/node`, `zod`, `typescript`, `@nemesis-oss/agentic-runtime`, and `@nemesis-oss/ollama-sdk` are pinned and require manual review — these track runtime/peer-dep constraints that auto-bumping would violate.

No release workflow yet. It will be added when `@nemesis-oss/market-research-agent` is published to npm.

---

## Documentation

- [Architecture & Methodology Guide](docs/architecture.md)
- [Roadmap: market intelligence platform](ROADMAP.md)
- [`market-data` README](packages/market-data/README.md) — exchange adapters
- [`market-stream` README](packages/market-stream/README.md) — live market intelligence
- [`market-events` README](packages/market-events/README.md)
- [`market-research` README](packages/market-research/README.md)
- [`research-agent` README](packages/research-agent/README.md) — including integration with `crypto-agent`
