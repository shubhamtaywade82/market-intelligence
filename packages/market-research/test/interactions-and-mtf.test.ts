import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import type { Candle, BaseEvent } from '@nemesis-oss/market-events';
import { getCausalHtfCandles, extractCausalHtfContext, extractMultiTimeframeSnapshot } from '../src/multi-timeframe.js';
import {
  analyzeEventPairInteraction,
  analyzeAnchorInteraction,
  calculateBinaryEntropy,
  calculateConditionalOddsRatio,
  calculateInformationGain
} from '../src/interactions.js';
import { computeTimeToEventProfile, computeOutcomeDistribution } from '../src/time-to-event.js';
import type { BaseOutcome, FvgOutcome } from '../src/types.js';

function makeCandle(ts: number, close: number): Candle {
  return {
    timestamp: ts,
    open: new Decimal(close - 1),
    high: new Decimal(close + 2),
    low: new Decimal(close - 2),
    close: new Decimal(close),
    volume: new Decimal(100)
  };
}

describe('Causal Multi-Timeframe Isolation', () => {
  it('excludes uncompleted HTF candles strictly based on timeframe duration', () => {
    // 1h candles: duration = 3,600,000 ms
    const htfCandles: Candle[] = [
      makeCandle(0, 100),         // completes at 3,600,000
      makeCandle(3600000, 105),   // completes at 7,200,000
      makeCandle(7200000, 110)    // completes at 10,800,000
    ];

    // Event on 5m occurs at t = 5,000,000 (candle 1 is completed, candle 2 is still in progress!)
    const eventTime = 5000000;
    const causal = getCausalHtfCandles(htfCandles, eventTime, '1h');

    expect(causal).toHaveLength(1);
    expect(causal[0]!.timestamp).toBe(0);

    // Event at t = 7,200,000 (candle 2 is now completed)
    const causalAt7200 = getCausalHtfCandles(htfCandles, 7200000, '1h');
    expect(causalAt7200).toHaveLength(2);
  });

  it('extracts causal HTF trend regime without future data leakage', () => {
    const htfCandles: Candle[] = [];
    for (let i = 0; i < 10; i++) {
      htfCandles.push(makeCandle(i * 3600000, 100 + i * 5));
    }

    const context = extractCausalHtfContext(htfCandles, 8 * 3600000, '1h');
    expect(context).toBeDefined();
    expect(context!.trend).toBe('bullish');
    expect(context!.causalCandleCount).toBe(8);
  });
});

