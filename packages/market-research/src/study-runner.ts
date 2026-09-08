import { Decimal } from 'decimal.js';
import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import { detectFvg } from '@nemesis-oss/market-events';
import { evaluateFvgOutcome } from './fvg-outcomes.js';
import type { ComponentStudyResult, EventOutcome } from './types.js';

export interface RunFvgStudyOptions {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly horizonCandles?: number;
  readonly defaultAtrMultiplier?: number;
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
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/**
 * Executes a statistical research study on Fair Value Gaps across historical candles.
 */
export function runFvgStudy(
  candles: readonly Candle[],
  options: RunFvgStudyOptions
): ComponentStudyResult {
  const horizon = options.horizonCandles ?? 24;
  const atr = calculateSimpleAtr(candles);
  const events = detectFvg(candles, {
    symbol: options.symbol,
    timeframe: options.timeframe
  });

  const outcomes: EventOutcome[] = [];
  for (const event of events) {
    outcomes.push(evaluateFvgOutcome(candles, event, { horizonCandles: horizon, atr }));
  }

  const sampleSize = outcomes.length;
  if (sampleSize === 0) {
    return {
      symbol: options.symbol,
      timeframe: options.timeframe,
      eventType: 'fvg',
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

  const retestCount = outcomes.filter(o => o.firstTouchIndex !== null).length;
  const fill25Count = outcomes.filter(o => o.touch25).length;
  const fill50Count = outcomes.filter(o => o.touch50).length;
  const fullFillCount = outcomes.filter(o => o.fullFill).length;
  const hit1Count = outcomes.filter(o => o.hit1R).length;
  const hit2Count = outcomes.filter(o => o.hit2R).length;
  const hit3Count = outcomes.filter(o => o.hit3R).length;

  const mfeAtrs = outcomes.map(o => o.mfeAtr.toNumber());
  const maeAtrs = outcomes.map(o => o.maeAtr.toNumber());

  return {
    symbol: options.symbol,
    timeframe: options.timeframe,
    eventType: 'fvg',
    sampleSize,
    retestProbability: retestCount / sampleSize,
    fill25Rate: fill25Count / sampleSize,
    fill50Rate: fill50Count / sampleSize,
    fullFillRate: fullFillCount / sampleSize,
    medianMfeAtr: calculateMedian(mfeAtrs),
    medianMaeAtr: calculateMedian(maeAtrs),
    hitRates: {
      r1: hit1Count / sampleSize,
      r2: hit2Count / sampleSize,
      r3: hit3Count / sampleSize
    }
  };
}
