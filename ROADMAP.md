# Roadmap: market-intelligence → market intelligence platform

This document tracks the evolution from the current research library (4 packages)
toward a full market intelligence platform. Each item has a priority, estimated
effort, and dependencies on prior items.

## Current state (v0.2)

```
@nemesis-oss/agentic-runtime
              │
              ▼
@nemesis-oss/market-research-agent   ← agentic research interface
          ┌───┴────┐
          ▼        ▼
 market-events  market-research      ← deterministic engines
                                    │
              ┌─────────────────────┤
              ▼                     ▼
        market-data            market-stream    ← live intelligence
```

| Package | Status | Tests |
| :--- | :--- | :---: |
| `market-events` | ✅ complete | 21 |
| `market-research` | ✅ complete | 55 |
| `research-agent` | ✅ complete (9 tools, E2E test) | 18 |
| `market-data` | ✅ v0.1 (Binance REST+WS, Bybit REST) | 9 |
| `market-stream` | ✅ v0.1 (live MarketState, multi-stream) | 12 |

**Total: 120 tests passing.**

---

## Roadmap

### ✅ 1. Market Data Layer — `packages/market-data/` (DONE)

**Status:** v0.1 shipped. Binance REST (klines, funding, OI, mark price) + Binance
WebSocket (live klines with reconnect/recovery) + Bybit REST (klines, funding, OI,
mark price). `createResearchAgentFromExchange()` convenience in research-agent.

**Next:** Bybit WebSocket adapter. CoinDCX adapter. Liquidation feed. Depth/order
book streaming. Trades stream.

### ✅ 2. Live Market Intelligence — `packages/market-stream/` (DONE)

**Status:** v0.1 shipped. Continuously maintained `MarketState` from exchange
WebSocket feeds: price, trend regime, volatility regime, ATR, session, active
events (FVG, BOS, CHoCH, MSS, order blocks, liquidity sweeps, displacement).
Multi-symbol/multi-timeframe orchestration with per-stream rolling candle
buffers, timestamp deduplication, and backpressure-safe synchronous processing.

**Next:** Higher-timeframe state aggregation. Cross-stream event correlation.
Market-state snapshot persistence.

### ⬜ 3. Real-Time Market State — `packages/market-state/`

**Priority:** High. **Effort:** 1–2 weeks. **Depends on:** #2.

A continuously updated `MarketState` object that becomes the single source of
truth for "what is the market doing right now":

```typescript
interface MarketState {
  symbol: string;
  timestamp: number;
  price: Decimal;
  trend: TrendRegime;
  volatility: VolatilityRegime;
  regime: CompositeRegime;
  structure: StructureSnapshot;
  liquidity: LiquidityMap;
  displacement: DisplacementSnapshot;
  openInterest: number;
  funding: number;
  takerFlow: TakerFlowSnapshot;
  volumeProfile: VolumeProfileSnapshot;
  sessions: ActiveSession[];
  activeEvents: BaseEvent[];
}
```

This is what `crypto-agent` consumes to make real-time trading decisions.

### ⬜ 4. Market Regime Engine — `packages/regime-engine/`

**Priority:** High. **Effort:** 2 weeks. **Depends on:** #3.

Composite regime classification that enables conditional research:

```
SOLUSDT 15m
├── Trend:       bullish
├── Volatility:  expanding
├── Liquidity:   thin
├── OI:          rising
├── Funding:     positive
├── Flow:        aggressive buying
└── Session:     NY
```

**Deliverables:**
- `RegimeEngine` that produces a `CompositeRegime` from `MarketState`.
- Research tools can condition on regime: "FVG performance *when* trend is
  bullish AND volatility is expanding AND OI is rising."
- This is much more powerful than testing FVG globally.

### ⬜ 5. Feature Engineering Layer — `packages/market-features/`

**Priority:** Medium. **Effort:** 2 weeks. **Depends on:** #1.

Reusable deterministic features as conditioning variables:

- **Price:** returns, ATR, range, volatility, momentum
- **Volume:** volume delta, relative volume, CVD, volume acceleration
- **Microstructure:** spread, depth imbalance, order-flow imbalance, trade intensity
- **Derivatives:** OI change, funding, basis, liquidation pressure, taker imbalance

Event research can use these features as conditioning variables for
hypothesis testing.

### ⬜ 6. Event Interaction Graph — `packages/event-graph/`

**Priority:** Medium. **Effort:** 2–3 weeks. **Depends on:** existing `evaluate_interaction` tool.

Represent the market as an event graph and discover composite conditions:

```
FVG ──── Sweep
  │         │
  BOS ──── MSS ──── OI ──── Funding
```

Discover patterns like `FVG → Sweep → MSS` or
`Sweep + positive OI delta + bullish displacement` as composite tradeable
conditions. Directly feeds strategy discovery.

