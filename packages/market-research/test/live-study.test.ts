import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import type { Candle } from '@nemesis-oss/market-events';
import { runLiveStudyFromCandles } from '../src/live-study.js';

function syntheticCandles(count: number): Candle[] {
  const candles: Candle[] = [];
  let price = new Decimal(65000);
  const startTs = 1_700_000_000_000;
  for (let i = 0; i < count; i++) {
    const step = i % 20 < 10 ? 12 : -8;
    const open = price;
    const close = open.plus(step);
    candles.push({
      timestamp: startTs + i * 15 * 60 * 1000,
      open,
      high: Decimal.max(open, close).plus(15),
      low: Decimal.min(open, close).minus(15),
      close,
      volume: new Decimal(500)
    });
    price = close;
  }
  return candles;
}

describe('runLiveStudyFromCandles', () => {
  it('builds matrix and walk-forward markdown without network', () => {
    const report = runLiveStudyFromCandles(syntheticCandles(320), {
      symbol: 'BTCUSDT',
      timeframe: '15m',
      horizonCandles: 24
    });
    expect(report).toContain('# Live study: BTCUSDT 15m');
    expect(report).toContain('# Effectiveness Matrix: BTCUSDT');
    expect(report).toContain('Walk-Forward Stability');
  });
});
