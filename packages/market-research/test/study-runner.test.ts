import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { runFvgStudy } from '../src/study-runner.js';
import { extractContextFeatures } from '../src/context-features.js';
import { detectSwings, detectStructureBreaks } from '@nemesis-oss/market-events';
import type { Candle } from '@nemesis-oss/market-events';

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

describe('Study Runner & Context Features', () => {
  it('computes aggregated statistical profile for FVGs across candle series', () => {
    const candles: Candle[] = [
      makeCandle(1000, 100, 105, 95, 102),
      makeCandle(2000, 102, 120, 101, 118), // Bullish FVG formed
      makeCandle(3000, 118, 125, 110, 122), // candle[2].low (110) > candle[0].high (105)
      makeCandle(4000, 122, 124, 107, 115), // retests into FVG (107 <= 110)
      makeCandle(5000, 115, 135, 114, 134)  // expansion to 135 (+20 points)
    ];

    const study = runFvgStudy(candles, {
      symbol: 'BTCUSDT',
      timeframe: '15m',
      horizonCandles: 3
    });

    expect(study.sampleSize).toBe(1);
    expect(study.retestProbability).toBe(1.0);
    expect(study.fill50Rate).toBe(1.0); // 110 - 107 = 3 / 5 = 60% > 50%
    expect(study.hitRates.r1).toBe(1.0);
    expect(study.hitRates.r2).toBe(1.0);
    expect(study.medianMfeAtr).toBeGreaterThan(0);
  });

  it('extracts volatility and trend regime context correctly', () => {
    const candles: Candle[] = [
      makeCandle(1000, 100, 102, 98, 101),
      makeCandle(2000, 101, 108, 100, 107),
      makeCandle(3000, 107, 104, 96, 97),
      makeCandle(4000, 97, 115, 97, 114) // large range breakout candle
    ];

    const swings = detectSwings(candles, { leftBars: 1, rightBars: 1 });
    const breaks = detectStructureBreaks(candles, swings, { symbol: 'BTCUSDT', timeframe: '15m' });
    const context = extractContextFeatures(candles, 3, swings, breaks);

    expect(context.displacementAtr.toNumber()).toBeGreaterThan(1);
    expect(['low', 'normal', 'high']).toContain(context.volatilityRegime);
  });
});
