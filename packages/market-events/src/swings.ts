import type { Candle, SwingPoint } from './types.js';

export interface SwingDetectionOptions {
  readonly leftBars: number;
  readonly rightBars: number;
}

/**
 * Detects swing highs and swing lows using symmetrical left/right bar confirmation.
 */
export function detectSwings(
  candles: readonly Candle[],
  options: SwingDetectionOptions = { leftBars: 2, rightBars: 2 }
): SwingPoint[] {
  const { leftBars, rightBars } = options;
  const swings: SwingPoint[] = [];

  for (let i = leftBars; i < candles.length - rightBars; i++) {
    const candidate = candles[i]!;
    let isHigh = true;
    let isLow = true;

    for (let offset = -leftBars; offset <= rightBars; offset++) {
      if (offset === 0) continue;
      const neighbor = candles[i + offset]!;
      if (neighbor.high.gte(candidate.high)) isHigh = false;
    }

    for (let offset = -leftBars; offset <= rightBars; offset++) {
      if (offset === 0) continue;
      const neighbor = candles[i + offset]!;
      if (neighbor.low.lte(candidate.low)) isLow = false;
    }

    const confirmedAtIndex = i + rightBars;

    if (isHigh) {
      swings.push({
        id: `swing-high-${candidate.timestamp}`,
        type: 'high',
        index: i,
        timestamp: candidate.timestamp,
        price: candidate.high,
        confirmedAtIndex
      });
    }

    if (isLow) {
      swings.push({
        id: `swing-low-${candidate.timestamp}`,
        type: 'low',
        index: i,
        timestamp: candidate.timestamp,
        price: candidate.low,
        confirmedAtIndex
      });
    }
  }

  return swings.sort((a, b) => a.index - b.index);
}
