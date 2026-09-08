import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { detectHarmonicPatterns } from '../src/harmonics.js';
import type { SwingPoint } from '../src/types.js';

describe('Harmonic Patterns Engine', () => {
  it('detects a bullish Gartley pattern matching B=61.8% and D=78.6% retracements', () => {
    // X = 100, A = 200 (XA move = 100)
    // B retraces 61.8% of XA -> B = 200 - 61.8 = 138.2
    // C rallies to 170
    // D retraces 78.6% of XA -> D = 200 - 78.6 = 121.4 (PRZ zone)
    const swings: SwingPoint[] = [
      { id: 'x', type: 'low', index: 5, timestamp: 1000, price: new Decimal(100), confirmedAtIndex: 7 },
      { id: 'a', type: 'high', index: 12, timestamp: 2000, price: new Decimal(200), confirmedAtIndex: 14 },
      { id: 'b', type: 'low', index: 18, timestamp: 3000, price: new Decimal(138.2), confirmedAtIndex: 20 },
      { id: 'c', type: 'high', index: 24, timestamp: 4000, price: new Decimal(170), confirmedAtIndex: 26 },
      { id: 'd', type: 'low', index: 30, timestamp: 5000, price: new Decimal(121.4), confirmedAtIndex: 32 }
    ];

    const harmonics = detectHarmonicPatterns(swings, { symbol: 'BTCUSDT', timeframe: '1h' });
    expect(harmonics).toHaveLength(1);
    const h = harmonics[0]!;
    expect(h.type).toBe('harmonic_pattern');
    expect(h.harmonicType).toBe('gartley');
    expect(h.direction).toBe('bullish');
    expect(h.prz.top.toNumber()).toBeGreaterThan(121.4);
    expect(h.prz.bottom.toNumber()).toBeLessThan(121.4);
  });
});
