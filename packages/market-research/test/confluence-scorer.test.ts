import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { scoreConfluence } from '../src/confluence-scorer.js';
import type { BaseEvent } from '@nemesis-oss/market-events';

describe('Composite Confluence Scorer', () => {
  it('calculates weighted score based on present market events', () => {
    const events: BaseEvent[] = [
      {
        id: '1',
        symbol: 'BTCUSDT',
        timeframe: '15m',
        type: 'liquidity_sweep',
        direction: 'bullish',
        detectedAt: 1000,
        originIndex: 1
      } as any,
      {
        id: '2',
        symbol: 'BTCUSDT',
        timeframe: '15m',
        type: 'bos',
        direction: 'bullish',
        detectedAt: 2000,
        originIndex: 2
      } as any,
      {
        id: '3',
        symbol: 'BTCUSDT',
        timeframe: '15m',
        type: 'fvg',
        direction: 'bullish',
        detectedAt: 3000,
        originIndex: 3
      } as any
    ];

    const result = scoreConfluence('bullish', events);

    // sweep (25) + bos (20) + fvg (15) = 60
    expect(result.score).toBe(60);
    expect(result.totalWeight).toBe(100);
    expect(result.normalizedConfidence).toBe(0.6);
    expect(result.activeFactors).toContain('hasLiquiditySweep');
    expect(result.activeFactors).toContain('hasStructureBreak');
    expect(result.activeFactors).toContain('hasFvg');
  });

  it('returns zero confidence if no matching directional events exist', () => {
    const events: BaseEvent[] = [
      {
        id: '1',
        symbol: 'BTCUSDT',
        timeframe: '15m',
        type: 'fvg',
        direction: 'bearish',
        detectedAt: 1000,
        originIndex: 1
      } as any
    ];

    const result = scoreConfluence('bullish', events);
    expect(result.score).toBe(0);
    expect(result.normalizedConfidence).toBe(0);
    expect(result.activeFactors).toHaveLength(0);
  });
});
