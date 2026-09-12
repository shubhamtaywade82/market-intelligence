import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { evaluateFvgOutcome } from '../src/fvg-outcomes.js';
import type { Candle, FvgEvent } from '@nemesis-oss/market-events';

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

describe('evaluateFvgOutcome', () => {
  it('calculates penetration, MFE, MAE, and R-multiples for bullish FVG', () => {
    const fvg: FvgEvent = {
      id: 'test-bull-fvg',
      type: 'fvg',
      symbol: 'ETHUSDT',
      timeframe: '15m',
      detectedAt: 3000,
      originIndex: 2,
      originTimestamp: 3000,
      availableAtIndex: 2,
      availableAtTimestamp: 3000,
      direction: 'bullish',
      top: new Decimal(110),
      bottom: new Decimal(100),
      consequentEncroachment: new Decimal(105),
      size: new Decimal(10)
    };

    // Forward candles after index 2
    const candles: Candle[] = [
      makeCandle(1000, 95, 100, 90, 98),
      makeCandle(2000, 98, 115, 98, 112),
      makeCandle(3000, 112, 118, 110, 115), // FVG candle (index 2)
      // forward:
      makeCandle(4000, 115, 116, 104, 108), // dips to 104 (penetration 6 / 10 = 60%, touches 25% and 50%)
      makeCandle(5000, 108, 132, 107, 130)  // rallies to 132 (MFE = 132 - 110 = 22 => > 2R of 10)
    ];

    const outcome = evaluateFvgOutcome(candles, fvg, {
      horizonCandles: 2,
      atr: new Decimal(5)
    });

    expect(outcome.firstTouchIndex).toBe(3);
    expect(outcome.touch25).toBe(true);
    expect(outcome.touch50).toBe(true);
    expect(outcome.touch75).toBe(false);
    expect(outcome.fullFill).toBe(false);
    expect(outcome.mfe.toNumber()).toBe(22);
    expect(outcome.hit1R).toBe(true);
    expect(outcome.hit2R).toBe(true);
    expect(outcome.hit3R).toBe(false); // 22 < 30
    expect(outcome.mfeAtr.toNumber()).toBe(4.4); // 22 / 5
  });
});
