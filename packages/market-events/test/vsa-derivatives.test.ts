import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { detectVsaEvents } from '../src/vsa.js';
import { detectDerivativesEvents } from '../src/derivatives.js';
import type { Candle, DerivativesSnapshot } from '../src/types.js';

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

describe('VSA & Derivatives Event Engines', () => {
  it('detects VSA Stopping Volume and No Supply patterns', () => {
    const candles: Candle[] = [];
    // 20 baseline consolidation bars with volume = 100, spread = 2
    for (let i = 0; i < 20; i++) {
      candles.push(makeCandle(1000 + i * 60000, 100, 101, 99, 100, 100));
    }

    // Bar 21: Down bar with 50 volume (low volume down-bar -> No Supply)
    candles.push(makeCandle(1000 + 20 * 60000, 100, 100.5, 99.5, 99.8, 40));

    // Bar 22: Down bar with 300 volume, closing well off lows (Stopping volume)
    candles.push(makeCandle(1000 + 21 * 60000, 100, 100.2, 95, 98.5, 300));

    const events = detectVsaEvents(candles, {
      symbol: 'ETHUSDT',
      timeframe: '15m',
      lookback: 20
    });

    expect(events.some(e => e.vsaType === 'no_supply')).toBe(true);
    expect(events.some(e => e.vsaType === 'stopping_volume')).toBe(true);
  });

  it('detects Open Interest expansion and funding rate extremes', () => {
    const snapshots: DerivativesSnapshot[] = [
      {
        timestamp: 1000,
        openInterest: new Decimal(10000),
        fundingRate: new Decimal(0.0001),
        takerBuyVolume: new Decimal(500),
        takerSellVolume: new Decimal(500)
      },
      {
        timestamp: 2000,
        // +10% expansion in OI and extreme positive funding (0.04% > 0.03%)
        openInterest: new Decimal(11000),
        fundingRate: new Decimal(0.0004),
        takerBuyVolume: new Decimal(800),
        takerSellVolume: new Decimal(400)
      }
    ];

    const events = detectDerivativesEvents(snapshots, {
      symbol: 'ETHUSDT',
      timeframe: '15m'
    });

    expect(events.some(e => e.derivativesType === 'oi_expansion')).toBe(true);
    expect(events.some(e => e.derivativesType === 'funding_extreme')).toBe(true);
  });
});
