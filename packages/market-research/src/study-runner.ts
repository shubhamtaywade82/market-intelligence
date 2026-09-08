import { Decimal } from 'decimal.js';
import type { Candle, Timeframe, BaseEvent } from '@nemesis-oss/market-events';
import { detectFvg, detectSwings, detectStructureBreaks, detectOrderBlocks, detectLiquiditySweeps } from '@nemesis-oss/market-events';
import { evaluateEventOutcome, DEFAULT_OUTCOME_CONFIG } from './outcome-evaluators.js';
import { generateMatchedControls, type MatchedControlObservation } from './matched-controls.js';
import { calculateWilsonInterval, calculateBootstrapMedianCi, compareAgainstBaseline, type ClusterObservation } from './statistical-significance.js';
import { clusterEventsIntoEpisodes, type EventEpisode } from './episode-clustering.js';
import { extractContextSnapshot } from './context-features.js';
import type { ComponentStudyResult, DirectionalOutcome, EventOutcome, FvgOutcome, OutcomeConfig, Provenance, ResearchObservation, ResearchResult } from './types.js';
import type { HtfCandlesMap } from './multi-timeframe.js';

export interface RunStudyOptions {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly horizonCandles?: number | undefined;
  readonly ambiguityPolicy?: 'pessimistic' | 'optimistic' | 'ambiguous' | undefined;
  readonly htfCandlesMap?: HtfCandlesMap | undefined;
}

import { createHash } from 'node:crypto';
import { calculateCausalAtr } from './causal-atr.js';

export { calculateCausalAtr };

export function computeDeterministicHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

export function computeDatasetSha256(candles: readonly Candle[]): string {
  const hash = createHash('sha256');
  for (const c of candles) {
    hash.update(`${c.timestamp}:${c.open}:${c.high}:${c.low}:${c.close}:${c.volume}|`);
  }
  return hash.digest('hex').slice(0, 16);
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
  const datasetHash = computeDatasetSha256(candles);
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

function buildClusterObservations(
  episodes: readonly EventEpisode[],
  observations: readonly ResearchObservation[],
  controls: readonly MatchedControlObservation[]
): { readonly eventClusters: ClusterObservation[]; readonly baselineClusters: ClusterObservation[] } {
  const obsMap = new Map(observations.map(o => [o.event.id, o]));
  const eventClusters: ClusterObservation[] = [];
  const baselineClusters: ClusterObservation[] = [];

  for (const ep of episodes) {
    const epObs = ep.allEvents.map(e => obsMap.get(e.id)).filter((o): o is ResearchObservation => o !== undefined);
    eventClusters.push({ hits: epObs.filter(o => o.outcome.hit2R).length, trials: epObs.length, clusterId: ep.episodeId });

    const epEventIds = new Set(ep.allEvents.map(e => e.id));
    const epControls = controls.filter(c => epEventIds.has(c.matchedEventId));
    if (epControls.length > 0) {
      baselineClusters.push({ hits: epControls.filter(c => c.outcome.hit2R).length, trials: epControls.length, clusterId: `ctrl-${ep.episodeId}` });
    }
  }

  return { eventClusters, baselineClusters };
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
  const { eventClusters, baselineClusters } = buildClusterObservations(episodes, observations, controls);

  const result = buildStudyResult({
    meta: opts,
    outcomes,
    controlOutcomes: controls.map(c => c.outcome),
    clusterSizes,
    eventClusters,
    baselineClusters
  });
  return { result, observations };
}

interface StudyResultData {
  readonly meta: ComponentMeta;
  readonly outcomes: readonly EventOutcome[];
  readonly controlOutcomes: readonly DirectionalOutcome[];
  readonly clusterSizes: readonly number[];
  readonly eventClusters?: readonly ClusterObservation[] | undefined;
  readonly baselineClusters?: readonly ClusterObservation[] | undefined;
}

function buildStudyResult(data: StudyResultData): ComponentStudyResult {
  const { meta, outcomes, controlOutcomes, clusterSizes } = data;
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
  const baselineStats = compareAgainstBaseline({
    eventHits: hit2Count,
    eventTrials: sampleSize,
    baselineHits: ctrlHitsR2,
    baselineTrials: controlOutcomes.length,
    clusterSizes,
    eventClusters: data.eventClusters,
    baselineClusters: data.baselineClusters
  });

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

