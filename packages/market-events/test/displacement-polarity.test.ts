import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { detectDisplacement } from '../src/displacement.js';
import { detectBreakerBlocks, detectInvertedFvg } from '../src/polarity.js';
import type { Candle, OrderBlockEvent, FvgEvent } from '../src/types.js';

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

describe('Displacement & Polarity Inversions', () => {
  it('detects displacement candle when ATR expansion and body dominance are met', () => {
    const candles: Candle[] = [];
    // 14 normal consolidation bars (range 2 points)
    for (let i = 0; i < 14; i++) {
      candles.push(makeCandle(1000 + i * 60000, 100, 101, 99, 100.5));
    }
    // Bar 15: expansion of 10 points (close 110, open 100, high 110, low 99.8)
    candles.push(makeCandle(1000 + 14 * 60000, 100, 110, 99.8, 109.8));

    const displacements = detectDisplacement(candles, {
      symbol: 'BTCUSDT',
      timeframe: '15m',
      minMagnitudeAtr: new Decimal(1.5),
      minBodyRatio: new Decimal(0.7)
    });

    expect(displacements).toHaveLength(1);
    const disp = displacements[0]!;
    expect(disp.direction).toBe('bullish');
    expect(disp.magnitudeAtr.toNumber()).toBeGreaterThan(2);
  });

  it('detects Breaker Block when price closes through an Order Block', () => {
    const ob: OrderBlockEvent = {
      id: 'ob-1',
      type: 'order_block',
      symbol: 'BTCUSDT',
      timeframe: '15m',
      detectedAt: 2000,
      originIndex: 1,
      direction: 'bullish',
      top: new Decimal(105),
      bottom: new Decimal(100),
      size: new Decimal(5),
      originCandleIndex: 1
    };

    const candles: Candle[] = [
      makeCandle(1000, 100, 105, 95, 102),
      makeCandle(2000, 102, 106, 99, 104), // originIndex
      makeCandle(3000, 103, 104, 98, 97)   // Closes at 97 (< 100 bottom) => Bearish Breaker
    ];

    const breakers = detectBreakerBlocks(candles, [ob], { symbol: 'BTCUSDT', timeframe: '15m' });
    expect(breakers).toHaveLength(1);
    const breaker = breakers[0]!;
    expect(breaker.direction).toBe('bearish');
    expect(breaker.top.toNumber()).toBe(105);
    expect(breaker.bottom.toNumber()).toBe(100);
  });

  it('detects Inverted FVG (IFVG) when price closes through a Fair Value Gap', () => {
    const fvg: FvgEvent = {
      id: 'fvg-1',
      type: 'fvg',
      symbol: 'BTCUSDT',
      timeframe: '15m',
      detectedAt: 2000,
      originIndex: 1,
      direction: 'bullish',
      top: new Decimal(110),
      bottom: new Decimal(102),
      consequentEncroachment: new Decimal(106),
      size: new Decimal(8)
    };

    const candles: Candle[] = [
      makeCandle(1000, 100, 105, 95, 102),
      makeCandle(2000, 105, 115, 104, 112), // FVG formed
      makeCandle(3000, 112, 112, 99, 100)   // Closes at 100 (< 102 bottom) => Bearish IFVG
    ];

    const ifvgs = detectInvertedFvg(candles, [fvg], { symbol: 'BTCUSDT', timeframe: '15m' });
    expect(ifvgs).toHaveLength(1);
    const ifvg = ifvgs[0]!;
    expect(ifvg.direction).toBe('bearish');
    expect(ifvg.originalFvgId).toBe('fvg-1');
  });
});
