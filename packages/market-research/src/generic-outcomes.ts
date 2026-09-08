import { Decimal } from 'decimal.js';
import type { Candle, BaseEvent } from '@nemesis-oss/market-events';
import type { EventOutcome } from './types.js';

export interface GenericOutcomeOptions {
  readonly horizonCandles: number;
  readonly atr: Decimal;
}

/**
 * Evaluates forward outcomes for any directional market event over a fixed candle horizon.
 */
export function evaluateGenericOutcome(
  candles: readonly Candle[],
  event: BaseEvent,
  options: GenericOutcomeOptions
): EventOutcome {
  const startIndex = event.originIndex + 1;
  const endIndex = Math.min(candles.length, startIndex + options.horizonCandles);
  const isBull = event.direction === 'bullish';
  const entryRef = candles[event.originIndex]?.close ?? new Decimal(0);
  const risk = options.atr.gt(0) ? options.atr : new Decimal(1);

  let maxFav = new Decimal(0);
  let maxAdv = new Decimal(0);

  for (let i = startIndex; i < endIndex; i++) {
    const candle = candles[i]!;

    if (isBull) {
      const fav = candle.high.minus(entryRef);
      if (fav.gt(maxFav)) maxFav = fav;
      const adv = entryRef.minus(candle.low);
      if (adv.gt(maxAdv)) maxAdv = adv;
    } else {
      const fav = entryRef.minus(candle.low);
      if (fav.gt(maxFav)) maxFav = fav;
      const adv = candle.high.minus(entryRef);
      if (adv.gt(maxAdv)) maxAdv = adv;
    }
  }

  return {
    eventId: event.id,
    horizonCandles: options.horizonCandles,
    firstTouchIndex: startIndex,
    touch25: true,
    touch50: true,
    touch75: true,
    fullFill: true,
    mfe: maxFav,
    mae: maxAdv,
    mfeAtr: risk.gt(0) ? maxFav.dividedBy(risk) : new Decimal(0),
    maeAtr: risk.gt(0) ? maxAdv.dividedBy(risk) : new Decimal(0),
    hit1R: maxFav.gte(risk),
    hit2R: maxFav.gte(risk.times(2)),
    hit3R: maxFav.gte(risk.times(3))
  };
}
