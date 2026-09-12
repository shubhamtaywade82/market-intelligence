# Architecture & Methodology

`market-intelligence` is organized as an empirical evidence pipeline designed to mathematically validate market hypotheses without lookahead or data leakage. The deterministic engines (`market-events`, `market-research`) sit underneath an agentic research interface (`research-agent`) that drives LLM-guided investigation without ever letting the model own numerical claims.

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
                   │
                   ▼
      ─────────────────────────────────
      research-agent (@nemesis-oss/market-research-agent)
      ─────────────────────────────────
                   │
   ┌───────────────┴────────────────┐
   ▼                                ▼
 LLM-driven research           Direct tool invocation
 (ReAct loop via                 (backtest harness,
  @nemesis-oss/agentic-runtime    CLI, unit tests)
  + Ollama thought process)
   │                                │
   ▼                                ▼
  Sealed FinalReport           Deterministic ToolResult
  (No-Tools Guarantee)         (trustLevel: 'verified')
```

The agent layer never reaches below `ResearchResult` — every numerical claim in its sealed `FinalReport` must trace back to a deterministic tool call. The runtime's synthesis engine enforces this contract at seal time.

---

## 2. Core Subsystems

### A. Causal Event Lifecycle (`market-events`)

Every event detector produces a typed [`BaseEvent`](../../packages/market-events/src/types.ts) adhering to a strict temporal invariant:

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
   * Generates an authoritative [`OutcomeLabel`](../../packages/market-research/src/types.ts) (`startIndex`, `endIndex`, timestamps).

2. **Trade Execution Simulation (`TradeOutcome`)**:
   * Downstream simulator ([`simulateTradeExecution`](../../packages/market-research/src/generic-outcomes.ts)) that accepts fee structures, slippage models, and risk parameters to compute `realizedR` and `realizedPnl`.

### C. Counterfactual Matched Controls

A naive study might conclude that bullish order blocks have a 65% reach rate at +2R. However, if the underlying asset was in a strong bull regime where random entries had a 65% reach rate, the order block pattern offers **zero predictive edge**.

[`generateMatchedControls()`](../../packages/market-research/src/matched-controls.ts) pairs every event with pseudo-events in the same asset:

* Matched on identical trend regime (SMA slope / price location).
* Matched on volatility percentile (ATR).
* Matched on market session (London, New York, Asia).

Statistical uplift is calculated strictly relative to this matched counterfactual baseline.

### D. Autocorrelation & Cluster Bootstrap

Financial market events cluster in time (e.g. multiple structure breaks during a trend impulse). Treating them as independent, identically distributed ($i.i.d.$) samples artificially deflates standard errors and produces false $p$-values.

* [`clusterEventsIntoEpisodes()`](../../packages/market-research/src/episode-clustering.ts) groups events within a proximity gap into single independent episodes.
* Resampling operates at the **episode or matched-pair level**, calculating cluster-adjusted effective sample sizes and non-parametric bootstrap confidence intervals.

### E. Multiple-Testing & Hypothesis Families

When scanning 7 event types across multiple horizons and regimes, standard significance thresholds ($\alpha = 0.05$) guarantee false discoveries.

* **Benjamini-Hochberg (FDR)**: Controls the expected proportion of false discoveries across component studies.
* **Hypothesis Families**: [`adjustByHypothesisFamily()`](../../packages/market-research/src/multiple-testing.ts) groups tests into explicit families (e.g. structural continuation vs. liquidity reversal) before adjustment.

### F. Continuous Walk-Forward Validation

Validates whether an empirical edge persists out-of-sample across rolling market regimes:

1. **Hypothesis Discovery**: Identifies optimal filter rules on the training slice.
2. **Hypothesis Freezing**: Freezes rule definitions and hashes into a [`FrozenHypothesis`](../../packages/market-research/src/walk-forward.ts).
3. **Interval-Based Purging**: Purges training observations whose outcome window intersects the test boundary.
4. **Warmup Continuity**: Seeds test windows with prior historical bars to prevent cold-restart detector artifacts while strictly evaluating out-of-sample test events.
5. **Stability Assessment**: Computes degradation between in-sample and out-of-sample reach rates.

---

## 3. Evidence Status Classification

Every evaluated component receives an objective [`EvidenceStatus`](../../packages/market-research/src/types.ts):

| Status | Definition | Recommended Action |
| :--- | :--- | :--- |
| `robust` | Statistically significant ($p < 0.05$ after FDR adjustment) with positive baseline uplift. | Eligible for production strategy weighting. |
| `exploratory` | Nominally significant ($p < 0.05$ unadjusted) but does not pass FDR or has moderate sample size. | Candidate for condition refinement. |
| `descriptive_only` | Positive sample observations, but no statistically significant uplift over matched controls. | Do not use as standalone trade trigger. |
| `insufficient_sample` | Sample size ($N < 30$) too small for reliable inference. | Requires larger dataset. |
| `confounded` | Edge vanishes once matched controls or clustering are applied. | Reject hypothesis. |

---

## 4. Agentic Research Layer (`research-agent`)

`@nemesis-oss/market-research-agent` is a thin wrapper around the deterministic engines, built on [`@nemesis-oss/agentic-runtime`](https://www.npmjs.com/package/@nemesis-oss/agentic-runtime). It exposes 9 deterministic tools to the model and runs a ReAct loop with budgets, context compaction, and a terminal synthesis seal.

### Tool surface

All tools are `resourceClass: "local-cpu"`, `effects: "pure"`, `grantLevel: "auto"`. Deterministic outputs are tagged `trustLevel: "verified"` — the model may treat every number returned as ground truth for citation.

| Tool | Description |
| :--- | :--- |
| `list_event_detectors` | Lists the available deterministic detectors |
| `detect_events` | Runs a detector and returns events with full provenance |
| `get_market_context` | Computes regime/ATR/session/HTF snapshot at a candle index |
| `run_study` | Universal empirical study with matched controls, CIs, Benjamini-Hochberg FDR |
| `run_event_study` | Single-event-type empirical study |
| `evaluate_interaction` | Pairwise and anchor-based event interactions |
| `evaluate_negative_evidence` | HTF-conflict, early-failure, invalidated-zone impact on hit rate |
| `run_walk_forward` | Out-of-sample walk-forward stability validation |
| `dataset_summary` | Compact dataset overview for grounding the model |

### The crucial separation

| Component | Responsibility |
| :--- | :--- |
| `market-events` | Detect what happened |
| `market-research` | Determine what the historical evidence says |
| `research-agent` | Decide what to investigate and how |
| `agentic-runtime` | Execute the agent loop |
| `ollama-sdk` | Communicate with an Ollama server |
| MiniCPM5-2B (or any tool-calling model) | Research planning + interpretation |

The LLM never becomes part of either deterministic package. The agent asks questions like "Does FVG work?" and the loop turns that into a deterministic pipeline:

```text
detect FVG → run observations → evaluate outcomes → matched controls →
cluster dependence → confidence interval → baseline comparison →
multiple-testing correction → interpret evidence
```

See [`packages/research-agent/README.md`](../../packages/research-agent/README.md) for the full agent API and configuration.

---

## 5. Integration with `crypto-agent`

[`crypto-agent`](https://github.com/shubhamtaywade82/crypto-agent) vendors `packages/research-agent/` as a workspace package and depends on it for empirical evidence. The integration path:

1. **Mirror the monorepo layout.** Ensure `crypto-agent/pnpm-workspace.yaml` lists `packages/*`. Copy `market-intelligence/packages/research-agent/` to `crypto-agent/packages/research-agent/`. If `crypto-agent` does not already have `market-events` and `market-research`, add them too — they are required for the deterministic engine to compile.

2. **Wire the candle pipeline.** Convert exchange-adapter candles to the `Candle` shape expected by `market-events` (Decimal-typed OHLCV with ms timestamps), then construct a `ResearchContext`:

   ```typescript
   import { createResearchAgent } from '@nemesis-oss/market-research-agent';
   import { Decimal } from 'decimal.js';

   const candles = binanceKlines.map(k => ({
     timestamp: k.openTime,
     open: new Decimal(k.open),
     high: new Decimal(k.high),
     low: new Decimal(k.low),
     close: new Decimal(k.close),
     volume: new Decimal(k.volume),
   }));

   const agent = createResearchAgent({
     symbol: 'BTCUSDT',
     timeframe: '15m',
     candles,
     htfCandles: { '1h': htfCandles1h, '4h': htfCandles4h },
   });
   ```

3. **Call `agent.research(question)`** from your strategy or signal layer. The return value's `report` field is a sealed string suitable for logging or sending to a downstream consumer.

4. **Reuse the deterministic surface in your backtest harness.** Use `agent.invokeTool(...)` to obtain exact sample sizes, p-values, and walk-forward stability numbers without invoking Ollama. This lets your backtest and your agent share the same source of truth.

The dependency direction is one-way: `research-agent` depends on `market-events` and `market-research`, never the reverse. `crypto-agent` depends on `research-agent` and is free to add its own higher-level strategy code on top.