### ⬜ 7. Hypothesis Engine — `packages/hypothesis-engine/`

**Priority:** High. **Effort:** 3–4 weeks. **Depends on:** #4, #5, #6.

LLM proposes hypotheses; the engine tests them deterministically:

```
research-agent → Hypothesis Engine → candidate hypothesis
  → deterministic research → WFO → OOS → validated / rejected
```

Example hypothesis:
> "Bullish FVGs are more reliable when HTF structure is bullish, price has
> swept sell-side liquidity, displacement > 1.5 ATR, and OI is increasing."

The LLM proposes; the engine tests and returns a sealed verdict.

### ⬜ 8. Automated Strategy Discovery — `packages/strategy-discovery/`

**Priority:** High. **Effort:** 4–6 weeks. **Depends on:** #7.

Natural evolution of the current research engine:

```
events + features + regimes + interactions
  → candidate conditions → candidate strategies
  → backtest → WFO → OOS → statistical validation
```

Output: structured `StrategyCandidate` objects with full provenance:

```typescript
interface StrategyCandidate {
  entryConditions: Condition[];
  contextConditions: Condition[];
  invalidation: InvalidationRule;
  targetModel: TargetModel;
  sampleSize: number;
  expectancyR: number;
  winRate: number;
  confidenceInterval: { lower: number; upper: number };
  baselineComparison: BaselineComparison;
  oosPerformance: OosPerformance;
  degradation: number;
  robustness: RobustnessScore;
  provenance: Provenance;
}
```

This is the bridge toward the autonomous learning system in `crypto-agent`.

### ⬜ 9. Strategy Registry — `packages/strategy-registry/`

**Priority:** Medium. **Effort:** 1–2 weeks. **Depends on:** #8.

Lifecycle management for discovered strategies:

```
DISCOVERED → RESEARCHED → BACKTESTED → WFO_VALIDATED → OOS_VALIDATED
  → PAPER → PROMOTED → ACTIVE → DEGRADED → RETIRED
```

Gives the research platform memory of what it has discovered, validated,
and retired.

### ⬜ 10. Research Memory — `packages/research-memory/`

**Priority:** Medium. **Effort:** 2 weeks. **Depends on:** #7.

Persistent domain memory so the agent can reason:

> "I already tested bullish FVG + BOS on SOLUSDT 15m in 2025 and the edge
> disappeared OOS."

instead of rediscovering the same hypothesis.

**Stores:** hypotheses, experiments, datasets, event studies, interactions,
rejected hypotheses, validated hypotheses, strategy candidates, provenance.

### ⬜ 11. Negative Evidence as First-Class System

**Priority:** Medium. **Effort:** 1 week. **Depends on:** existing `negative-evidence.ts`.

Elevate the existing `negative-evidence.ts` into a continuous process:

```
Strategy → positive evidence + negative evidence → evidence balance
```

Example:
```
FVG strategy
  Positive:  +12% relative uplift
  Negative:  -18% during high volatility
             -11% with HTF conflict
             -9% after liquidity sweep failure
```

Produces a much more realistic strategy profile.

### ⬜ 12. Market Intelligence API — `packages/api/`

**Priority:** Low. **Effort:** 2–3 weeks. **Depends on:** #2–#10.

Expose the platform through an HTTP API:

```
/api
├── /markets
├── /events
├── /state
├── /research
├── /studies
├── /hypotheses
├── /strategies
└── /datasets
```

So that `crypto-agent`, dashboards, CLIs, research-agent, and notebooks can
all consume the same intelligence layer.

---

## Target architecture

```
market-intelligence
┌────────────────────────────────────────────────────────────┐
│                     research-agent                         │
│                         │                                  │
│                  hypothesis engine                         │
│                         │                                  │
│                 strategy discovery                         │
├─────────────────────────┼──────────────────────────────────┤
│                    research                                │
│  studies • interactions • WFO • OOS • significance         │
│  matched controls • negative evidence • calibration       │
├─────────────────────────┼──────────────────────────────────┤
│                 intelligence                               │
│  regime • features • market state • event graph          │
├─────────────────────────┼──────────────────────────────────┤
│                     events                                │
│  FVG • BOS • MSS • CHoCH • OB • sweeps • VSA • Wyckoff    │
├─────────────────────────┼──────────────────────────────────┤
│                    market data                             │
│  Binance • Bybit • CoinDCX • historical • WebSocket       │
└────────────────────────────────────────────────────────────┘
                         │
                         ▼
                    crypto-agent
```

## Boundary

`market-intelligence` answers:
- What is happening?
- What has historically worked?
- Under what conditions?
- What evidence supports it?
- What hypotheses should be tested?

`crypto-agent` answers:
- Should I trade?
- How much?
- When should I enter?
- Can I execute?
- How do I manage risk?

This keeps `market-intelligence` a genuinely reusable intelligence platform,
rather than another crypto-trading repository.
