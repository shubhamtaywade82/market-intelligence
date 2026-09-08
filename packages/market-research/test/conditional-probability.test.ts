import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { calculateConditionalEdge } from '../src/conditional-probability.js';
import type { EventWithOutcome } from '../src/conditional-probability.js';

describe('Empirical Conditional Probability Engine', () => {
  it('calculates observed base rate, conditioned rate, and uplift', () => {
    const observations: EventWithOutcome[] = [
      {
        event: { id: '1', type: 'fvg', symbol: 'BTC', timeframe: '15m', detectedAt: 1, originIndex: 1, direction: 'bullish' },
        outcome: { eventId: '1', horizonCandles: 24, mfe: new Decimal(10), mae: new Decimal(2), mfeAtr: new Decimal(2), maeAtr: new Decimal(0.4), hit1R: true, hit2R: true, hit3R: false }
      },
      {
        event: { id: '2', type: 'fvg', symbol: 'BTC', timeframe: '15m', detectedAt: 2, originIndex: 2, direction: 'bullish' },
        outcome: { eventId: '2', horizonCandles: 24, mfe: new Decimal(5), mae: new Decimal(4), mfeAtr: new Decimal(1), maeAtr: new Decimal(0.8), hit1R: true, hit2R: false, hit3R: false }
      },
      {
        event: { id: '3', type: 'fvg', symbol: 'BTC', timeframe: '15m', detectedAt: 3, originIndex: 3, direction: 'bullish' },
        outcome: { eventId: '3', horizonCandles: 24, mfe: new Decimal(4), mae: new Decimal(6), mfeAtr: new Decimal(0.8), maeAtr: new Decimal(1.2), hit1R: false, hit2R: false, hit3R: false }
      }
    ];

    // Base rate: 1 of 3 hit 2R = 33.3%
    // Condition: only event id '1' (which hit 2R) -> 100%
    const edge = calculateConditionalEdge(observations, obs => obs.event.id === '1', 'hit2R');

    expect(edge.baseProbability).toBeCloseTo(0.333, 2);
    expect(edge.conditionedProbability).toBe(1.0);
    expect(edge.uplift).toBeCloseTo(0.667, 2);
    expect(edge.sampleSize).toBe(1);
  });
});
