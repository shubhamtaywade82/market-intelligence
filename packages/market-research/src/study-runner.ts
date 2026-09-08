import { Decimal } from 'decimal.js';
import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import {
  detectFvg,
  detectSwings,
  detectStructureBreaks,
  detectOrderBlocks,
  detectLiquiditySweeps
} from '@nemesis-oss/market-events';
import { evaluateFvgOutcome } from './fvg-outcomes.js';
import { evaluateGenericOutcome } from './generic-outcomes.js';
import { calculateWilsonInterval, compareAgainstBaseline } from './statistical-significance.js';
import type { ComponentStudyResult, DirectionalOutcome, ZoneOutcome } from './types.js';

export interface RunStudyOptions {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly horizonCandles?: number;
}

/**
 * Calculates causal, event-time ATR using only candles prior to or at index i.
 */
export function calculateCausalAtr(candles: readonly Candle[], index: number, period: number = 14): Decimal {
  if (index < 1) {
    const c = candles[0];
    return c ? c.high.minus(c.low) : new Decimal(1);
  }

  const ranges: Decimal[] = [];
  const start = Math.max(1, index - period + 1);

  for (let i = start; i <= index; i++) {
    const c = candles[i]!;
    const prev = candles[i - 1]!;
    const tr1 = c.high.minus(c.low);
    const tr2 = c.high.minus(prev.close).abs();
    const tr3 = c.low.minus(prev.close).abs();
    ranges.push(Decimal.max(tr1, tr2, tr3));
  }

  const sum = ranges.reduce((acc, r) => acc.plus(r), new Decimal(0));
  const avg = ranges.length > 0 ? sum.dividedBy(ranges.length) : new Decimal(1);
  return avg.isZero() ? new Decimal(1) : avg;
}

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function isZoneOutcome(outcome: DirectionalOutcome | ZoneOutcome): outcome is ZoneOutcome {
  return 'touch25' in outcome && typeof outcome.touch25 === 'boolean';
}

/**
 * Evaluates an unconditional control baseline over a subset of regular candles (sampling every 5th bar).
 */
export function evaluateBaselineControl(
  candles: readonly Candle[],
  horizon: number
): { hitsR2: number; total: number } {
  let hitsR2 = 0;
  let total = 0;

  for (let i = 14; i < candles.length - horizon; i += 5) {
    const atr = calculateCausalAtr(candles, i);
    const outcome = evaluateGenericOutcome(candles, {
      id: `baseline-${i}`,
      type: 'baseline_control',
      symbol: 'CONTROL',
      timeframe: '15m',
      detectedAt: candles[i]!.timestamp,
      originIndex: i,
      direction: 'bullish'
    }, { horizonCandles: horizon, atr });

    if (outcome.hit2R) hitsR2++;
    total++;
  }

  return { hitsR2, total };
}

