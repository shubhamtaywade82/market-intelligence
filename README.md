# market-intelligence

A high-assurance quantitative research engine for deterministic market event detection, trajectory evaluation, counterfactual matched controls, and statistical evidence generation.

Built as the empirical evidence layer for systematic trading systems and autonomous AI agents ([`crypto-agent`](file:///home/nemesis/projects/crypto-trading/crypto-agent)).

---

## Architecture & Monorepo Structure

```text
market-events (Deterministic Primitives)
      │
      ▼
market-research (Statistical Inference & Validation)
      │
      ▼
crypto-agent / Execution Systems (Evidence Consumers)
```

| Package | Purpose | Primary Responsibilities |
| :--- | :--- | :--- |
| [`@nemesis-oss/market-events`](file:///home/nemesis/projects/quant-libraries/market-intelligence/packages/market-events) | Deterministic event detection | Zero-lookahead detection of FVGs, Structure Breaks (BOS/CHoCH/MSS), Order Blocks, Sweeps, VSA, Derivatives, and Wyckoff with strict lifecycle timelines. |
| [`@nemesis-oss/market-research`](file:///home/nemesis/projects/quant-libraries/market-intelligence/packages/market-research) | Empirical validation kernel | Trajectory excursion metrics (MFE/MAE/R), matched counterfactual controls, cluster bootstrap, FDR correction, and stateful walk-forward validation. |

---

## Core Principles & Guarantees

### 1. Strict Causal Timeline (Zero Lookahead)

Every detected event enforces monotonic ordering across all lifecycle stages:

$$\text{originIndex} \le \text{formedAtIndex} \le \text{confirmedAtIndex} \le \text{availableAtIndex}$$

Evaluations never reference bars before `availableAtIndex` or future data. Verified at runtime by [`validateEventCausality()`](file:///home/nemesis/projects/quant-libraries/market-intelligence/packages/market-events/src/types.ts).

### 2. Separation of Market Behavior and Trade Execution

* **[`BaseOutcome`](file:///home/nemesis/projects/quant-libraries/market-intelligence/packages/market-research/src/types.ts)**: Measures pure price excursion (`mfeAtr`, `maeAtr`, `reached1R`, `reached2R`, `reached3R`, `timeTo1R`, collision resolution).
* **[`TradeOutcome`](file:///home/nemesis/projects/quant-libraries/market-intelligence/packages/market-research/src/types.ts)**: Separate execution simulation layer handling entry/exit fills, fees, slippage, and `realizedR`.

### 3. Matched Counterfactual Controls

Detecting that a pattern reached +2R 60% of the time in a bull market is meaningless if a random candle also reached +2R 60% of the time. Every event is evaluated against synthetic controls matched on trend regime, volatility, and session ([`generateMatchedControls()`](file:///home/nemesis/projects/quant-libraries/market-intelligence/packages/market-research/src/matched-controls.ts)).

### 4. Clustered & Paired Resampling

Consecutive structure breaks or FVGs are autocorrelated. The engine clusters events into independent episodes ([`clusterEventsIntoEpisodes()`](file:///home/nemesis/projects/quant-libraries/market-intelligence/packages/market-research/src/episode-clustering.ts)) and uses paired/cluster bootstrapping for valid confidence intervals.

### 5. Multiple-Testing Correction

Controls False Discovery Rate (FDR) using Benjamini-Hochberg and Family-Wise Error Rate (FWER) using Holm-Bonferroni across multi-hypothesis scans ([`adjustBenjaminiHochberg()`](file:///home/nemesis/projects/quant-libraries/market-intelligence/packages/market-research/src/multiple-testing.ts)).

---

## Quickstart

### Installation & Build

```bash
# Install dependencies
pnpm install

# Build TypeScript
pnpm run build

# Run full test suite (83 tests)
pnpm run test

# Typecheck workspace
pnpm run typecheck
```

### Detecting Events (`market-events`)

```typescript
import { detectSwings, detectBos, detectFvg } from '@nemesis-oss/market-events';

// Detect swing points with strict causal confirmation
const swings = detectSwings(candles, { leftBars: 2, rightBars: 2 });

// Detect Break of Structure (continuation)
const bosEvents = detectBos(candles, swings, { symbol: 'BTCUSDT', timeframe: '15m' });

// Detect Fair Value Gaps
const fvgEvents = detectFvg(candles, { symbol: 'BTCUSDT', timeframe: '15m' });
```

### Running an Empirical Study (`market-research`)

```typescript
import { runObservationStudy, toResearchResult } from '@nemesis-oss/market-research';

const study = runObservationStudy(candles, {
  symbol: 'BTCUSDT',
  timeframe: '15m',
  horizonCandles: 24,
  ambiguityPolicy: 'pessimistic'
});

// Component results with matched controls and FDR p-values
for (const res of study.results) {
  console.log(`${res.eventType}: reachRate2R=${res.reachRates.r2}, pValue=${res.baselineComparisonR2?.pValueEstimate}`);
}
```

### Walk-Forward Validation

```typescript
import { runWalkForwardValidation, formatStabilityMarkdown } from '@nemesis-oss/market-research';

const { windows, stability } = runWalkForwardValidation(candles, {
  symbol: 'BTCUSDT',
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

Generate a multi-timeframe effectiveness report for any asset:

```bash
cd packages/market-research
pnpm run cli --symbol BTCUSDT --timeframes 15m,1h,4h --horizon 24
```

---

## Documentation

* [Architecture & Methodology Guide](file:///home/nemesis/projects/quant-libraries/market-intelligence/docs/architecture.md)
* [Code Quality Standards](file:///home/nemesis/.ai/CODE_QUALITY.md)
