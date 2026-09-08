import { Decimal } from 'decimal.js';
import type { Candle, Timeframe, BaseEvent } from '@nemesis-oss/market-events';
import {
  detectFvg,
  detectSwings,
  detectStructureBreaks,
  detectOrderBlocks,
  detectLiquiditySweeps
} from '@nemesis-oss/market-events';
import { evaluateFvgOutcome } from './fvg-outcomes.js';
import { evaluateGenericOutcome } from './generic-outcomes.js';
import type { ComponentStudyResult, EventOutcome } from './types.js';

export interface RunStudyOptions {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly horizonCandles?: number;
}

function calculateSimpleAtr(candles: readonly Candle[], period: number = 14): Decimal {
  if (candles.length < 2) return new Decimal(1);
  const ranges: Decimal[] = [];
  const start = Math.max(1, candles.length - period);

  for (let i = start; i < candles.length; i++) {
    const c = candles[i]!;
    const prev = candles[i - 1]!;
    const tr1 = c.high.minus(c.low);
    const tr2 = c.high.minus(prev.close).abs();
    const tr3 = c.low.minus(prev.close).abs();
    ranges.push(Decimal.max(tr1, tr2, tr3));
  }

  const sum = ranges.reduce((acc, r) => acc.plus(r), new Decimal(0));
  return ranges.length > 0 ? sum.dividedBy(ranges.length) : new Decimal(1);
}

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function buildStudyResult(
  symbol: string,
  timeframe: Timeframe,
  eventType: string,
  outcomes: readonly EventOutcome[]
): ComponentStudyResult {
  const sampleSize = outcomes.length;
  if (sampleSize === 0) {
    return {
      symbol,
      timeframe,
      eventType,
      sampleSize: 0,
      retestProbability: 0,
      fill25Rate: 0,
      fill50Rate: 0,
      fullFillRate: 0,
      medianMfeAtr: 0,
      medianMaeAtr: 0,
      hitRates: { r1: 0, r2: 0, r3: 0 }
    };
  }

  return {
    symbol,
    timeframe,
    eventType,
    sampleSize,
    retestProbability: outcomes.filter(o => o.firstTouchIndex !== null).length / sampleSize,
    fill25Rate: outcomes.filter(o => o.touch25).length / sampleSize,
    fill50Rate: outcomes.filter(o => o.touch50).length / sampleSize,
    fullFillRate: outcomes.filter(o => o.fullFill).length / sampleSize,
    medianMfeAtr: calculateMedian(outcomes.map(o => o.mfeAtr.toNumber())),
    medianMaeAtr: calculateMedian(outcomes.map(o => o.maeAtr.toNumber())),
    hitRates: {
      r1: outcomes.filter(o => o.hit1R).length / sampleSize,
      r2: outcomes.filter(o => o.hit2R).length / sampleSize,
      r3: outcomes.filter(o => o.hit3R).length / sampleSize
    }
  };
}

/**
 * Runs study across all core detected primitives (FVG, OB, BOS, Liquidity Sweeps).
 */
export function runUniversalStudy(
  candles: readonly Candle[],
  options: RunStudyOptions
): ComponentStudyResult[] {
  const horizon = options.horizonCandles ?? 24;
  const atr = calculateSimpleAtr(candles);
  const { symbol, timeframe } = options;

  // 1. FVG
  const fvgs = detectFvg(candles, { symbol, timeframe });
  const fvgOutcomes = fvgs.map(f => evaluateFvgOutcome(candles, f, { horizonCandles: horizon, atr }));
  const fvgResult = buildStudyResult(symbol, timeframe, 'fvg', fvgOutcomes);

  // 2. Swings & Structure
  const swings = detectSwings(candles, { leftBars: 2, rightBars: 2 });
  const breaks = detectStructureBreaks(candles, swings, { symbol, timeframe });
  const bosOutcomes = breaks.map(b => evaluateGenericOutcome(candles, b, { horizonCandles: horizon, atr }));
  const bosResult = buildStudyResult(symbol, timeframe, 'bos', bosOutcomes);

  // 3. Order Blocks
  const obs = detectOrderBlocks(candles, breaks, { symbol, timeframe });
  const obOutcomes = obs.map(o => evaluateGenericOutcome(candles, o, { horizonCandles: horizon, atr }));
  const obResult = buildStudyResult(symbol, timeframe, 'order_block', obOutcomes);

  // 4. Sweeps
  const sweeps = detectLiquiditySweeps(candles, swings, { symbol, timeframe });
  const sweepOutcomes = sweeps.map(s => evaluateGenericOutcome(candles, s, { horizonCandles: horizon, atr }));
  const sweepResult = buildStudyResult(symbol, timeframe, 'liquidity_sweep', sweepOutcomes);

  return [fvgResult, bosResult, obResult, sweepResult];
}

export function runFvgStudy(candles: readonly Candle[], options: RunStudyOptions): ComponentStudyResult {
  const all = runUniversalStudy(candles, options);
  return all.find(r => r.eventType === 'fvg')!;
}
