# Architecture & Methodology

`market-intelligence` is organized as an empirical evidence pipeline designed to mathematically validate market hypotheses without lookahead or data leakage.

---

## 1. End-to-End Pipeline Flow

```text
Historical / Streaming Candles (Candle[])
                   │
                   ▼
       Deterministic Detectors
      (@nemesis-oss/market-events)
                   │
                   ▼  (Enforces origin <= formed <= confirmed <= available)
          Causal BaseEvent[]
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
 Context Extraction     Generic / Specialized
 (Causal ATR, Regime,    Trajectory Evaluator
  Session, HTF Trend)   (MFE, MAE, reached1/2/3R,
        │                timeTo1/2/3R, OutcomeLabel)
        └──────────┬──────────┘
                   ▼
       ResearchObservation[]
      (Event + Context + Outcome + Provenance)
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
 Matched Controls        Episode Clustering
 (Synthetic baselines    (Groups autocorrelated
  in identical regime)    events into clusters)
        │                     │
        └──────────┬──────────┘
                   ▼
     Statistical Inference Kernel
 (Paired Bootstrap, Cluster Bootstrap,
  Wilson Score Intervals, TOST Equivalence)
                   │
                   ▼
      Multiple-Testing Correction
   (Benjamini-Hochberg FDR, Holm-Bonferroni,
       Hypothesis Family Registry)
                   │
                   ▼
   Out-of-Sample Walk-Forward Validation
   (Rolling windows with interval-based purging
          and historical warmup state)
                   │
                   ▼
             ResearchResult
     (Authoritative Empirical Evidence Packet)
```

---

## 2. Core Subsystems

### A. Causal Event Lifecycle (`market-events`)

