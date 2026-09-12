import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { detectWyckoffEvents } from '../src/wyckoff.js';
import { detectDoublePatterns } from '../src/patterns.js';
import { detectSwings } from '../src/swings.js';
import type { Candle, SwingPoint } from '../src/types.js';

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

describe('Wyckoff & Classical Chart Patterns', () => {
  it('detects Wyckoff Spring when support is pierced and closed back above', () => {
    const candles: Candle[] = [
      makeCandle(1000, 100, 105, 98, 102),
      makeCandle(2000, 102, 104, 95, 99),   // Candidate Swing Low at 95 (idx 1)
      makeCandle(3000, 99, 108, 97, 106),   // Confirms Swing Low at 95 (idx 2)
      makeCandle(4000, 106, 107, 93, 101)  // Pierces 95 to 93, closes at 101 => Spring (idx 3)
    ];

    const swings = detectSwings(candles, { leftBars: 1, rightBars: 1 });
    const events = detectWyckoffEvents(candles, swings, { symbol: 'ETHUSDT', timeframe: '15m' });

    expect(events).toHaveLength(1);
    const spring = events[0]!;
    expect(spring.wyckoffType).toBe('spring');
    expect(spring.direction).toBe('bullish');
    expect(spring.referenceLevel.toNumber()).toBe(95);
    expect(spring.extremePrice.toNumber()).toBe(93);
  });

  it('detects Double Bottom when two swing lows align within tolerance', () => {
    const swings: SwingPoint[] = [
      { id: '1', type: 'low', index: 5, timestamp: 1000, price: new Decimal(100), confirmedAtIndex: 7 },
      { id: '2', type: 'high', index: 12, timestamp: 2000, price: new Decimal(120), confirmedAtIndex: 14 },
      { id: '3', type: 'low', index: 20, timestamp: 3000, price: new Decimal(100.2), confirmedAtIndex: 22 }
    ];

    const patterns = detectDoublePatterns(swings, {
      symbol: 'ETHUSDT',
      timeframe: '15m',
      toleranceRatio: new Decimal(0.01)
    });

    expect(patterns).toHaveLength(1);
    const db = patterns[0]!;
    expect(db.patternType).toBe('double_bottom');
    expect(db.direction).toBe('bullish');
    expect(db.neckline.toNumber()).toBe(120);
  });
});
