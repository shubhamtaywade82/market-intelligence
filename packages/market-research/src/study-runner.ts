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
import { extractContextSnapshot } from './context-features.js';
import type {
  ComponentStudyResult,
  DirectionalOutcome,
  EventOutcome,
  FvgOutcome,
  OutcomeConfig,
  Provenance,
  ResearchObservation,
  ResearchResult
} from './types.js';
import type { HtfCandlesMap } from './multi-timeframe.js';

export interface RunStudyOptions {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly horizonCandles?: number | undefined;
  readonly ambiguityPolicy?: 'pessimistic' | 'optimistic' | 'ambiguous' | undefined;
  readonly htfCandlesMap?: HtfCandlesMap | undefined;
}

export function computeDeterministicHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
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

export function createResearchObservations(
  events: readonly BaseEvent[],
  candles: readonly Candle[],
  config: OutcomeConfig,
  htfCandlesMap?: HtfCandlesMap | undefined
): readonly ResearchObservation[] {
  const datasetId = events[0] ? `${events[0].symbol}-${events[0].timeframe}` : 'unknown';
  const datasetHash = computeDeterministicHash(`${datasetId}-${candles.length}-${candles[0]?.timestamp ?? 0}`);
  const configHash = computeDeterministicHash(JSON.stringify(config));

  return events.map(ev => {
    const context = extractContextSnapshot(candles, ev.originIndex, htfCandlesMap);
    const outcome = evaluateEventOutcome(ev, candles, context.atr, config);
    const provenance: Provenance = {
      datasetId,
      datasetHash,
      detectorId: ev.type,
      detectorVersion: '1.0.0',
      detectorConfigHash: configHash,
      outcomeVersion: '1.0.0'
    };

    return { event: ev, context, outcome, provenance };
  });
}

interface ComponentMeta {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly eventType: string;
}

interface ComponentEvalOptions extends ComponentMeta {
  readonly config: OutcomeConfig;
  readonly htfCandlesMap?: HtfCandlesMap | undefined;
}

function evaluateStudyComponent(
  opts: ComponentEvalOptions,
  events: readonly BaseEvent[],
  candles: readonly Candle[]
): { readonly result: ComponentStudyResult; readonly observations: readonly ResearchObservation[] } {
  const observations = createResearchObservations(events, candles, opts.config, opts.htfCandlesMap);
  const outcomes = observations.map(o => o.outcome);

  const controls = generateMatchedControls(events, candles, opts.config, { matchTrendRegime: true });
  const episodes = clusterEventsIntoEpisodes(events, { maxCandleGap: 3 });
  const clusterSizes = episodes.map(ep => ep.eventsCount);

  const result = buildStudyResult(opts, outcomes, controls.map(c => c.outcome), clusterSizes);
  return { result, observations };
}

function buildStudyResult(
  meta: ComponentMeta,
  outcomes: readonly EventOutcome[],
  controlOutcomes: readonly DirectionalOutcome[],
  clusterSizes: readonly number[]
): ComponentStudyResult {
  const { symbol, timeframe, eventType } = meta;
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

export interface ObservationStudyResult {
  readonly observations: readonly ResearchObservation[];
  readonly results: readonly ComponentStudyResult[];
}

export function runObservationStudy(
  candles: readonly Candle[],
  options: RunStudyOptions
): ObservationStudyResult {
  const config: OutcomeConfig = {
    ...DEFAULT_OUTCOME_CONFIG,
    horizonCandles: options.horizonCandles ?? 24,
    ambiguityPolicy: options.ambiguityPolicy ?? 'pessimistic'
  };
  const { symbol, timeframe, htfCandlesMap } = options;

  const fvgs = detectFvg(candles, { symbol, timeframe });
  const fvgEval = evaluateStudyComponent({ symbol, timeframe, eventType: 'fvg', config, htfCandlesMap }, fvgs, candles);

  const swings = detectSwings(candles, { leftBars: 2, rightBars: 2 });
  const breaks = detectStructureBreaks(candles, swings, { symbol, timeframe });
  const bosEval = evaluateStudyComponent({ symbol, timeframe, eventType: 'bos', config, htfCandlesMap }, breaks, candles);

  const obs = detectOrderBlocks(candles, breaks, { symbol, timeframe });
  const obEval = evaluateStudyComponent({ symbol, timeframe, eventType: 'order_block', config, htfCandlesMap }, obs, candles);

  const sweeps = detectLiquiditySweeps(candles, swings, { symbol, timeframe });
  const sweepEval = evaluateStudyComponent({ symbol, timeframe, eventType: 'liquidity_sweep', config, htfCandlesMap }, sweeps, candles);

  return {
    observations: [...fvgEval.observations, ...bosEval.observations, ...obEval.observations, ...sweepEval.observations],
    results: [fvgEval.result, bosEval.result, obEval.result, sweepEval.result]
  };
}

export function runUniversalStudy(
  candles: readonly Candle[],
  options: RunStudyOptions
): ComponentStudyResult[] {
  return [...runObservationStudy(candles, options).results];
}

export function runFvgStudy(candles: readonly Candle[], options: RunStudyOptions): ComponentStudyResult {
  const all = runUniversalStudy(candles, options);
  return all.find(r => r.eventType === 'fvg')!;
}

export function toResearchResult(
  studyResult: ComponentStudyResult,
  candleCount: number,
  provenance: Provenance
): ResearchResult {
  const baseComp = studyResult.baselineComparisonR2;
  const sample = {
    eventType: studyResult.eventType,
    sampleSize: studyResult.sampleSize,
    effectiveSampleSize: studyResult.effectiveSampleSize ?? studyResult.sampleSize,
    clusterCount: studyResult.clusterCount ?? 1
  };

  return {
    population: { symbol: studyResult.symbol, timeframe: studyResult.timeframe, candleCount },
    sample,
    controls: { sampleSize: studyResult.sampleSize, matchedHitRateR2: baseComp?.baselineProbability ?? 0, matchRatio: 1.0 },
    descriptive: {
      hitRates: studyResult.hitRates, medianMfeAtr: studyResult.medianMfeAtr, medianMaeAtr: studyResult.medianMaeAtr,
      retestProbability: studyResult.retestProbability, fill25Rate: studyResult.fill25Rate,
      fill50Rate: studyResult.fill50Rate, fullFillRate: studyResult.fullFillRate
    },
    effect: { uplift: baseComp?.uplift ?? 0, relativeUplift: baseComp?.relativeUplift, oddsRatio: baseComp?.oddsRatio },
    uncertainty: { confidenceIntervalR2: studyResult.confidenceIntervalR2, medianMfeAtrCi: studyResult.medianMfeAtrCi },
    dependence: {
      clusterCount: sample.clusterCount, effectiveSampleSize: sample.effectiveSampleSize,
      pValueEstimate: baseComp?.pValueEstimate ?? 1, isStatisticallySignificant: baseComp?.isStatisticallySignificant ?? false
    },
    provenance
  };
}

