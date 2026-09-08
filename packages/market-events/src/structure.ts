import type {
  Candle,
  StructureBreakEvent,
  StructureLevel,
  StructureState,
  SwingPoint,
  Timeframe,
  TrendState
} from './types.js';

export interface StructureOptions {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly requireClose?: boolean;
}

/**
 * Detects Break of Structure (BOS), Change of Character (CHoCH), and Market Structure Shift (MSS)
 * using an explicit multi-state structure model.
 */
export function detectStructureBreaks(
  candles: readonly Candle[],
  swings: readonly SwingPoint[],
  options: StructureOptions
): StructureBreakEvent[] {
  const breaks: StructureBreakEvent[] = [];
  const requireClose = options.requireClose ?? true;
  const brokenSwingIds = new Set<string>();

  let state: StructureState = {
    trend: 'sideways',
    transition: 'continuation'
  };

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!;
    const activeSwings = swings.filter(s => s.confirmedAtIndex <= i && !brokenSwingIds.has(s.id));
    const lastHigh = [...activeSwings].reverse().find(s => s.type === 'high');
    const lastLow = [...activeSwings].reverse().find(s => s.type === 'low');

    if (lastHigh) {
      const isBreached = requireClose ? candle.close.gt(lastHigh.price) : candle.high.gt(lastHigh.price);
      if (isBreached) {
        const prevTrend = state.trend;
        const isMss = prevTrend === 'bearish';
        const isChoch = prevTrend === 'bearish' && (lastHigh.strength === 'micro' || lastHigh.strength === 'minor');
        const eventType = isChoch ? 'choch' : isMss ? 'mss' : 'bos';
        const level: StructureLevel = (lastHigh.strength === 'micro' || lastHigh.strength === 'minor') ? 'internal' : 'external';
        const nextTrend: TrendState = 'bullish';

        brokenSwingIds.add(lastHigh.id);
        state = {
          trend: nextTrend,
          transition: isMss ? 'mss' : isChoch ? 'choch' : 'continuation',
          lastConfirmedHigh: lastHigh,
          protectedLow: lastLow
        };

        breaks.push({
          id: `${options.symbol}-${options.timeframe}-${eventType}-bull-${candle.timestamp}`,
          type: eventType,
          symbol: options.symbol,
          timeframe: options.timeframe,
          detectedAt: candle.timestamp,
          originIndex: i,
          direction: 'bullish',
          brokenSwing: lastHigh,
          breakPrice: candle.close,
          isCloseConfirmed: candle.close.gt(lastHigh.price),
          level,
          trendBeforeBreak: prevTrend,
          trendAfterBreak: nextTrend
        });
      }
    }

    if (lastLow) {
      const isBreached = requireClose ? candle.close.lt(lastLow.price) : candle.low.lt(lastLow.price);
      if (isBreached) {
        const prevTrend = state.trend;
        const isMss = prevTrend === 'bullish';
        const isChoch = prevTrend === 'bullish' && (lastLow.strength === 'micro' || lastLow.strength === 'minor');
        const eventType = isChoch ? 'choch' : isMss ? 'mss' : 'bos';
        const level: StructureLevel = (lastLow.strength === 'micro' || lastLow.strength === 'minor') ? 'internal' : 'external';
        const nextTrend: TrendState = 'bearish';

        brokenSwingIds.add(lastLow.id);
        state = {
          trend: nextTrend,
          transition: isMss ? 'mss' : isChoch ? 'choch' : 'continuation',
          lastConfirmedLow: lastLow,
          protectedHigh: lastHigh
        };

        breaks.push({
          id: `${options.symbol}-${options.timeframe}-${eventType}-bear-${candle.timestamp}`,
          type: eventType,
          symbol: options.symbol,
          timeframe: options.timeframe,
          detectedAt: candle.timestamp,
          originIndex: i,
          direction: 'bearish',
          brokenSwing: lastLow,
          breakPrice: candle.close,
          isCloseConfirmed: candle.close.lt(lastLow.price),
          level,
          trendBeforeBreak: prevTrend,
          trendAfterBreak: nextTrend
        });
      }
    }
  }

  return breaks;
}