describe('Event Interaction & Incremental Information', () => {
  it('computes interaction uplift and redundancy between co-occurring events', () => {
    const baseOutcomeSuccess: BaseOutcome = {
      eventId: '1', horizonCandles: 24, mfe: new Decimal(20), mae: new Decimal(5),
      mfeAtr: new Decimal(2.5), maeAtr: new Decimal(0.6), realizedR: new Decimal(2),
      firstHit: 'target_first', timeToFirstHitBars: 4, isAmbiguous: false,
      hit1R: true, hit2R: true, hit3R: false
    };

    const baseOutcomeFail: BaseOutcome = {
      ...baseOutcomeSuccess,
      mfe: new Decimal(5), mfeAtr: new Decimal(0.6), realizedR: new Decimal(-1),
      firstHit: 'stop_first', hit2R: false
    };

    const obsA = [
      { event: { id: 'fvg-1', type: 'fvg', symbol: 'BTC', timeframe: '15m' as const, detectedAt: 1000, originIndex: 10, originTimestamp: 1000, availableAtIndex: 10, availableAtTimestamp: 1000, direction: 'bullish' as const }, outcome: baseOutcomeSuccess },
      { event: { id: 'fvg-2', type: 'fvg', symbol: 'BTC', timeframe: '15m' as const, detectedAt: 2000, originIndex: 20, originTimestamp: 2000, availableAtIndex: 20, availableAtTimestamp: 2000, direction: 'bullish' as const }, outcome: baseOutcomeFail }
    ];

    const obsB = [
      // Co-occurs with fvg-1 at index 11 (gap = 1 <= 3)
      { event: { id: 'mss-1', type: 'mss', symbol: 'BTC', timeframe: '15m' as const, detectedAt: 1100, originIndex: 11, originTimestamp: 1100, availableAtIndex: 11, availableAtTimestamp: 1100, direction: 'bullish' as const }, outcome: baseOutcomeSuccess }
    ];

    const interaction = analyzeEventPairInteraction(obsA, obsB, 'hit2R', 3);
    expect(interaction.sampleSizeCombined).toBe(1);
    expect(interaction.probCombined).toBe(1.0); // 100% when both occur
    expect(interaction.probPrimary).toBe(0.5);  // 50% when solo FVG
    expect(interaction.interactionUplift).toBe(0.0); // 1.0 - max(0.5, 1.0) = 0.0
    expect(interaction.incrementalContributionPrimary).toBe(0.0);
  });

  it('performs anchor-based conditional opportunity matching with P(Y|A,B) and P(Y|A,!B)', () => {
    const success: BaseOutcome = {
      eventId: '1', horizonCandles: 10, mfe: new Decimal(20), mae: new Decimal(2),
      mfeAtr: new Decimal(2), maeAtr: new Decimal(0.2), realizedR: new Decimal(2),
      firstHit: 'target_first', timeToFirstHitBars: 2, isAmbiguous: false,
      hit1R: true, hit2R: true, hit3R: false
    };
    const fail: BaseOutcome = {
      ...success,
      mfe: new Decimal(2), mfeAtr: new Decimal(0.2), realizedR: new Decimal(-1),
      firstHit: 'stop_first', hit1R: false, hit2R: false
    };

    // 4 anchor opportunities: 2 with secondary condition (both win), 2 without secondary condition (1 win, 1 loss)
    const anchorObs = [
      { event: { id: 'a1', type: 'fvg', symbol: 'BTC', timeframe: '15m' as const, detectedAt: 1000, originIndex: 10, originTimestamp: 1000, availableAtIndex: 10, availableAtTimestamp: 1000, direction: 'bullish' as const }, outcome: success },
      { event: { id: 'a2', type: 'fvg', symbol: 'BTC', timeframe: '15m' as const, detectedAt: 2000, originIndex: 20, originTimestamp: 2000, availableAtIndex: 20, availableAtTimestamp: 2000, direction: 'bullish' as const }, outcome: success },
      { event: { id: 'a3', type: 'fvg', symbol: 'BTC', timeframe: '15m' as const, detectedAt: 3000, originIndex: 30, originTimestamp: 3000, availableAtIndex: 30, availableAtTimestamp: 3000, direction: 'bullish' as const }, outcome: success },
      { event: { id: 'a4', type: 'fvg', symbol: 'BTC', timeframe: '15m' as const, detectedAt: 4000, originIndex: 40, originTimestamp: 4000, availableAtIndex: 40, availableAtTimestamp: 4000, direction: 'bullish' as const }, outcome: fail }
    ];

    // Secondary events co-occur with a1 and a2
    const secondaryEvents: BaseEvent[] = [
      { id: 's1', type: 'bos', symbol: 'BTC', timeframe: '15m' as const, detectedAt: 950, originIndex: 9, originTimestamp: 950, availableAtIndex: 9, availableAtTimestamp: 950, direction: 'bullish' as const },
      { id: 's2', type: 'bos', symbol: 'BTC', timeframe: '15m' as const, detectedAt: 1950, originIndex: 19, originTimestamp: 1950, availableAtIndex: 19, availableAtTimestamp: 1950, direction: 'bullish' as const }
    ];

    const result = analyzeAnchorInteraction(anchorObs, secondaryEvents, { maxBarGap: 2, targetMetric: 'hit2R' });
    expect(result.sampleSizeAnchor).toBe(4);
    expect(result.sampleSizeWithSecondary).toBe(2);
    expect(result.sampleSizeWithoutSecondary).toBe(2);
    expect(result.probAnchor).toBe(0.75); // 3 of 4
    expect(result.probWithSecondary).toBe(1.0); // 2 of 2
    expect(result.probWithoutSecondary).toBe(0.5); // 1 of 2
    expect(result.conditionalUplift).toBe(0.5); // 1.0 - 0.5 = +0.5
    expect(result.relativeConditionalUplift).toBe(1.0); // (1.0 - 0.5) / 0.5 = 100%
    expect(result.conditionalOddsRatio).toBeGreaterThan(1.0);
    expect(result.informationGain).toBeGreaterThan(0);
    expect(result.coOccurrenceRate).toBe(0.5);
  });

  it('calculates information theoretic binary entropy and conditional odds ratio accurately', () => {
    expect(calculateBinaryEntropy(0)).toBe(0);
    expect(calculateBinaryEntropy(1)).toBe(0);
    expect(calculateBinaryEntropy(0.5)).toBe(1.0);

    // Odds ratio with Haldane-Anscombe correction
    const odds = calculateConditionalOddsRatio(10, 10, 5, 10);
    expect(odds).toBeGreaterThan(1.0);

    const ig = calculateInformationGain(0.5, 0.9, 0.1, 0.5);
    expect(ig).toBeGreaterThan(0.4);
  });
});

