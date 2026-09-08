import type { Candle, StructureBreakEvent, SwingPoint, Timeframe } from './types.js';

export interface StructureOptions {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly requireClose?: boolean;
}

/**
 * Detects Break of Structure (BOS) and Market Structure Shift (MSS) from swing points.
 */
export function detectStructureBreaks(
  candles: readonly Candle[],
  swings: readonly SwingPoint[],
  options: StructureOptions
): StructureBreakEvent[] {
  const breaks: StructureBreakEvent[] = [];
  const requireClose = options.requireClose ?? true;
  let currentTrend: 'bullish' | 'bearish' | null = null;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!;
    // Only evaluate swings that are already confirmed by candle i
    const activeSwings = swings.filter(s => s.confirmedAtIndex <= i);
    const lastHigh = [...activeSwings].reverse().find(s => s.type === 'high');
    const lastLow = [...activeSwings].reverse().find(s => s.type === 'low');

    if (lastHigh && (requireClose ? candle.close.gt(lastHigh.price) : candle.high.gt(lastHigh.price))) {
      const isMss = currentTrend === 'bearish';
      breaks.push({
        id: `${options.symbol}-${options.timeframe}-${isMss ? 'mss' : 'bos'}-bull-${candle.timestamp}`,
        type: isMss ? 'mss' : 'bos',
        symbol: options.symbol,
        timeframe: options.timeframe,
        detectedAt: candle.timestamp,
        originIndex: i,
        direction: 'bullish',
        brokenSwing: lastHigh,
        breakPrice: candle.close,
        isCloseConfirmed: candle.close.gt(lastHigh.price)
      });
      currentTrend = 'bullish';
    } else if (lastLow && (requireClose ? candle.close.lt(lastLow.price) : candle.low.lt(lastLow.price))) {
      const isMss = currentTrend === 'bullish';
      breaks.push({
        id: `${options.symbol}-${options.timeframe}-${isMss ? 'mss' : 'bos'}-bear-${candle.timestamp}`,
        type: isMss ? 'mss' : 'bos',
        symbol: options.symbol,
        timeframe: options.timeframe,
        detectedAt: candle.timestamp,
        originIndex: i,
        direction: 'bearish',
        brokenSwing: lastLow,
        breakPrice: candle.close,
        isCloseConfirmed: candle.close.lt(lastLow.price)
      });
      currentTrend = 'bearish';
    }
  }

  return breaks;
}
