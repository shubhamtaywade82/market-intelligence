import { Decimal } from 'decimal.js';
import type { Candle, Timeframe, BaseEvent } from '@nemesis-oss/market-events';
import {
  detectFvg,
  detectSwings,
  detectStructureBreaks,
  detectOrderBlocks,
  detectLiquiditySweeps
} from '@nemesis-oss/market-events';
import {
  evaluateEventOutcome,
  DEFAULT_OUTCOME_CONFIG
} from './outcome-evaluators.js';
import { generateMatchedControls } from './matched-controls.js';
import {
  calculateWilsonInterval,
  calculateBootstrapMedianCi,
  compareAgainstBaseline
} from './statistical-significance.js';
import { clusterEventsIntoEpisodes } from './episode-clustering.js';
import type {
  ComponentStudyResult,
  DirectionalOutcome,
  EventOutcome,
  FvgOutcome,
  OutcomeConfig
} from './types.js';

export interface RunStudyOptions {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly horizonCandles?: number | undefined;
  readonly ambiguityPolicy?: 'pessimistic' | 'optimistic' | 'ambiguous' | undefined;
}

export function calculateCausalAtr(candles: readonly Candle[], index: number, period: number = 14): Decimal {
  if (candles.length === 0) return new Decimal(1);
  const clampedIdx = Math.min(candles.length - 1, Math.max(0, index));
  if (clampedIdx < 1) {
    const c = candles[0];
    return c ? c.high.minus(c.low) : new Decimal(1);
  }

  const ranges: Decimal[] = [];
  const start = Math.max(1, clampedIdx - period + 1);

  for (let i = start; i <= clampedIdx; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    if (!c || !prev) continue;
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

export function evaluateBaselineControl(
  candles: readonly Candle[],
  horizon: number
): { hitsR2: number; total: number } {
  let hitsR2 = 0;
  let total = 0;

  for (let i = 14; i < candles.length - horizon; i += 5) {
    const c = candles[i]!;
    const next = candles[Math.min(candles.length - 1, i + horizon)]!;
    const delta = next.close.minus(c.close);
    if (delta.abs().gte(c.high.minus(c.low).times(2))) hitsR2++;
    total++;
  }

  return { hitsR2, total: Math.max(1, total) };
}

function evaluateStudyComponent(
  symbol: string,
  timeframe: Timeframe,
  eventType: string,
  events: readonly BaseEvent[],
  candles: readonly Candle[],
  config: OutcomeConfig
): ComponentStudyResult {
  const outcomes = events.map(ev => {
    const atr = calculateCausalAtr(candles, ev.originIndex);
    return evaluateEventOutcome(ev, candles, atr, config);
  });

  const controls = generateMatchedControls(events, candles, config);
  const episodes = clusterEventsIntoEpisodes(events, { maxCandleGap: 3 });
  const clusterSizes = episodes.map(ep => ep.eventsCount);

  return buildStudyResult(symbol, timeframe, eventType, outcomes, controls.map(c => c.outcome), clusterSizes);
}

function buildStudyResult(
  symbol: string,
  timeframe: Timeframe,
  eventType: string,
  outcomes: readonly EventOutcome[],
  controlOutcomes: readonly DirectionalOutcome[],
  clusterSizes: readonly number[]
): ComponentStudyResult {
  const sampleSize = outcomes.length;
  if (sampleSize === 0) {
    return {
      symbol, timeframe, eventType, sampleSize: 0,
      retestProbability: null, fill25Rate: null, fill50Rate: null, fullFillRate: null,
      medianMfeAtr: 0, medianMaeAtr: 0, hitRates: { r1: 0, r2: 0, r3: 0 }
    };
  }

  const fvgOutcomes = outcomes.filter((o): o is FvgOutcome => 'fill25' in o);
  const isFvg = fvgOutcomes.length === sampleSize;

  const hit1Count = outcomes.filter(o => o.hit1R).length;
  const hit2Count = outcomes.filter(o => o.hit2R).length;
  const hit3Count = outcomes.filter(o => o.hit3R).length;
  const ctrlHitsR2 = controlOutcomes.filter(o => o.hit2R).length;

  const intervalR2 = calculateWilsonInterval(hit2Count, sampleSize);
  const mfeValues = outcomes.map(o => o.mfeAtr.toNumber());
  const medianMfeCi = calculateBootstrapMedianCi(mfeValues);
  const baselineStats = compareAgainstBaseline(hit2Count, sampleSize, ctrlHitsR2, controlOutcomes.length, clusterSizes);

  return {
    symbol, timeframe, eventType, sampleSize,
    effectiveSampleSize: baselineStats.effectiveSampleSize,
    clusterCount: clusterSizes.length,
    retestProbability: isFvg ? fvgOutcomes.filter(o => o.firstTouchBars !== null).length / sampleSize : null,
    fill25Rate: isFvg ? fvgOutcomes.filter(o => o.fill25).length / sampleSize : null,
    fill50Rate: isFvg ? fvgOutcomes.filter(o => o.fill50).length / sampleSize : null,
    fullFillRate: isFvg ? fvgOutcomes.filter(o => o.fill100).length / sampleSize : null,
    medianMfeAtr: calculateMedian(mfeValues),
    medianMaeAtr: calculateMedian(outcomes.map(o => o.maeAtr.toNumber())),
    medianMfeAtrCi: medianMfeCi,
    hitRates: { r1: hit1Count / sampleSize, r2: hit2Count / sampleSize, r3: hit3Count / sampleSize },
    confidenceIntervalR2: { lower: intervalR2.lower, upper: intervalR2.upper },
    baselineComparisonR2: {
      baselineProbability: baselineStats.baselineProbability,
      uplift: baselineStats.uplift,
      relativeUplift: baselineStats.relativeUplift,
      oddsRatio: baselineStats.oddsRatio,
      isStatisticallySignificant: baselineStats.isStatisticallySignificant,
      pValueEstimate: baselineStats.pValueEstimate
    }
  };
}

export function runUniversalStudy(
  candles: readonly Candle[],
  options: RunStudyOptions
): ComponentStudyResult[] {
  const config: OutcomeConfig = {
    ...DEFAULT_OUTCOME_CONFIG,
    horizonCandles: options.horizonCandles ?? 24,
    ambiguityPolicy: options.ambiguityPolicy ?? 'pessimistic'
  };
  const { symbol, timeframe } = options;

  const fvgs = detectFvg(candles, { symbol, timeframe });
  const fvgResult = evaluateStudyComponent(symbol, timeframe, 'fvg', fvgs, candles, config);

  const swings = detectSwings(candles, { leftBars: 2, rightBars: 2 });
  const breaks = detectStructureBreaks(candles, swings, { symbol, timeframe });
  const bosResult = evaluateStudyComponent(symbol, timeframe, 'bos', breaks, candles, config);

  const obs = detectOrderBlocks(candles, breaks, { symbol, timeframe });
  const obResult = evaluateStudyComponent(symbol, timeframe, 'order_block', obs, candles, config);

  const sweeps = detectLiquiditySweeps(candles, swings, { symbol, timeframe });
  const sweepResult = evaluateStudyComponent(symbol, timeframe, 'liquidity_sweep', sweeps, candles, config);

  return [fvgResult, bosResult, obResult, sweepResult];
}

export function runFvgStudy(candles: readonly Candle[], options: RunStudyOptions): ComponentStudyResult {
  const all = runUniversalStudy(candles, options);
  return all.find(r => r.eventType === 'fvg')!;
}