describe('Time-to-Event Survival Analysis', () => {
  it('computes empirical survival curve and median time to touch/target', () => {
    const outcomes: FvgOutcome[] = [
      {
        eventId: 'f-1', horizonCandles: 10, mfe: new Decimal(10), mae: new Decimal(2),
        mfeAtr: new Decimal(2), maeAtr: new Decimal(0.4), realizedR: new Decimal(2),
        firstHit: 'target_first', timeToFirstHitBars: 3, isAmbiguous: false,
        hit1R: true, hit2R: true, hit3R: false, firstTouchBars: 2, firstTouchIndex: 12,
        fill25: true, fill50: true, fill75: false, fill100: false,
        touch25: true, touch50: true, touch75: false, fullFill: false,
        isMitigated: true, isInvalidated: false
      },
      {
        eventId: 'f-2', horizonCandles: 10, mfe: new Decimal(15), mae: new Decimal(1),
        mfeAtr: new Decimal(3), maeAtr: new Decimal(0.2), realizedR: new Decimal(2),
        firstHit: 'target_first', timeToFirstHitBars: 5, isAmbiguous: false,
        hit1R: true, hit2R: true, hit3R: false, firstTouchBars: 4, firstTouchIndex: 24,
        fill25: true, fill50: false, fill75: false, fill100: false,
        touch25: true, touch50: false, touch75: false, fullFill: false,
        isMitigated: true, isInvalidated: false
      }
    ];

    const profile = computeTimeToEventProfile(outcomes, 10);
    expect(profile.sampleSize).toBe(2);
    expect(profile.medianBarsToTouch).toBe(4);
    expect(profile.survivalCurve).toHaveLength(10);
    // At bar 1: both survive unmitigated (first touches are at 2 and 4)
    expect(profile.survivalCurve[0]!.survivalRate).toBe(1.0);
    expect(profile.survivalCurve[0]!.cumulativeTargetRate).toBe(0.0);
    expect(profile.survivalCurve[0]!.cumulativeStopRate).toBe(0.0);
    expect(profile.survivalCurve[0]!.cumulativeNeitherRate).toBe(1.0);
    // At bar 3: f-1 has hit target (timeToFirstHitBars = 3) -> 1 of 2 = 0.5
    expect(profile.survivalCurve[2]!.cumulativeTargetRate).toBe(0.5);
    expect(profile.survivalCurve[2]!.cumulativeNeitherRate).toBe(0.5);
    // At bar 5: both have been touched (0 survival)
    expect(profile.survivalCurve[4]!.survivalRate).toBe(0.0);
    expect(profile.survivalCurve[4]!.cumulativeTargetRate).toBe(1.0);
    expect(profile.survivalCurve[4]!.cumulativeNeitherRate).toBe(0.0);
  });

  it('computes non-parametric empirical excursion quantiles and threshold distributions', () => {
    const outcomes: BaseOutcome[] = [
      {
        eventId: '1', horizonCandles: 10, mfe: new Decimal(10), mae: new Decimal(2),
        mfeAtr: new Decimal(1.0), maeAtr: new Decimal(0.2), realizedR: new Decimal(1),
        targetHitR: new Decimal(1), firstHit: 'target_first', timeToFirstHitBars: 2,
        isAmbiguous: false, hit1R: true, hit2R: false, hit3R: false
      },
      {
        eventId: '2', horizonCandles: 10, mfe: new Decimal(20), mae: new Decimal(4),
        mfeAtr: new Decimal(2.5), maeAtr: new Decimal(0.8), realizedR: new Decimal(2),
        targetHitR: new Decimal(2), firstHit: 'target_first', timeToFirstHitBars: 4,
        isAmbiguous: false, hit1R: true, hit2R: true, hit3R: false
      },
      {
        eventId: '3', horizonCandles: 10, mfe: new Decimal(35), mae: new Decimal(1),
        mfeAtr: new Decimal(4.0), maeAtr: new Decimal(0.1), realizedR: new Decimal(3),
        targetHitR: new Decimal(3), firstHit: 'target_first', timeToFirstHitBars: 5,
        isAmbiguous: false, hit1R: true, hit2R: true, hit3R: true
      }
    ];

    const dist = computeOutcomeDistribution(outcomes, [1.0, 2.0, 3.0]);
    expect(dist.sampleSize).toBe(3);
    expect(dist.mfeAtrQuantiles).toBeDefined();
    expect(dist.mfeAtrQuantiles!.p50).toBe(2.5); // median of [1.0, 2.5, 4.0]
    expect(dist.mfeDistribution).toHaveLength(3);
    expect(dist.mfeDistribution[0]!.thresholdAtr).toBe(1.0);
    expect(dist.mfeDistribution[0]!.probabilityExceeding).toBe(1.0); // 3 of 3 >= 1.0
    expect(dist.mfeDistribution[1]!.thresholdAtr).toBe(2.0);
    expect(dist.mfeDistribution[1]!.probabilityExceeding).toBeCloseTo(2 / 3, 2); // 2 of 3 >= 2.0
  });

  it('extractMultiTimeframeSnapshot aggregates causal snapshots across timeframes', () => {
    const htf1h: Candle[] = [];
    const htf4h: Candle[] = [];
    for (let i = 0; i < 10; i++) {
      htf1h.push(makeCandle(i * 3600000, 100 + i * 5));
      htf4h.push(makeCandle(i * 14400000, 100 + i * 20));
    }

    const multiSnap = extractMultiTimeframeSnapshot(
      { '1h': htf1h, '4h': htf4h },
      8 * 3600000
    );

    expect(multiSnap['1h']).toBeDefined();
    expect(multiSnap['1h']!.trend).toBe('bullish');
    expect(multiSnap['4h']).toBeDefined();
    expect(multiSnap['4h']!.timeframe).toBe('4h');
  });
});

