# @nemesis-oss/market-events

Deterministic market-event and price-structure engine with strict causal lifecycle timeline validation.

---

## Features & Detector Library

All detectors are pure, deterministic functions operating on immutable `Candle[]` series with zero lookahead bias.

| Detector | Function | Description |
| :--- | :--- | :--- |
| **Fair Value Gaps** | `detectFvg()`, `detectIfvg()` | Imbalances and Inverted FVGs with CE (50%) and boundary tracking. |
| **Swings** | `detectSwings()` | Causal fractal swing highs and lows with confirmation delays. |
| **Structure Breaks** | `detectBos()`, `detectChoch()`, `detectMss()` | Break of Structure (continuation), Change of Character (internal), Market Structure Shift (major reversal). |
| **Order Blocks** | `detectOrderBlocks()`, `detectBreakers()` | Origin candles of strong structural breaks and mitigated breakers. |
| **Liquidity Sweeps** | `detectLiquiditySweeps()` | Sweeps of prior swing liquidity pools with reclaim confirmation. |
| **Displacement** | `detectDisplacement()` | High-volume, outsized range bars indicating institutional flow. |
| **Volume Spread Analysis** | `detectVsa()` | Volume-spread anomalies (stopping volume, absorption, no demand/supply). |
| **Derivatives Flow** | `detectDerivativesEvents()` | Open interest deltas, funding extremes, and taker imbalances. |
| **Wyckoff** | `detectWyckoff()` | Schematic events (Accumulation Springs, Distribution Upthrusts). |
| **Harmonics & Patterns** | `detectHarmonics()`, `detectPatterns()` | Gartley/Bat/Butterfly and classical double tops/bottoms, wedges, flags. |
| **Sessions & Profiles** | `getActiveSessions()`, `calculateVolumeProfile()` | Trading session windows (Asia/London/NY) and Volume POC/VAH/VAL. |

---

## Causal Lifecycle Model

Every event produces an [`EventTimeline`](file:///home/nemesis/projects/quant-libraries/market-intelligence/packages/market-events/src/types.ts) enforcing:

$$\text{originIndex} \le \text{formedAtIndex} \le \text{confirmedAtIndex} \le \text{availableAtIndex}$$

* `originIndex` / `originTimestamp`: Candle where pattern began.
* `availableAtIndex` / `availableAtTimestamp`: Earliest candle where event was causally observable.
* Call [`validateEventCausality(event)`](file:///home/nemesis/projects/quant-libraries/market-intelligence/packages/market-events/src/types.ts) to verify invariant satisfaction.

---

## Usage Example

```typescript
import {
  detectSwings,
  detectBos,
  detectChoch,
  detectOrderBlocks,
  detectLiquiditySweeps
} from '@nemesis-oss/market-events';

// 1. Detect swing points (2 left bars, 2 right bars confirmation)
const swings = detectSwings(candles, { leftBars: 2, rightBars: 2 });

// 2. Detect continuation BOS vs counter-trend CHoCH
const bos = detectBos(candles, swings, { symbol: 'BTCUSDT', timeframe: '15m' });
const choch = detectChoch(candles, swings, { symbol: 'BTCUSDT', timeframe: '15m' });

// 3. Detect order blocks formed at structural breaks
const orderBlocks = detectOrderBlocks(candles, bos, { symbol: 'BTCUSDT', timeframe: '15m' });

// 4. Detect liquidity sweeps with pool reclaim
const sweeps = detectLiquiditySweeps(candles, swings, { symbol: 'BTCUSDT', timeframe: '15m' });
```
