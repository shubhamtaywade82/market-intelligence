import { Decimal } from 'decimal.js';
import type { Candle } from './types.js';

export interface VolumeProfileLevel {
  readonly price: Decimal;
  readonly volume: Decimal;
}

export interface VolumeProfileResult {
  readonly poc: Decimal;
  readonly vah: Decimal;
  readonly val: Decimal;
  readonly totalVolume: Decimal;
  readonly levels: readonly VolumeProfileLevel[];
}

export interface VolumeProfileOptions {
  readonly binSize: Decimal;
  readonly valueAreaRatio?: Decimal;
}

/**
 * Calculates Volume Profile (POC, VAH, VAL) deterministically over a series of candles.
 */
export function calculateVolumeProfile(
  candles: readonly Candle[],
  options: VolumeProfileOptions
): VolumeProfileResult {
  if (candles.length === 0) {
    return {
      poc: new Decimal(0),
      vah: new Decimal(0),
      val: new Decimal(0),
      totalVolume: new Decimal(0),
      levels: []
    };
  }

  const binSize = options.binSize;
  const vaRatio = options.valueAreaRatio ?? new Decimal(0.7);
  const volumeMap = new Map<string, { price: Decimal; volume: Decimal }>();
  let totalVolume = new Decimal(0);

  for (const c of candles) {
    totalVolume = totalVolume.plus(c.volume);
    const mid = c.high.plus(c.low).dividedBy(2);
    const binPrice = mid.dividedBy(binSize).floor().times(binSize);
    const key = binPrice.toString();
    const existing = volumeMap.get(key);
    if (existing) {
      existing.volume = existing.volume.plus(c.volume);
    } else {
      volumeMap.set(key, { price: binPrice, volume: c.volume });
    }
  }

  const levels = Array.from(volumeMap.values()).sort((a, b) => a.price.cmp(b.price));
  const pocLevel = [...levels].sort((a, b) => b.volume.cmp(a.volume))[0];
  const poc = pocLevel ? pocLevel.price : new Decimal(0);

  const targetVaVolume = totalVolume.times(vaRatio);
  let accumulated = new Decimal(0);
  let val = levels[0]?.price ?? new Decimal(0);
  let vah = levels[levels.length - 1]?.price ?? new Decimal(0);

  // Accumulate volume starting from lowest price upward until reaching VA threshold
  for (const lvl of levels) {
    accumulated = accumulated.plus(lvl.volume);
    if (accumulated.gte(targetVaVolume)) {
      vah = lvl.price;
      break;
    }
  }

  return {
    poc,
    vah,
    val,
    totalVolume,
    levels
  };
}
