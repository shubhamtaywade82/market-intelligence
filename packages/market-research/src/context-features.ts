import { Decimal } from 'decimal.js';
import type { Candle, StructureBreakEvent, SwingPoint } from '@nemesis-oss/market-events';

export type TrendRegime = 'bullish' | 'bearish' | 'range';
export type VolatilityRegime = 'low' | 'normal' | 'high';

export interface MarketContextFeatures {
  readonly trendRegime: TrendRegime;
  readonly volatilityRegime: VolatilityRegime;
  readonly atr: Decimal;
  readonly displacementAtr: Decimal;
}

/**
 * Extracts context features (trend, volatility, displacement) at a specific candle index.
 */
export function extractContextFeatures(
  candles: readonly Candle[],
  currentIndex: number,
  swings: readonly SwingPoint[],
  breaks: readonly StructureBreakEvent[]
): MarketContextFeatures {
  const c = candles[currentIndex]!;
  const prev = currentIndex > 0 ? candles[currentIndex - 1]! : c;

  const currentRange = c.high.minus(c.low);
  const lookback = Math.min(currentIndex, 14);
  let totalRange = new Decimal(0);

  for (let i = currentIndex - lookback; i < currentIndex; i++) {
    if (i >= 0) {
      totalRange = totalRange.plus(candles[i]!.high.minus(candles[i]!.low));
    }
  }

  const atr = lookback > 0 ? totalRange.dividedBy(lookback) : currentRange;
  const displacementAtr = atr.gt(0) ? currentRange.dividedBy(atr) : new Decimal(1);

  // Volatility regime
  let volatilityRegime: VolatilityRegime = 'normal';
  if (displacementAtr.lt(0.7)) volatilityRegime = 'low';
  else if (displacementAtr.gt(1.8)) volatilityRegime = 'high';

  // Trend regime based on recent confirmed breaks
  const priorBreaks = breaks.filter(b => b.originIndex <= currentIndex);
  const lastBreak = priorBreaks[priorBreaks.length - 1];

  let trendRegime: TrendRegime = 'range';
  if (lastBreak) {
    trendRegime = lastBreak.direction;
  }

  return {
    trendRegime,
    volatilityRegime,
    atr,
    displacementAtr
  };
}