function buildStudyResult(
  symbol: string,
  timeframe: Timeframe,
  eventType: string,
  outcomes: readonly (DirectionalOutcome | ZoneOutcome)[],
  baseline: { hitsR2: number; total: number }
): ComponentStudyResult {
  const sampleSize = outcomes.length;
  if (sampleSize === 0) {
    return {
      symbol,
      timeframe,
      eventType,
      sampleSize: 0,
      retestProbability: null,
      fill25Rate: null,
      fill50Rate: null,
      fullFillRate: null,
      medianMfeAtr: 0,
      medianMaeAtr: 0,
      hitRates: { r1: 0, r2: 0, r3: 0 }
    };
  }

  const zoneOutcomes = outcomes.filter(isZoneOutcome);
  const isZoneType = zoneOutcomes.length === sampleSize;

  const hit1Count = outcomes.filter(o => o.hit1R).length;
  const hit2Count = outcomes.filter(o => o.hit2R).length;
  const hit3Count = outcomes.filter(o => o.hit3R).length;

  const intervalR2 = calculateWilsonInterval(hit2Count, sampleSize);
  const baselineStats = compareAgainstBaseline(hit2Count, sampleSize, baseline.hitsR2, baseline.total);

  return {
    symbol,
    timeframe,
    eventType,
    sampleSize,
    retestProbability: isZoneType ? zoneOutcomes.filter(o => o.firstTouchIndex !== null).length / sampleSize : null,
    fill25Rate: isZoneType ? zoneOutcomes.filter(o => o.touch25).length / sampleSize : null,
    fill50Rate: isZoneType ? zoneOutcomes.filter(o => o.touch50).length / sampleSize : null,
    fullFillRate: isZoneType ? zoneOutcomes.filter(o => o.fullFill).length / sampleSize : null,
    medianMfeAtr: calculateMedian(outcomes.map(o => o.mfeAtr.toNumber())),
    medianMaeAtr: calculateMedian(outcomes.map(o => o.maeAtr.toNumber())),
    hitRates: {
      r1: hit1Count / sampleSize,
      r2: hit2Count / sampleSize,
      r3: hit3Count / sampleSize
    },
    confidenceIntervalR2: {
      lower: intervalR2.lower,
      upper: intervalR2.upper
    },
    baselineComparisonR2: {
      baselineProbability: baselineStats.baselineProbability,
      uplift: baselineStats.uplift,
      isStatisticallySignificant: baselineStats.isStatisticallySignificant,
      pValueEstimate: baselineStats.pValueEstimate
    }
  };
}

/**
 * Runs study across detected components using causal event-time ATR and baseline control comparison.
 */
export function runUniversalStudy(
  candles: readonly Candle[],
  options: RunStudyOptions
): ComponentStudyResult[] {
  const horizon = options.horizonCandles ?? 24;
  const { symbol, timeframe } = options;
  const baseline = evaluateBaselineControl(candles, horizon);

  // 1. FVG
  const fvgs = detectFvg(candles, { symbol, timeframe });
  const fvgOutcomes = fvgs.map(f => {
    const atr = calculateCausalAtr(candles, f.originIndex);
    return evaluateFvgOutcome(candles, f, { horizonCandles: horizon, atr });
  });
  const fvgResult = buildStudyResult(symbol, timeframe, 'fvg', fvgOutcomes, baseline);

  // 2. Swings & Structure
  const swings = detectSwings(candles, { leftBars: 2, rightBars: 2 });
  const breaks = detectStructureBreaks(candles, swings, { symbol, timeframe });
  const bosOutcomes = breaks.map(b => {
    const atr = calculateCausalAtr(candles, b.originIndex);
    return evaluateGenericOutcome(candles, b, { horizonCandles: horizon, atr });
  });
  const bosResult = buildStudyResult(symbol, timeframe, 'bos', bosOutcomes, baseline);

  // 3. Order Blocks
  const obs = detectOrderBlocks(candles, breaks, { symbol, timeframe });
  const obOutcomes = obs.map(o => {
    const atr = calculateCausalAtr(candles, o.originIndex);
    return evaluateGenericOutcome(candles, o, { horizonCandles: horizon, atr });
  });
  const obResult = buildStudyResult(symbol, timeframe, 'order_block', obOutcomes, baseline);

  // 4. Sweeps
  const sweeps = detectLiquiditySweeps(candles, swings, { symbol, timeframe });
  const sweepOutcomes = sweeps.map(s => {
    const atr = calculateCausalAtr(candles, s.originIndex);
    return evaluateGenericOutcome(candles, s, { horizonCandles: horizon, atr });
  });
  const sweepResult = buildStudyResult(symbol, timeframe, 'liquidity_sweep', sweepOutcomes, baseline);

  return [fvgResult, bosResult, obResult, sweepResult];
}

export function runFvgStudy(candles: readonly Candle[], options: RunStudyOptions): ComponentStudyResult {
  const all = runUniversalStudy(candles, options);
  return all.find(r => r.eventType === 'fvg')!;
}
