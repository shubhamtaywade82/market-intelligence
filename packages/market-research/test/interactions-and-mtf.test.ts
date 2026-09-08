import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import type { Candle, BaseEvent } from '@nemesis-oss/market-events';
import { getCausalHtfCandles, extractCausalHtfContext } from '../src/multi-timeframe.js';
import { analyzeEventPairInteraction } from '../src/interactions.js';
import { computeTimeToEventProfile } from '../src/time-to-event.js';
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
      { event: { id: 'fvg-1', type: 'fvg', symbol: 'BTC', timeframe: '15m' as const, detectedAt: 1000, originIndex: 10, direction: 'bullish' as const }, outcome: baseOutcomeSuccess },
      { event: { id: 'fvg-2', type: 'fvg', symbol: 'BTC', timeframe: '15m' as const, detectedAt: 2000, originIndex: 20, direction: 'bullish' as const }, outcome: baseOutcomeFail }
    ];

    const obsB = [
      // Co-occurs with fvg-1 at index 11 (gap = 1 <= 3)
      { event: { id: 'mss-1', type: 'mss', symbol: 'BTC', timeframe: '15m' as const, detectedAt: 1100, originIndex: 11, direction: 'bullish' as const }, outcome: baseOutcomeSuccess }
    ];

    const interaction = analyzeEventPairInteraction(obsA, obsB, 'hit2R', 3);
    expect(interaction.sampleSizeCombined).toBe(1);
    expect(interaction.probCombined).toBe(1.0); // 100% when both occur
    expect(interaction.probPrimary).toBe(0.5);  // 50% when solo FVG
    expect(interaction.interactionUplift).toBe(0.0); // 1.0 - max(0.5, 1.0) = 0.0
    expect(interaction.incrementalContributionPrimary).toBe(0.0);
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
    // At bar 5: both have been touched (0 survival)
    expect(profile.survivalCurve[4]!.survivalRate).toBe(0.0);
  });
});
