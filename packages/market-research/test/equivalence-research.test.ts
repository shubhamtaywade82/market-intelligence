import { describe, expect, it } from 'vitest';
import { mapToCanonicalEquivalence } from '../src/equivalence-research.js';
import type { BaseEvent } from '@nemesis-oss/market-events';

describe('Equivalence Research Engine', () => {
  it('identifies canonical FAILED_DOWNSIDE_AUCTION across concurrent SMC, Wyckoff, and VSA labels', () => {
    const ts = 1000;
    const events: BaseEvent[] = [
      {
        id: 'sweep-1',
        type: 'liquidity_sweep',
        symbol: 'BTCUSDT',
        timeframe: '15m',
        detectedAt: ts,
        originIndex: 10,
        direction: 'bullish',
        targetType: 'ssl'
      } as any,
      {
        id: 'spring-1',
        type: 'wyckoff',
        symbol: 'BTCUSDT',
        timeframe: '15m',
        detectedAt: ts,
        originIndex: 10,
        direction: 'bullish',
        wyckoffType: 'spring'
      } as any,
      {
        id: 'vsa-1',
        type: 'vsa',
        symbol: 'BTCUSDT',
        timeframe: '15m',
        detectedAt: ts,
        originIndex: 10,
        direction: 'bullish',
        vsaType: 'stopping_volume'
      } as any
    ];

    const mappings = mapToCanonicalEquivalence(events);
    expect(mappings).toHaveLength(1);
    const m = mappings[0]!;
    expect(m.canonicalType).toBe('FAILED_DOWNSIDE_AUCTION');
    expect(m.representations).toContain('SMC_SWEEP');
    expect(m.representations).toContain('WYCKOFF_SPRING');
    expect(m.representations).toContain('VSA_STOPPING_VOLUME');
  });
});
