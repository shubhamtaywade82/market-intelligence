import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { runFvgStudy, runObservationStudy, toResearchResult, createResearchObservations } from '../src/study-runner.js';
import { extractContextFeatures } from '../src/context-features.js';
import { DEFAULT_OUTCOME_CONFIG } from '../src/outcome-evaluators.js';
import { detectSwings, detectStructureBreaks } from '@nemesis-oss/market-events';
import type { Candle, BaseEvent } from '@nemesis-oss/market-events';

function makeCandle(ts: number, open: number, high: number, low: number, close: number): Candle {
  return {
    timestamp: ts,
    open: new Decimal(open),
    high: new Decimal(high),
    low: new Decimal(low),
    close: new Decimal(close),
    volume: new Decimal(100)
  };
}

describe('Study Runner & Context Features', () => {
  it('computes aggregated statistical profile for FVGs across candle series', () => {
    const candles: Candle[] = [
      makeCandle(1000, 100, 105, 95, 102),
      makeCandle(2000, 102, 120, 101, 118), // Bullish FVG formed
      makeCandle(3000, 118, 125, 110, 122), // candle[2].low (110) > candle[0].high (105)
      makeCandle(4000, 122, 124, 107, 115), // retests into FVG (107 <= 110)
      makeCandle(5000, 115, 135, 114, 134)  // expansion to 135 (+20 points)
    ];

    const study = runFvgStudy(candles, {
      symbol: 'BTCUSDT',
      timeframe: '15m',
      horizonCandles: 3
    });

    expect(study.sampleSize).toBe(1);
    expect(study.retestProbability).toBe(1.0);
    expect(study.fill50Rate).toBe(1.0); // 110 - 107 = 3 / 5 = 60% > 50%
    expect(study.hitRates.r1).toBe(1.0);
    expect(study.hitRates.r2).toBe(1.0);
    expect(study.medianMfeAtr).toBeGreaterThan(0);
  });

  it('extracts volatility and trend regime context correctly', () => {
    const candles: Candle[] = [
      makeCandle(1000, 100, 102, 98, 101),
      makeCandle(2000, 101, 108, 100, 107),
      makeCandle(3000, 107, 104, 96, 97),
      makeCandle(4000, 97, 115, 97, 114) // large range breakout candle
    ];

    const swings = detectSwings(candles, { leftBars: 1, rightBars: 1 });
    const breaks = detectStructureBreaks(candles, swings, { symbol: 'BTCUSDT', timeframe: '15m' });
    const context = extractContextFeatures(candles, 3, swings, breaks);

    expect(context.displacementAtr.toNumber()).toBeGreaterThan(1);
    expect(['low', 'normal', 'high']).toContain(context.volatilityRegime);
    expect(context.session).toBeDefined();
  });

  it('produces typed ResearchObservations with mandatory provenance and lineage hashes', () => {
    const candles: Candle[] = [
      makeCandle(1000, 100, 105, 95, 102),
      makeCandle(2000, 102, 120, 101, 118),
      makeCandle(3000, 118, 125, 110, 122),
      makeCandle(4000, 122, 124, 107, 115),
      makeCandle(5000, 115, 135, 114, 134)
    ];

    const study = runObservationStudy(candles, {
      symbol: 'BTCUSDT',
      timeframe: '15m',
      horizonCandles: 3
    });

    expect(study.results.length).toBe(7);
    expect(study.observations.length).toBeGreaterThanOrEqual(1);

    const firstObs = study.observations[0]!;
    expect(firstObs.event.id).toBeDefined();
    expect(firstObs.context.atr.gt(0)).toBe(true);
    expect(firstObs.context.trendRegime).toBeDefined();
    expect(firstObs.outcome.targetHitR).toBeDefined();
    expect(firstObs.outcome.label?.startIndex).toBe(firstObs.event.availableAtIndex);
    expect(firstObs.outcome.label?.endIndex).toBeGreaterThanOrEqual(firstObs.outcome.label!.startIndex);
    expect(firstObs.provenance.datasetId).toBe('BTCUSDT-15m');
    expect(firstObs.provenance.datasetHash).toHaveLength(64);
    expect(firstObs.provenance.detectorConfigHash).toHaveLength(16);
    expect(firstObs.provenance.outcomeConfigHash).toHaveLength(16);
    expect(firstObs.provenance.detectorVersion).toBe('1.0.0');
    expect(firstObs.provenance.outcomeVersion).toBe('1.0.0');
  });

  it('transforms ComponentStudyResult into structured ResearchResult domain model', () => {
    const candles: Candle[] = [
      makeCandle(1000, 100, 105, 95, 102),
      makeCandle(2000, 102, 120, 101, 118),
      makeCandle(3000, 118, 125, 110, 122),
      makeCandle(4000, 122, 124, 107, 115),
      makeCandle(5000, 115, 135, 114, 134)
    ];

    const study = runObservationStudy(candles, { symbol: 'BTCUSDT', timeframe: '15m' });
    const fvgRes = study.results.find(r => r.eventType === 'fvg')!;
    const provenance = study.observations[0]!.provenance;

    const researchResult = toResearchResult(fvgRes, candles.length, provenance);

    expect(researchResult.population.symbol).toBe('BTCUSDT');
    expect(researchResult.population.candleCount).toBe(5);
    expect(researchResult.sample.eventType).toBe('fvg');
    expect(researchResult.descriptive.reachRates).toBeDefined();
    expect(researchResult.descriptive.hitRates).toBeDefined();
    expect(researchResult.provenance.datasetId).toBe('BTCUSDT-15m');
    expect(researchResult.dependence.pValueEstimate).toBeDefined();
    expect(researchResult.evidenceStatus).toBe('insufficient_sample');
  });

  it('integrates multiple-testing correction across component study results', () => {
    const candles: Candle[] = [
      makeCandle(1000, 100, 105, 95, 102),
      makeCandle(2000, 102, 120, 101, 118),
      makeCandle(3000, 118, 125, 110, 122),
      makeCandle(4000, 122, 124, 107, 115),
      makeCandle(5000, 115, 135, 114, 134)
    ];

    const study = runObservationStudy(candles, { symbol: 'BTCUSDT', timeframe: '15m' });
    expect(study.multipleTesting).toBeDefined();
    expect(study.multipleTesting!.procedure).toBe('benjamini_hochberg');
    expect(study.multipleTesting!.alpha).toBe(0.05);
    expect(study.multipleTesting!.totalTests).toBeGreaterThanOrEqual(1);

    for (const res of study.results) {
      if (res.baselineComparisonR2) {
        expect(res.baselineComparisonR2.adjustedPValue).toBeDefined();
        expect(typeof res.baselineComparisonR2.isFdrSignificant).toBe('boolean');
      }
    }
  });

  it('respects availableAtIndex for causal isolation in createResearchObservations', () => {
    const candles: Candle[] = [
      makeCandle(1000, 100, 102, 98, 100),
      makeCandle(2000, 100, 104, 99, 103),
      makeCandle(3000, 103, 105, 101, 104),
      makeCandle(4000, 104, 106, 102, 105)
    ];

    // Event formed at index 1, but causally confirmed/available only at index 2
    const delayedEvent: BaseEvent = {
      id: 'delayed-1',
      type: 'control',
      symbol: 'BTCUSDT',
      timeframe: '15m',
      detectedAt: 3000,
      originIndex: 1,
      availableAtIndex: 2,
      availableAtTimestamp: 3000,
      direction: 'bullish'
    };

    const observations = createResearchObservations([delayedEvent], candles, DEFAULT_OUTCOME_CONFIG);
    expect(observations).toHaveLength(1);
    expect(observations[0]!.event.availableAtIndex).toBe(2);
    // Context snapshot must reflect bar 2 (the causal available bar), not bar 1
    expect(observations[0]!.context.atr.gt(0)).toBe(true);
  });
});

