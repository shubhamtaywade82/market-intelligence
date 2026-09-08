import { Decimal } from 'decimal.js';
import type {
  BaseEvent,
  Candle,
  FvgEvent,
  OrderBlockEvent,
  StructureBreakEvent,
  LiquiditySweepEvent
} from '@nemesis-oss/market-events';
import type {
  OutcomeConfig,
  BaseOutcome,
  OrderBlockOutcome,
  StructureOutcome,
  LiquiditySweepOutcome,
  EventOutcome,
  ZoneOutcome
} from './types.js';
import { evaluateGenericOutcome, DEFAULT_OUTCOME_CONFIG } from './generic-outcomes.js';

export { evaluateGenericOutcome, DEFAULT_OUTCOME_CONFIG };

function computeOutcomeRMultiples(
  maxFav: Decimal,
  maxAdv: Decimal,
  risk: Decimal,
  causalAtr: Decimal
) {
  const mfeAtr = causalAtr.gt(0) ? maxFav.dividedBy(causalAtr) : new Decimal(0);
  const maeAtr = causalAtr.gt(0) ? maxAdv.dividedBy(causalAtr) : new Decimal(0);
  const hit2R = maxFav.gte(risk.times(2));
  return {
    mfeAtr,
    maeAtr,
    realizedR: hit2R ? new Decimal(2) : new Decimal(0),
    firstHit: hit2R ? ('target_first' as const) : ('horizon_expired' as const),
    hit1R: maxFav.gte(risk),
    hit2R,
    hit3R: maxFav.gte(risk.times(3))
  };
}

export function evaluateFvgOutcome(
  event: FvgEvent,
  candles: readonly Candle[],
  causalAtr: Decimal,
  config: OutcomeConfig = DEFAULT_OUTCOME_CONFIG
): ZoneOutcome {
  const isBull = event.direction === 'bullish';
  const entryRef = isBull ? event.top : event.bottom;
  const span = event.top.minus(event.bottom).abs();
  const risk = span.gt(0) ? span : causalAtr;

  let firstTouchBars: number | null = null;
  let maxFav = new Decimal(0);
  let maxAdv = new Decimal(0);
  let maxPenetration = new Decimal(0);
  let isInvalidated = false;

  const horizon = Math.min(candles.length, event.originIndex + 1 + config.horizonCandles);
  for (let i = event.originIndex + 1; i < horizon; i++) {
    const c = candles[i]!;
    if ((isBull ? c.low.lte(event.top) : c.high.gte(event.bottom)) && firstTouchBars === null) {
      firstTouchBars = i - event.originIndex;
    }
    if (firstTouchBars !== null) {
      const pen = isBull ? event.top.minus(c.low) : c.high.minus(event.bottom);
      if (pen.gt(maxPenetration)) maxPenetration = pen;
      if (isBull ? c.close.lt(event.bottom) : c.close.gt(event.top)) isInvalidated = true;
    }
    const fav = isBull ? c.high.minus(entryRef) : entryRef.minus(c.low);
    if (fav.gt(maxFav)) maxFav = fav;
    const adv = isBull ? entryRef.minus(c.low) : c.high.minus(entryRef);
    if (adv.gt(maxAdv)) maxAdv = adv;
  }

  const penRatio = span.isZero() ? new Decimal(0) : maxPenetration.dividedBy(span);
  const rStats = computeOutcomeRMultiples(maxFav, maxAdv, risk, causalAtr);

  return {
    eventId: event.id,
    horizonCandles: config.horizonCandles,
    mfe: maxFav,
    mae: maxAdv,
    ...rStats,
    timeToFirstHitBars: 0,
    isAmbiguous: false,
    firstTouchBars,
    firstTouchIndex: firstTouchBars !== null ? event.originIndex + firstTouchBars : null,
    fill25: penRatio.gte(0.25),
    fill50: penRatio.gte(0.50),
    fill75: penRatio.gte(0.75),
    fill100: penRatio.gte(1.0),
    touch25: penRatio.gte(0.25),
    touch50: penRatio.gte(0.50),
    touch75: penRatio.gte(0.75),
    fullFill: penRatio.gte(1.0),
    isMitigated: firstTouchBars !== null,
    isInvalidated
  };
}

