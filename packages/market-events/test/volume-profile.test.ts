import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { calculateVolumeProfile } from '../src/volume-profile.js';
import type { Candle } from '../src/types.js';

function makeCandle(ts: number, open: number, high: number, low: number, close: number, vol: number): Candle {
  return {
    timestamp: ts,
    open: new Decimal(open),
    high: new Decimal(high),
    low: new Decimal(low),
    close: new Decimal(close),
    volume: new Decimal(vol)
  };
}

describe('Volume Profile Engine', () => {
  it('identifies POC, VAH, and VAL from candle distributions', () => {
    const candles: Candle[] = [
      makeCandle(1000, 100, 102, 98, 101, 50),  // bin ~ 100
      makeCandle(2000, 101, 103, 100, 102, 200), // bin ~ 100 (highest volume)
      makeCandle(3000, 102, 105, 101, 104, 80),  // bin ~ 102
      makeCandle(4000, 104, 108, 103, 107, 30)   // bin ~ 105
    ];

    const profile = calculateVolumeProfile(candles, {
      binSize: new Decimal(2),
      valueAreaRatio: new Decimal(0.7)
    });

    expect(profile.totalVolume.toNumber()).toBe(360);
    expect(profile.poc.toNumber()).toBe(100);
    expect(profile.levels.length).toBeGreaterThan(1);
    expect(profile.val.toNumber()).toBeLessThanOrEqual(profile.vah.toNumber());
  });
});
