import type { Candle, LiquiditySweepEvent, SwingPoint, Timeframe } from './types.js';

export interface SweepOptions {
  readonly symbol: string;
  readonly timeframe: Timeframe;
}

/**
 * Detects liquidity sweeps: price penetrates swing high/low wick but closes back inside.
 */
export function detectLiquiditySweeps(
  candles: readonly Candle[],
  swings: readonly SwingPoint[],
  options: SweepOptions
): LiquiditySweepEvent[] {
  const sweeps: LiquiditySweepEvent[] = [];

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!;
    const activeSwings = swings.filter(s => s.confirmedAtIndex <= i);

    for (const swing of activeSwings) {
      if (swing.type === 'high') {
        // Buy-side sweep: high exceeds swing level, but candle closes below it (reclaim)
        if (candle.high.gt(swing.price) && candle.close.lte(swing.price)) {
          sweeps.push({
            id: `${options.symbol}-${options.timeframe}-sweep-bsl-${candle.timestamp}`,
            type: 'liquidity_sweep',
            symbol: options.symbol,
            timeframe: options.timeframe,
            detectedAt: candle.timestamp,
            originIndex: i,
            direction: 'bearish',
            sweptLevel: swing.price,
            sweepExtreme: candle.high,
            targetType: 'bsl',
            reclaimed: true
          });
        }
      } else {
        // Sell-side sweep: low penetrates swing level, but candle closes above it (reclaim)
        if (candle.low.lt(swing.price) && candle.close.gte(swing.price)) {
          sweeps.push({
            id: `${options.symbol}-${options.timeframe}-sweep-ssl-${candle.timestamp}`,
            type: 'liquidity_sweep',
            symbol: options.symbol,
            timeframe: options.timeframe,
            detectedAt: candle.timestamp,
            originIndex: i,
            direction: 'bullish',
            sweptLevel: swing.price,
            sweepExtreme: candle.low,
            targetType: 'ssl',
            reclaimed: true
          });
        }
      }
    }
  }

  return sweeps;
}