export function evaluateOrderBlockOutcome(
  event: OrderBlockEvent,
  candles: readonly Candle[],
  causalAtr: Decimal,
  config: OutcomeConfig = DEFAULT_OUTCOME_CONFIG
): OrderBlockOutcome {
  const isBull = event.direction === 'bullish';
  const entryRef = isBull ? event.top : event.bottom;
  const span = event.top.minus(event.bottom).abs();
  const risk = span.gt(0) ? span : causalAtr;

  let firstTouchBars: number | null = null;
  let maxFav = new Decimal(0);
  let maxAdv = new Decimal(0);
  let maxPen = new Decimal(0);
  let isBreaker = false;

  const horizon = Math.min(candles.length, event.originIndex + 1 + config.horizonCandles);
  for (let i = event.originIndex + 1; i < horizon; i++) {
    const c = candles[i]!;
    if ((isBull ? c.low.lte(event.top) : c.high.gte(event.bottom)) && firstTouchBars === null) {
      firstTouchBars = i - event.originIndex;
    }
    if (firstTouchBars !== null) {
      const pen = isBull ? event.top.minus(c.low) : c.high.minus(event.bottom);
      if (pen.gt(maxPen)) maxPen = pen;
      if (isBull ? c.close.lt(event.bottom) : c.close.gt(event.top)) isBreaker = true;
    }
    const fav = isBull ? c.high.minus(entryRef) : entryRef.minus(c.low);
    if (fav.gt(maxFav)) maxFav = fav;
    const adv = isBull ? entryRef.minus(c.low) : c.high.minus(entryRef);
    if (adv.gt(maxAdv)) maxAdv = adv;
  }

  const rStats = computeOutcomeRMultiples(maxFav, maxAdv, risk, causalAtr);
  return {
    eventId: event.id,
    horizonCandles: config.horizonCandles,
    mfe: maxFav,
    mae: maxAdv,
    ...rStats,
    timeToFirstHitBars: 0,
    isAmbiguous: false,
    firstTouchBars,
    maxPenetrationRatio: span.isZero() ? new Decimal(0) : maxPen.dividedBy(span),
    isMitigated: firstTouchBars !== null,
    isBreaker
  };
}

export function evaluateStructureOutcome(
  event: StructureBreakEvent,
  candles: readonly Candle[],
  causalAtr: Decimal,
  config: OutcomeConfig = DEFAULT_OUTCOME_CONFIG
): StructureOutcome {
  const base = evaluateGenericOutcome(event, candles, causalAtr, config);
  const isBull = event.direction === 'bullish';
  const tol = causalAtr.times(0.2);

  let hasRetested = false;
  let retestBars: number | null = null;

  const horizon = Math.min(candles.length, event.originIndex + 1 + config.horizonCandles);
  for (let i = event.originIndex + 1; i < horizon; i++) {
    const c = candles[i]!;
    const retested = isBull
      ? c.low.lte(event.breakPrice.plus(tol)) && c.low.gte(event.breakPrice.minus(tol))
      : c.high.gte(event.breakPrice.minus(tol)) && c.high.lte(event.breakPrice.plus(tol));

    if (retested && !hasRetested) {
      hasRetested = true;
      retestBars = i - event.originIndex;
      break;
    }
  }

  return {
    ...base,
    hasRetested,
    retestBars,
    isContinuation: base.hit2R,
    nextBreakBars: null
  };
}

export function evaluateLiquiditySweepOutcome(
  event: LiquiditySweepEvent,
  candles: readonly Candle[],
  causalAtr: Decimal,
  config: OutcomeConfig = DEFAULT_OUTCOME_CONFIG
): LiquiditySweepOutcome {
  const base = evaluateGenericOutcome(event, candles, causalAtr, config);
  const isBull = event.direction === 'bullish';

  let isReclaimed = false;
  let reclaimBars: number | null = null;

  const horizon = Math.min(candles.length, event.originIndex + 1 + config.horizonCandles);
  for (let i = event.originIndex + 1; i < horizon; i++) {
    const c = candles[i]!;
    const reclaimed = isBull ? c.close.gt(event.sweptLevel) : c.close.lt(event.sweptLevel);
    if (reclaimed && !isReclaimed) {
      isReclaimed = true;
      reclaimBars = i - event.originIndex;
      break;
    }
  }

  return {
    ...base,
    isReclaimed,
    reclaimBars,
    postSweepDisplacementAtr: base.mfeAtr,
    oppositeLiquidityTaken: base.hit3R
  };
}

export interface OutcomeEvaluator<E extends BaseEvent = BaseEvent, O extends BaseOutcome = BaseOutcome> {
  supports(event: BaseEvent): boolean;
  evaluate(event: E, candles: readonly Candle[], causalAtr: Decimal, config?: OutcomeConfig): O;
}

export function evaluateEventOutcome(
  event: BaseEvent,
  candles: readonly Candle[],
  causalAtr: Decimal,
  config: OutcomeConfig = DEFAULT_OUTCOME_CONFIG
): EventOutcome {
  if (event.type === 'fvg') return evaluateFvgOutcome(event as FvgEvent, candles, causalAtr, config);
  if (event.type === 'order_block') return evaluateOrderBlockOutcome(event as OrderBlockEvent, candles, causalAtr, config);
  if (event.type === 'bos' || event.type === 'mss') return evaluateStructureOutcome(event as StructureBreakEvent, candles, causalAtr, config);
  if (event.type === 'liquidity_sweep') return evaluateLiquiditySweepOutcome(event as LiquiditySweepEvent, candles, causalAtr, config);
  return evaluateGenericOutcome(event, candles, causalAtr, config);
}
