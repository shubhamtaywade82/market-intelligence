import { Decimal } from 'decimal.js';
import type { Candle, FvgEvent } from '@nemesis-oss/market-events';
import type { ZoneOutcome } from './types.js';

export interface FvgOutcomeOptions {
  readonly horizonCandles: number;
  readonly atr: Decimal;
}

/**
 * Evaluates forward outcomes for an FVG over a fixed forward window.
 * Calculates real penetration levels, MFE, MAE, R-multiples, and competing-risk first-hit.
 */
export function evaluateFvgOutcome(
  candles: readonly Candle[],
  fvg: FvgEvent,
  options: FvgOutcomeOptions
): ZoneOutcome {
  const startIndex = fvg.originIndex + 1;
  const endIndex = Math.min(candles.length, startIndex + options.horizonCandles);
  const isBull = fvg.direction === 'bullish';
  const entryRef = isBull ? fvg.top : fvg.bottom;
  const risk = fvg.size.gt(0) ? fvg.size : options.atr;

  let firstTouchIndex: number | null = null;
  let maxFav = new Decimal(0);
  let maxAdv = new Decimal(0);
  let deepestPenetration = new Decimal(0);
  let isInvalidated = false;

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
      if (candle.close.lt(fvg.bottom)) {
        isInvalidated = true;
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
      if (candle.close.gt(fvg.top)) {
        isInvalidated = true;
      }
    }
  }

  const penRatio = fvg.size.gt(0) ? deepestPenetration.dividedBy(fvg.size) : new Decimal(0);
  const firstTouchBars = firstTouchIndex !== null ? firstTouchIndex - fvg.originIndex : null;
  const hit2R = maxFav.gte(risk.times(2));

  return {
    eventId: fvg.id,
    horizonCandles: options.horizonCandles,
    firstTouchIndex,
    firstTouchBars,
    touch25: penRatio.gte(0.25),
    touch50: penRatio.gte(0.50),
    touch75: penRatio.gte(0.75),
    fullFill: penRatio.gte(1.0),
    fill25: penRatio.gte(0.25),
    fill50: penRatio.gte(0.50),
    fill75: penRatio.gte(0.75),
    fill100: penRatio.gte(1.0),
    isMitigated: firstTouchIndex !== null,
    isInvalidated,
    mfe: maxFav,
    mae: maxAdv,
    mfeAtr: options.atr.gt(0) ? maxFav.dividedBy(options.atr) : new Decimal(0),
    maeAtr: options.atr.gt(0) ? maxAdv.dividedBy(options.atr) : new Decimal(0),
    targetHitR: hit2R ? new Decimal(2) : new Decimal(0),
    realizedR: hit2R ? new Decimal(2) : new Decimal(0),
    firstHit: hit2R ? 'target_first' : 'horizon_expired',
    timeToFirstHitBars: 0,
    isAmbiguous: false,
    hit1R: maxFav.gte(risk),
    hit2R,
    hit3R: maxFav.gte(risk.times(3))
  };
}
