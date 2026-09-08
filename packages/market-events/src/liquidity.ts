import { Decimal } from 'decimal.js';
import type { Candle, LiquiditySweepEvent, SwingPoint, Timeframe } from './types.js';

export interface SweepOptions {
  readonly symbol: string;
  readonly timeframe: Timeframe;
}

/**
 * Detects liquidity sweeps: price penetrates confirmed swing levels and reclaims within the same bar.
 * Deduplicates multiple level penetrations per candle to the single deepest sweep.
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

    let deepestBslSweep: { level: Decimal; extreme: Decimal } | null = null;
    let deepestSslSweep: { level: Decimal; extreme: Decimal } | null = null;

    for (const swing of activeSwings) {
      if (swing.type === 'high') {
        // Buy-side sweep: high penetrates swing level, candle closes back below it
        if (candle.high.gt(swing.price) && candle.close.lte(swing.price)) {
          if (!deepestBslSweep || candle.high.minus(swing.price).gt(deepestBslSweep.extreme.minus(deepestBslSweep.level))) {
            deepestBslSweep = { level: swing.price, extreme: candle.high };
          }
        }
      } else {
        // Sell-side sweep: low penetrates swing level, candle closes back above it
        if (candle.low.lt(swing.price) && candle.close.gte(swing.price)) {
          if (!deepestSslSweep || swing.price.minus(candle.low).gt(deepestSslSweep.level.minus(deepestSslSweep.extreme))) {
            deepestSslSweep = { level: swing.price, extreme: candle.low };
          }
        }
      }
    }

    if (deepestBslSweep) {
      sweeps.push({
        id: `${options.symbol}-${options.timeframe}-sweep-bsl-${candle.timestamp}`,
        type: 'liquidity_sweep',
        symbol: options.symbol,
        timeframe: options.timeframe,
        detectedAt: candle.timestamp,
        originIndex: i,
        direction: 'bearish',
        sweptLevel: deepestBslSweep.level,
        sweepExtreme: deepestBslSweep.extreme,
        targetType: 'bsl',
        reclaimed: true
      });
    }

    if (deepestSslSweep) {
      sweeps.push({
        id: `${options.symbol}-${options.timeframe}-sweep-ssl-${candle.timestamp}`,
        type: 'liquidity_sweep',
        symbol: options.symbol,
        timeframe: options.timeframe,
        detectedAt: candle.timestamp,
        originIndex: i,
        direction: 'bullish',
        sweptLevel: deepestSslSweep.level,
        sweepExtreme: deepestSslSweep.extreme,
        targetType: 'ssl',
        reclaimed: true
      });
    }
  }

  return sweeps;
}
