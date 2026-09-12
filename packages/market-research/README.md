# @nemesis-oss/market-research

Empirical market event research, trajectory evaluation, counterfactual controls, and statistical inference engine.

---

## Core Components

| Module | Source | Description |
| :--- | :--- | :--- |
| **Outcomes & Trajectories** | [`generic-outcomes.ts`](src/generic-outcomes.ts) | Pure trajectory evaluation: MFE/MAE in ATR, `reached1R/2R/3R`, `timeTo1R/2R/3R`, collision resolution, and authoritative `OutcomeLabel`. |
| **Matched Controls** | [`matched-controls.ts`](src/matched-controls.ts) | Synthetic counterfactual baselines matched on trend regime, volatility, and session. |
| **Episode Clustering** | [`episode-clustering.ts`](src/episode-clustering.ts) | Resolves autocorrelation by clustering temporally adjacent events into independent episodes. |
| **Statistical Significance** | [`statistical-significance.ts`](src/statistical-significance.ts) | Wilson score intervals, Bootstrap median CIs, Cluster-level bootstrap, and Paired bootstrap comparison. |
| **Multiple Testing** | [`multiple-testing.ts`](src/multiple-testing.ts) | Benjamini-Hochberg (FDR) and Holm-Bonferroni (FWER) adjustments, plus hypothesis family management. |
| **Condition Engine** | [`condition-engine.ts`](src/condition-engine.ts) | Type-safe predictive filter expressions preventing ex-post outcome leakage. |
| **Equivalence Testing** | [`equivalence-research.ts`](src/equivalence-research.ts) | Two One-Sided Tests (TOST) to verify whether two event definitions capture equivalent market behavior. |
| **Walk-Forward Validation** | [`walk-forward.ts`](src/walk-forward.ts) | Out-of-sample validation with rolling purged train/test windows and continuous warmup history. |
| **Study Runner** | [`study-runner.ts`](src/study-runner.ts) | Orchestrates end-to-end component evaluations across 7 core event types with full SHA-256 provenance. |

---

## Usage Example

```typescript
import { runObservationStudy, toResearchResult } from '@nemesis-oss/market-research';

const study = runObservationStudy(candles, {
  symbol: 'ETHUSDT',
  timeframe: '15m',
  horizonCandles: 24,
  ambiguityPolicy: 'pessimistic'
});

// Access component study results
for (const result of study.results) {
  console.log({
    eventType: result.eventType,
    reachRate2R: result.reachRates.r2,
    upliftOverControls: result.baselineComparisonR2?.uplift,
    isFdrSignificant: result.baselineComparisonR2?.isFdrSignificant
  });
}
```

---

## Research CLI

Run multi-timeframe research directly from the command line (fetches Binance spot klines per timeframe):

```bash
pnpm run cli -- --symbol ETHUSDT --timeframes 15m,1h,4h --horizon 24 --lookback 1000
```
