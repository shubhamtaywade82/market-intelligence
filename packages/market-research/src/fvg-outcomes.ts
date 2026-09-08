import { Decimal } from 'decimal.js';
import type { Candle, FvgEvent } from '@nemesis-oss/market-events';
import type { EventOutcome } from './types.js';

export interface FvgOutcomeOptions {
  readonly horizonCandles: number;
  readonly atr: Decimal;
}

/**
 * Evaluates forward outcomes for an FVG over a fixed forward window.
 * Calculates penetration levels, MFE, MAE, and R-multiples.
 */
export function evaluateFvgOutcome(
  candles: readonly Candle[],
  fvg: FvgEvent,
  options: FvgOutcomeOptions
): EventOutcome {
  const startIndex = fvg.originIndex + 1;
  const endIndex = Math.min(candles.length, startIndex + options.horizonCandles);
  const isBull = fvg.direction === 'bullish';
  const entryRef = isBull ? fvg.top : fvg.bottom;
  const risk = fvg.size.gt(0) ? fvg.size : options.atr;

  let firstTouchIndex: number | null = null;
  let maxFav = new Decimal(0);
  let maxAdv = new Decimal(0);
  let deepestPenetration = new Decimal(0);

  for (let i = startIndex; i < endIndex; i++) {
    const candle = candles[i]!;

    if (isBull) {
      if (candle.low.lte(fvg.top) && firstTouchIndex === null) {
        firstTouchIndex = i;
      }
      const fav = candle.high.minus(entryRef);
      if (fav.gt(maxFav)) maxFav = fav;
      const adv = entryRef.minus(candle.low);
      if (adv.gt(maxAdv)) maxAdv = adv;

      if (candle.low.lte(fvg.top)) {
        const penetration = fvg.top.minus(candle.low);
        if (penetration.gt(deepestPenetration)) deepestPenetration = penetration;
      }
    } else {
      if (candle.high.gte(fvg.bottom) && firstTouchIndex === null) {
        firstTouchIndex = i;
      }
      const fav = entryRef.minus(candle.low);
      if (fav.gt(maxFav)) maxFav = fav;
      const adv = candle.high.minus(entryRef);
      if (adv.gt(maxAdv)) maxAdv = adv;

      if (candle.high.gte(fvg.bottom)) {
        const penetration = candle.high.minus(fvg.bottom);
        if (penetration.gt(deepestPenetration)) deepestPenetration = penetration;
      }
    }
  }

  const penRatio = fvg.size.gt(0) ? deepestPenetration.dividedBy(fvg.size) : new Decimal(0);

  return {
    eventId: fvg.id,
    horizonCandles: options.horizonCandles,
    firstTouchIndex,
    touch25: penRatio.gte(0.25),
    touch50: penRatio.gte(0.50),
    touch75: penRatio.gte(0.75),
    fullFill: penRatio.gte(1.0),
    mfe: maxFav,
    mae: maxAdv,
    mfeAtr: options.atr.gt(0) ? maxFav.dividedBy(options.atr) : new Decimal(0),
    maeAtr: options.atr.gt(0) ? maxAdv.dividedBy(options.atr) : new Decimal(0),
    hit1R: maxFav.gte(risk),
    hit2R: maxFav.gte(risk.times(2)),
    hit3R: maxFav.gte(risk.times(3))
  };
}
