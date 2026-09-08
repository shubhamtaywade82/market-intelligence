import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { detectSwings, detectMultiScaleSwings } from '../src/swings.js';
import { detectStructureBreaks, detectBos, detectChoch, detectMss } from '../src/structure.js';
import { detectOrderBlocks } from '../src/order-block.js';
import { detectLiquiditySweeps, buildLiquidityPools } from '../src/liquidity.js';
import { validateEventCausality, type Candle, type SwingPoint } from '../src/types.js';

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
  it('detects swing high and swing low with multi-strength classification', () => {
    const candles: Candle[] = [
      makeCandle(1000, 100, 102, 98, 101),
      makeCandle(2000, 101, 108, 100, 107), // Swing High at 108
      makeCandle(3000, 107, 104, 96, 97),   // Swing Low at 96
      makeCandle(4000, 97, 105, 96.5, 103),
      makeCandle(5000, 103, 104, 100, 102)
    ];

    const swings = detectSwings(candles, { leftBars: 1, rightBars: 1, strength: 'micro' });
    expect(swings.some(s => s.type === 'high' && s.price.toNumber() === 108 && s.strength === 'micro')).toBe(true);
    expect(swings.some(s => s.type === 'low' && s.price.toNumber() === 96 && s.strength === 'micro')).toBe(true);

    const multi = detectMultiScaleSwings(candles);
    expect(multi.micro).toBeDefined();
    expect(multi.minor).toBeDefined();
  });

  it('builds liquidity pools identifying equal highs and clusters', () => {
    const swings: SwingPoint[] = [
      { id: 's1', type: 'high', index: 5, timestamp: 1000, price: new Decimal(100.05), confirmedAtIndex: 7, strength: 'minor' },
      { id: 's2', type: 'high', index: 15, timestamp: 2000, price: new Decimal(100.08), confirmedAtIndex: 17, strength: 'minor' }, // EQH (within 0.15%)
      { id: 's3', type: 'low', index: 10, timestamp: 1500, price: new Decimal(90.0), confirmedAtIndex: 12, strength: 'minor' }
    ];

    const pools = buildLiquidityPools(swings, 0.002);
    expect(pools.length).toBe(2);

    const eqhPool = pools.find(p => p.targetType === 'bsl');
    expect(eqhPool).toBeDefined();
    expect(eqhPool!.poolType).toBe('equal_highs');
    expect(eqhPool!.touchCount).toBe(2);

    const singleLowPool = pools.find(p => p.targetType === 'ssl');
    expect(singleLowPool).toBeDefined();
    expect(singleLowPool!.poolType).toBe('single_low');
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
    expect(bullOb?.originCandleIndex).toBe(2);
  });

  it('detects liquidity sweeps and links them to pool IDs with penetration tracking', () => {
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
    expect(sweep.poolId).toBeDefined();
    expect(sweep.penetrationTicks?.toNumber()).toBe(2);
  });

  it('discriminates BOS, CHoCH, and MSS with dedicated specialized detectors and versioning', () => {
    const candles: Candle[] = [
      makeCandle(1000, 100, 105, 98, 102),
      makeCandle(2000, 102, 110, 101, 109), // Swing High at 110 (idx 1)
      makeCandle(3000, 109, 106, 95, 96),   // Swing Low at 95 (idx 2)
      makeCandle(4000, 96, 108, 96, 107),   // confirmed swing high (idx 3)
      makeCandle(5000, 107, 115, 106, 114)  // breaks 110 with close 114 (idx 4)
    ];

    const swings = detectSwings(candles, { leftBars: 1, rightBars: 1 });
    const opts = { symbol: 'BTCUSDT', timeframe: '15m' as const };

    const allBreaks = detectStructureBreaks(candles, swings, opts);
    expect(allBreaks[0]?.version).toBe('1.0.0');

    const bosBreaks = detectBos(candles, swings, opts);
    const chochBreaks = detectChoch(candles, swings, opts);
    const mssBreaks = detectMss(candles, swings, opts);

    expect(bosBreaks.every(b => b.type === 'bos')).toBe(true);
    expect(chochBreaks.every(b => b.type === 'choch')).toBe(true);
    expect(mssBreaks.every(b => b.type === 'mss')).toBe(true);
  });

  it('enforces causal availability invariants (availableAtIndex >= originIndex) across detectors', () => {
    const candles: Candle[] = [
      makeCandle(1000, 100, 105, 98, 102),
      makeCandle(2000, 102, 110, 101, 109),
      makeCandle(3000, 109, 106, 95, 96),
      makeCandle(4000, 96, 108, 96, 107),
      makeCandle(5000, 107, 115, 106, 114)
    ];

    const swings = detectSwings(candles, { leftBars: 1, rightBars: 1 });
    const breaks = detectStructureBreaks(candles, swings, { symbol: 'BTCUSDT', timeframe: '15m' });
    const obs = detectOrderBlocks(candles, breaks, { symbol: 'BTCUSDT', timeframe: '15m' });
    const sweeps = detectLiquiditySweeps(candles, swings, { symbol: 'BTCUSDT', timeframe: '15m' });

    for (const ev of [...breaks, ...obs, ...sweeps]) {
      expect(() => validateEventCausality(ev)).not.toThrow();
      expect(ev.availableAtIndex).toBeGreaterThanOrEqual(ev.originIndex);
      expect(ev.availableAtTimestamp).toBeGreaterThanOrEqual(ev.originTimestamp);
    }
  });
});

