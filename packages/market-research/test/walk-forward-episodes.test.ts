import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { clusterEventsIntoEpisodes } from '../src/episode-clustering.js';
import { runWalkForwardValidation } from '../src/walk-forward.js';
import type { Candle, BaseEvent } from '@nemesis-oss/market-events';

describe('Episode Clustering & Walk-Forward Validation', () => {
  it('clusters consecutive overlapping FVGs into single independent episodes', () => {
    const events: BaseEvent[] = [
      { id: '1', type: 'fvg', symbol: 'BTC', timeframe: '15m', detectedAt: 1000, originIndex: 10, direction: 'bullish' },
      { id: '2', type: 'fvg', symbol: 'BTC', timeframe: '15m', detectedAt: 2000, originIndex: 12, direction: 'bullish' }, // gap = 2 <= 3 -> same episode
      { id: '3', type: 'fvg', symbol: 'BTC', timeframe: '15m', detectedAt: 3000, originIndex: 13, direction: 'bullish' }, // gap = 1 <= 3 -> same episode
      // Distant FVG:
      { id: '4', type: 'fvg', symbol: 'BTC', timeframe: '15m', detectedAt: 9000, originIndex: 30, direction: 'bullish' }
    ];

    const episodes = clusterEventsIntoEpisodes(events, { maxCandleGap: 3 });
    expect(episodes).toHaveLength(2);
    expect(episodes[0]!.eventsCount).toBe(3);
    expect(episodes[1]!.eventsCount).toBe(1);
  });

  it('runs rolling train/test windows and calculates out-of-sample degradation', () => {
    // Generate synthetic series of 200 candles
    const candles: Candle[] = [];
    let price = new Decimal(50000);

    for (let i = 0; i < 200; i++) {
      const delta = (i % 8 - 4) * 20;
      const open = price;
      const close = open.plus(delta);
      const high = Decimal.max(open, close).plus(10);
      const low = Decimal.min(open, close).minus(10);
      candles.push({
        timestamp: 1000 + i * 60000,
        open,
        high,
        low,
        close,
        volume: new Decimal(100)
      });
      price = close;
    }

    const { windows, stability } = runWalkForwardValidation(candles, {
      symbol: 'BTCUSDT',
      timeframe: '15m',
      trainCandlesCount: 80,
      testCandlesCount: 40,
      stepCandlesCount: 40,
      horizonCandles: 10
    });

    expect(windows.length).toBeGreaterThanOrEqual(2);
    expect(windows[0]!.embargoBars).toBe(10);
    expect(windows[0]!.purgedTrainEventsCount).toBeGreaterThanOrEqual(0);
    expect(windows[0]!.testStartTime).toBeGreaterThan(windows[0]!.trainEndTime);
    expect(windows[0]!.frozenHypotheses?.length).toBeGreaterThanOrEqual(1);
    expect(windows[0]!.frozenHypotheses?.some(f => f.component === 'fvg')).toBe(true);
    expect(stability.some(s => s.component === 'fvg')).toBe(true);
  });

  it('preserves warm-up history across boundaries without cold restart', () => {
    const candles: Candle[] = [];
    let price = new Decimal(50000);
    for (let i = 0; i < 200; i++) {
      const delta = (i % 8 - 4) * 20;
      const open = price;
      const close = open.plus(delta);
      candles.push({
        timestamp: 1000 + i * 60000,
        open,
        high: Decimal.max(open, close).plus(10),
        low: Decimal.min(open, close).minus(10),
        close,
        volume: new Decimal(100)
      });
      price = close;
    }

    const { windows } = runWalkForwardValidation(candles, {
      symbol: 'BTCUSDT',
      timeframe: '15m',
      trainCandlesCount: 80,
      testCandlesCount: 40,
      stepCandlesCount: 40,
      horizonCandles: 10,
      warmupBars: 30
    });

    expect(windows[0]!.testStartTime).toBe(candles[90]!.timestamp);
    expect(windows[0]!.testResults.length).toBeGreaterThan(0);
  });
});
