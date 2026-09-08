import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { detectSwings } from '../src/swings.js';
import { detectStructureBreaks } from '../src/structure.js';
import { detectOrderBlocks } from '../src/order-block.js';
import { detectLiquiditySweeps } from '../src/liquidity.js';
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

describe('Deterministic Structure Engine', () => {
  it('detects swing high and swing low with left/right confirmation', () => {
    const candles: Candle[] = [
      makeCandle(1000, 100, 102, 98, 101),
      makeCandle(2000, 101, 108, 100, 107), // Swing High at 108
      makeCandle(3000, 107, 104, 96, 97),   // Swing Low at 96
      makeCandle(4000, 97, 105, 96.5, 103),
      makeCandle(5000, 103, 104, 100, 102)
    ];

    const swings = detectSwings(candles, { leftBars: 1, rightBars: 1 });
    expect(swings.some(s => s.type === 'high' && s.price.toNumber() === 108)).toBe(true);
    expect(swings.some(s => s.type === 'low' && s.price.toNumber() === 96)).toBe(true);
  });

  it('detects BOS and Order Block anchored to structural break', () => {
    const candles: Candle[] = [
      makeCandle(1000, 100, 105, 98, 102),
      makeCandle(2000, 102, 110, 101, 109), // Swing High at 110 (idx 1)
      makeCandle(3000, 109, 106, 95, 96),   // Swing Low / down candle at 95 (idx 2)
      makeCandle(4000, 96, 108, 96, 107),   // confirmed swing high (idx 3)
      makeCandle(5000, 107, 115, 106, 114)  // breaks 110 with close 114 (idx 4)
    ];

    const swings = detectSwings(candles, { leftBars: 1, rightBars: 1 });
    const breaks = detectStructureBreaks(candles, swings, { symbol: 'BTCUSDT', timeframe: '15m' });

    expect(breaks.length).toBeGreaterThanOrEqual(1);
    const bullBreak = breaks.find(b => b.direction === 'bullish');
    expect(bullBreak).toBeDefined();

    const obs = detectOrderBlocks(candles, breaks, { symbol: 'BTCUSDT', timeframe: '15m' });
    expect(obs.length).toBeGreaterThanOrEqual(1);
    const bullOb = obs.find(o => o.direction === 'bullish');
    expect(bullOb).toBeDefined();
    expect(bullOb?.originCandleIndex).toBe(2); // down-close candle at index 2
  });

  it('detects and deduplicates liquidity sweep when price pierces swing wick and closes inside', () => {
    const candles: Candle[] = [
      makeCandle(1000, 100, 105, 98, 102),
      makeCandle(2000, 102, 115, 101, 112), // Swing High 1 at 115
      makeCandle(3000, 112, 110, 102, 105), // Confirms swing high
      makeCandle(4000, 105, 117, 104, 113)  // Pierces 115 to 117, closes at 113 (reclaim BSL)
    ];

    const swings = detectSwings(candles, { leftBars: 1, rightBars: 1 });
    const sweeps = detectLiquiditySweeps(candles, swings, { symbol: 'BTCUSDT', timeframe: '15m' });

    expect(sweeps).toHaveLength(1);
    const sweep = sweeps[0]!;
    expect(sweep.targetType).toBe('bsl');
    expect(sweep.sweptLevel.toNumber()).toBe(115);
    expect(sweep.sweepExtreme.toNumber()).toBe(117);
    expect(sweep.reclaimed).toBe(true);
  });
});