Every event detector produces a typed [`BaseEvent`](file:///home/nemesis/projects/quant-libraries/market-intelligence/packages/market-events/src/types.ts) adhering to a strict temporal invariant:

$$\text{originIndex} \le \text{formedAtIndex} \le \text{confirmedAtIndex} \le \text{availableAtIndex}$$

* **`originIndex`**: The candle where the pattern physically began (e.g. bar 1 of a 3-bar FVG, or the swing point level being swept).
* **`formedAtIndex`**: The candle where the geometry became complete.
* **`confirmedAtIndex`**: The candle where rule confirmation occurred (e.g. right-side bars confirmed a swing).
* **`availableAtIndex`**: The earliest bar index where a live trader or algorithm could know the event existed.

Any evaluation referencing bars before `availableAtIndex` or future data throws an immediate causal invariant violation.

### B. Trajectory Evaluation vs. Trade Execution (`market-research`)

The research engine deliberately isolates **market behavior** from **execution assumptions**:

1. **Market Excursion (`BaseOutcome`)**:
   * Evaluates maximum favorable excursion (`mfeAtr`) and maximum adverse excursion (`maeAtr`).
   * Measures canonical reachability: `reached1R`, `reached2R`, `reached3R` and their elapsed bars: `timeTo1R`, `timeTo2R`, `timeTo3R`.
   * Resolves intrabar OHLC collisions deterministically using the configured `AmbiguityPolicy` (`pessimistic`, `optimistic`, or lower-timeframe resolution).
   * Generates an authoritative [`OutcomeLabel`](file:///home/nemesis/projects/quant-libraries/market-intelligence/packages/market-research/src/types.ts) (`startIndex`, `endIndex`, timestamps).

2. **Trade Execution Simulation (`TradeOutcome`)**:
   * Downstream simulator ([`simulateTradeExecution`](file:///home/nemesis/projects/quant-libraries/market-intelligence/packages/market-research/src/generic-outcomes.ts)) that accepts fee structures, slippage models, and risk parameters to compute `realizedR` and `realizedPnl`.

### C. Counterfactual Matched Controls

A naive study might conclude that bullish order blocks have a 65% reach rate at +2R. However, if the underlying asset was in a strong bull regime where random entries had a 65% reach rate, the order block pattern offers **zero predictive edge**.

[`generateMatchedControls()`](file:///home/nemesis/projects/quant-libraries/market-intelligence/packages/market-research/src/matched-controls.ts) pairs every event with pseudo-events in the same asset:

* Matched on identical trend regime (SMA slope / price location).
* Matched on volatility percentile (ATR).
* Matched on market session (London, New York, Asia).

Statistical uplift is calculated strictly relative to this matched counterfactual baseline.

### D. Autocorrelation & Cluster Bootstrap

Financial market events cluster in time (e.g. multiple structure breaks during a trend impulse). Treating them as independent, identically distributed ($i.i.d.$) samples artificially deflates standard errors and produces false $p$-values.

* [`clusterEventsIntoEpisodes()`](file:///home/nemesis/projects/quant-libraries/market-intelligence/packages/market-research/src/episode-clustering.ts) groups events within a proximity gap into single independent episodes.
* Resampling operates at the **episode or matched-pair level**, calculating cluster-adjusted effective sample sizes and non-parametric bootstrap confidence intervals.

### E. Multiple-Testing & Hypothesis Families

When scanning 7 event types across multiple horizons and regimes, standard significance thresholds ($\alpha = 0.05$) guarantee false discoveries.

* **Benjamini-Hochberg (FDR)**: Controls the expected proportion of false discoveries across component studies.
* **Hypothesis Families**: [`adjustByHypothesisFamily()`](file:///home/nemesis/projects/quant-libraries/market-intelligence/packages/market-research/src/multiple-testing.ts) groups tests into explicit families (e.g. structural continuation vs. liquidity reversal) before adjustment.

### F. Continuous Walk-Forward Validation

Validates whether an empirical edge persists out-of-sample across rolling market regimes:

1. **Hypothesis Discovery**: Identifies optimal filter rules on the training slice.
2. **Hypothesis Freezing**: Freezes rule definitions and hashes into a [`FrozenHypothesis`](file:///home/nemesis/projects/quant-libraries/market-intelligence/packages/market-research/src/walk-forward.ts).
3. **Interval-Based Purging**: Purges training observations whose outcome window intersects the test boundary.
4. **Warmup Continuity**: Seeds test windows with prior historical bars to prevent cold-restart detector artifacts while strictly evaluating out-of-sample test events.
5. **Stability Assessment**: Computes degradation between in-sample and out-of-sample reach rates.

---

## 3. Evidence Status Classification

Every evaluated component receives an objective [`EvidenceStatus`](file:///home/nemesis/projects/quant-libraries/market-intelligence/packages/market-research/src/types.ts):

| Status | Definition | Recommended Action |
| :--- | :--- | :--- |
| `robust` | Statistically significant ($p < 0.05$ after FDR adjustment) with positive baseline uplift. | Eligible for production strategy weighting. |
| `exploratory` | Nominally significant ($p < 0.05$ unadjusted) but does not pass FDR or has moderate sample size. | Candidate for condition refinement. |
| `descriptive_only` | Positive sample observations, but no statistically significant uplift over matched controls. | Do not use as standalone trade trigger. |
| `insufficient_sample` | Sample size ($N < 30$) too small for reliable inference. | Requires larger dataset. |
| `confounded` | Edge vanishes once matched controls or clustering are applied. | Reject hypothesis. |

---

## 4. Integration with `crypto-agent`

[`crypto-agent`](file:///home/nemesis/projects/crypto-trading/crypto-agent) imports `@nemesis-oss/market-events` and `@nemesis-oss/market-research` directly.

Instead of prompting LLMs with raw chart indicators, the agent pipeline:

1. Observes market events causally on streaming candles.
2. Queries the research engine for the empirical evidence profile of the current setup and regime.
3. Uses the resulting `EvidenceStatus`, `oddsRatio`, and `reachRates` to drive position sizing, invalidation horizons, and risk-reward targets.
