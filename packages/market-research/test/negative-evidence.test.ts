import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import type { BaseEvent } from '@nemesis-oss/market-events';
import type { BaseOutcome, ResearchObservation } from '../src/types.js';
import {
  checkHtfConflict,
  checkEarlyFailure,
  classifyNegativeEvidence,
  evaluateNegativeEvidenceImpact
} from '../src/negative-evidence.js';

function makeObservationWithHtf(overrides: {
  eventDirection: 'bullish' | 'bearish';
  htfTrend1h?: 'bullish' | 'bearish' | 'sideways';
  firstHit?: 'target_first' | 'stop_first';
  timeToFirstHitBars?: number;
  hit2R?: boolean;
}): ResearchObservation {
  const event: BaseEvent = {
    id: 'ev-test',
    type: 'fvg',
    symbol: 'BTCUSDT',
    timeframe: '15m',
    detectedAt: 1000,
    originIndex: 10,
    direction: overrides.eventDirection
  };

  const outcome: BaseOutcome = {
    eventId: 'ev-test',
    horizonCandles: 24,
    mfe: new Decimal(20),
    mae: new Decimal(5),
    mfeAtr: new Decimal(2.5),
    maeAtr: new Decimal(0.5),
    targetHitR: new Decimal(overrides.hit2R ? 2 : -1),
    realizedR: new Decimal(overrides.hit2R ? 2 : -1),
    firstHit: overrides.firstHit ?? (overrides.hit2R ? 'target_first' : 'stop_first'),
    timeToFirstHitBars: overrides.timeToFirstHitBars ?? 4,
    isAmbiguous: false,
    hit1R: overrides.hit2R ?? true,
    hit2R: overrides.hit2R ?? true,
    hit3R: false
  };

  return {
    event,
    context: {
      atr: new Decimal(10),
      trendRegime: overrides.eventDirection,
      volatilityRegime: 'normal',
      ...(overrides.htfTrend1h ? {
        htfContext: {
          '1h': {
            timeframe: '1h',
            causalCandleCount: 10,
            lastCompletedTimestamp: 900,
            causalAtr: new Decimal(15),
            trend: overrides.htfTrend1h,
            lastClose: new Decimal(100)
          }
        }
      } : {})
    },
    outcome,
    provenance: {
      datasetId: 'BTCUSDT-15m',
      datasetHash: 'abc',
      detectorId: 'fvg',
      detectorVersion: '1.0.0',
      detectorConfigHash: 'def',
      outcomeVersion: '1.0.0'
    }
  };
}

describe('Negative Evidence Evaluation', () => {
  it('detects higher-timeframe directional conflict', () => {
    const conflictedObs = makeObservationWithHtf({ eventDirection: 'bullish', htfTrend1h: 'bearish' });
    const alignedObs = makeObservationWithHtf({ eventDirection: 'bullish', htfTrend1h: 'bullish' });
    const neutralObs = makeObservationWithHtf({ eventDirection: 'bullish', htfTrend1h: 'sideways' });

    expect(checkHtfConflict(conflictedObs, '1h')).toBe(true);
    expect(checkHtfConflict(alignedObs, '1h')).toBe(false);
    expect(checkHtfConflict(neutralObs, '1h')).toBe(false);
  });

  it('detects early invalidation / fast stop hits within threshold', () => {
    const fastFail = makeObservationWithHtf({ eventDirection: 'bullish', firstHit: 'stop_first', timeToFirstHitBars: 2 });
    const slowFail = makeObservationWithHtf({ eventDirection: 'bullish', firstHit: 'stop_first', timeToFirstHitBars: 8 });
    const targetHit = makeObservationWithHtf({ eventDirection: 'bullish', firstHit: 'target_first', timeToFirstHitBars: 2 });

    expect(checkEarlyFailure(fastFail, 3)).toBe(true);
    expect(checkEarlyFailure(slowFail, 3)).toBe(false);
    expect(checkEarlyFailure(targetHit, 3)).toBe(false);
  });

  it('classifies full negative evidence flags for an observation', () => {
    const obs = makeObservationWithHtf({
      eventDirection: 'bullish',
      htfTrend1h: 'bearish',
      firstHit: 'stop_first',
      timeToFirstHitBars: 1
    });

    const flags = classifyNegativeEvidence(obs, '1h', 3);
    expect(flags.hasHtfConflict).toBe(true);
    expect(flags.isEarlyFailure).toBe(true);
  });

  it('evaluates statistical degradation caused by negative evidence', () => {
    const dataset = [
      makeObservationWithHtf({ eventDirection: 'bullish', htfTrend1h: 'bullish', hit2R: true }),
      makeObservationWithHtf({ eventDirection: 'bullish', htfTrend1h: 'bullish', hit2R: true }),
      makeObservationWithHtf({ eventDirection: 'bullish', htfTrend1h: 'bearish', hit2R: false, firstHit: 'stop_first', timeToFirstHitBars: 2 }),
      makeObservationWithHtf({ eventDirection: 'bullish', htfTrend1h: 'bearish', hit2R: false, firstHit: 'stop_first', timeToFirstHitBars: 2 })
    ];

    const impact = evaluateNegativeEvidenceImpact(dataset, '1h');
    expect(impact.sampleSize).toBe(4);
    expect(impact.alignedCount).toBe(2);
    expect(impact.conflictedCount).toBe(2);
    expect(impact.alignedHitRateR2).toBe(1.0);  // 100% when aligned
    expect(impact.conflictedHitRateR2).toBe(0.0); // 0% when conflicted
    expect(impact.conflictPenalty).toBe(-1.0);   // -100% degradation
    expect(impact.earlyFailureRate).toBe(0.5);    // 2 of 4 failed fast
    expect(impact.netEvidenceScore).toBe(0);      // (2 - 2) / 4 = 0
  });
});
