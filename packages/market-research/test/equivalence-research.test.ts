import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { mapToCanonicalEquivalence, testOutcomeEquivalence } from '../src/equivalence-research.js';
import type { MarketEvent } from '@nemesis-oss/market-events';
import type { BaseOutcome, ResearchObservation } from '../src/types.js';

function makeObservation(id: string, hit2R: boolean): ResearchObservation {
  const outcome: BaseOutcome = {
    eventId: id,
    horizonCandles: 24,
    mfe: new Decimal(20),
    mae: new Decimal(5),
    mfeAtr: new Decimal(2.5),
    maeAtr: new Decimal(0.5),
    targetHitR: new Decimal(hit2R ? 2 : -1),
    realizedR: new Decimal(hit2R ? 2 : -1),
    firstHit: hit2R ? 'target_first' : 'stop_first',
    timeToFirstHitBars: 4,
    isAmbiguous: false,
    hit1R: hit2R,
    hit2R,
    hit3R: false
  };

  return {
    event: {
      id,
      type: 'fvg',
      symbol: 'BTCUSDT',
      timeframe: '15m',
      detectedAt: 1000,
      originIndex: 10,
      direction: 'bullish'
    },
    context: {
      atr: new Decimal(10),
      trendRegime: 'bullish',
      volatilityRegime: 'normal'
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

describe('Equivalence Research Engine', () => {
  it('identifies canonical FAILED_DOWNSIDE_AUCTION across concurrent SMC, Wyckoff, and VSA labels', () => {
    const ts = 1000;
    const events: MarketEvent[] = [
      {
        id: 'sweep-1',
        type: 'liquidity_sweep',
        symbol: 'BTCUSDT',
        timeframe: '15m',
        detectedAt: ts,
        originIndex: 10,
        direction: 'bullish',
        sweptLevel: new Decimal(100),
        sweepExtreme: new Decimal(98),
        targetType: 'ssl',
        reclaimed: true
      },
      {
        id: 'spring-1',
        type: 'wyckoff',
        symbol: 'BTCUSDT',
        timeframe: '15m',
        detectedAt: ts,
        originIndex: 10,
        direction: 'bullish',
        wyckoffType: 'spring',
        referenceLevel: new Decimal(100),
        extremePrice: new Decimal(98)
      },
      {
        id: 'vsa-1',
        type: 'vsa',
        symbol: 'BTCUSDT',
        timeframe: '15m',
        detectedAt: ts,
        originIndex: 10,
        direction: 'bullish',
        vsaType: 'stopping_volume',
        volumeRatio: new Decimal(2.5),
        spreadRatio: new Decimal(0.8)
      }
    ];

    const mappings = mapToCanonicalEquivalence(events);
    expect(mappings).toHaveLength(1);
    const m = mappings[0]!;
    expect(m.canonicalType).toBe('FAILED_DOWNSIDE_AUCTION');
    expect(m.representations).toContain('SMC_SWEEP');
    expect(m.representations).toContain('WYCKOFF_SPRING');
    expect(m.representations).toContain('VSA_STOPPING_VOLUME');
  });

  it('tests behavioral equivalence based on outcome distributions', () => {
    // Group A: 250 hits out of 500 (50%)
    const groupA: ResearchObservation[] = [];
    for (let i = 0; i < 500; i++) groupA.push(makeObservation(`a-${i}`, i < 250));

    // Group B: 255 hits out of 500 (51%) - rigorously equivalent within 8% margin via TOST
    const groupB: ResearchObservation[] = [];
    for (let i = 0; i < 500; i++) groupB.push(makeObservation(`b-${i}`, i < 255));

    // Group C: 450 hits out of 500 (90%) - significantly non-equivalent
    const groupC: ResearchObservation[] = [];
    for (let i = 0; i < 500; i++) groupC.push(makeObservation(`c-${i}`, i < 450));

    const equivResult = testOutcomeEquivalence(groupA, groupB, 'hit2R', 0.08);
    expect(equivResult.hitRateA).toBe(0.5);
    expect(equivResult.hitRateB).toBe(0.51);
    expect(equivResult.absoluteDifference).toBeCloseTo(0.01, 4);
    expect(equivResult.tostPValue).toBeLessThan(0.05);
    expect(equivResult.isBehaviorallyEquivalent).toBe(true);
    expect(equivResult.confidenceInterval90.lower).toBeGreaterThan(-0.08);
    expect(equivResult.confidenceInterval90.upper).toBeLessThan(0.08);

    const nonEquivResult = testOutcomeEquivalence(groupA, groupC, 'hit2R', 0.08);
    expect(nonEquivResult.absoluteDifference).toBeCloseTo(0.40, 4);
    expect(nonEquivResult.isBehaviorallyEquivalent).toBe(false);
    expect(nonEquivResult.tostPValue).toBeGreaterThan(0.05);
  });
});

