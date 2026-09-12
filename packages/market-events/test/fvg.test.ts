import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { detectFvg } from '../src/fvg.js';
import type { Candle } from '../src/types.js';

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

describe('detectFvg', () => {
  it('detects a bullish FVG when candle[2].low > candle[0].high', () => {
    const candles = [
      makeCandle(1000, 100, 105, 95, 102), // high = 105
      makeCandle(2000, 103, 120, 103, 118), // displacement
      makeCandle(3000, 118, 125, 110, 122)  // low = 110 (> 105)
    ];

    const events = detectFvg(candles, { symbol: 'ETHUSDT', timeframe: '15m' });
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.direction).toBe('bullish');
    expect(event.bottom.toNumber()).toBe(105);
    expect(event.top.toNumber()).toBe(110);
    expect(event.size.toNumber()).toBe(5);
    expect(event.consequentEncroachment.toNumber()).toBe(107.5);
  });

  it('detects a bearish FVG when candle[0].low > candle[2].high', () => {
    const candles = [
      makeCandle(1000, 120, 125, 115, 118), // low = 115
      makeCandle(2000, 117, 118, 98, 100),  // displacement down
      makeCandle(3000, 100, 108, 95, 104)   // high = 108 (< 115)
    ];

    const events = detectFvg(candles, { symbol: 'ETHUSDT', timeframe: '15m' });
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.direction).toBe('bearish');
    expect(event.top.toNumber()).toBe(115);
    expect(event.bottom.toNumber()).toBe(108);
    expect(event.size.toNumber()).toBe(7);
    expect(event.consequentEncroachment.toNumber()).toBe(111.5);
  });

  it('returns empty array if candles overlap without a gap', () => {
    const candles = [
      makeCandle(1000, 100, 105, 95, 102),
      makeCandle(2000, 102, 108, 100, 107),
      makeCandle(3000, 107, 110, 104, 109) // low 104 <= high 105
    ];

    const events = detectFvg(candles, { symbol: 'ETHUSDT', timeframe: '15m' });
    expect(events).toHaveLength(0);
  });
});
