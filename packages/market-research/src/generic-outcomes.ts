import { Decimal } from 'decimal.js';
import type { BaseEvent, Candle } from '@nemesis-oss/market-events';
import type { OutcomeConfig, BaseOutcome, DirectionalOutcome } from './types.js';

export const DEFAULT_OUTCOME_CONFIG: OutcomeConfig = {
  horizonCandles: 24,
  targetR: 2.0,
  stopAtrMultiplier: 1.0,
  ambiguityPolicy: 'pessimistic'
};

interface TrajectoryResult {
  readonly mfe: Decimal;
  readonly mae: Decimal;
  readonly firstHit: BaseOutcome['firstHit'];
  readonly timeToFirstHitBars: number;
  readonly isAmbiguous: boolean;
}

function resolveCollision(policy: OutcomeConfig['ambiguityPolicy']): BaseOutcome['firstHit'] {
  if (policy === 'optimistic') return 'target_first';
  if (policy === 'pessimistic') return 'stop_first';
  return 'simultaneous_collision';
}

export function evaluateTrajectory(
  candles: readonly Candle[],
  entry: Decimal,
  direction: 'bullish' | 'bearish',
  atr: Decimal,
  config: OutcomeConfig,
  startOffset: number = 1
): TrajectoryResult {
  const isBull = direction === 'bullish';
  const targetDist = atr.times(config.targetR);
  const stopDist = atr.times(config.stopAtrMultiplier);
  const targetPrice = isBull ? entry.plus(targetDist) : entry.minus(targetDist);
  const stopPrice = isBull ? entry.minus(stopDist) : entry.plus(stopDist);

  let mfe = new Decimal(0);
  let mae = new Decimal(0);
  let firstHit: BaseOutcome['firstHit'] = 'horizon_expired';
  let timeToHit = 0;
  let isAmbiguous = false;

  const horizon = Math.min(candles.length, startOffset + config.horizonCandles);
  for (let i = startOffset; i < horizon; i++) {
    const c = candles[i]!;
    const fav = isBull ? c.high.minus(entry) : entry.minus(c.low);
    const adv = isBull ? entry.minus(c.low) : c.high.minus(entry);
    if (fav.gt(mfe)) mfe = fav;
    if (adv.gt(mae)) mae = adv;

    if (firstHit === 'horizon_expired') {
      const hitTarget = isBull ? c.high.gte(targetPrice) : c.low.lte(targetPrice);
      const hitStop = isBull ? c.low.lte(stopPrice) : c.high.gte(stopPrice);

      if (hitTarget && hitStop) {
        firstHit = resolveCollision(config.ambiguityPolicy);
        timeToHit = i - startOffset + 1;
        isAmbiguous = true;
      } else if (hitTarget) {
        firstHit = 'target_first';
        timeToHit = i - startOffset + 1;
      } else if (hitStop) {
        firstHit = 'stop_first';
        timeToHit = i - startOffset + 1;
      }
    }
  }

  return { mfe, mae, firstHit, timeToFirstHitBars: timeToHit, isAmbiguous };
}

export function evaluateGenericOutcome(
  event: BaseEvent,
  candles: readonly Candle[],
  causalAtr: Decimal,
  config: OutcomeConfig = DEFAULT_OUTCOME_CONFIG
): DirectionalOutcome {
  const c = candles[event.originIndex];
  const entry = c ? c.close : new Decimal(0);
  const traj = evaluateTrajectory(candles, entry, event.direction, causalAtr, config, event.originIndex + 1);

  const mfeAtr = causalAtr.isZero() ? new Decimal(0) : traj.mfe.dividedBy(causalAtr);
  const maeAtr = causalAtr.isZero() ? new Decimal(0) : traj.mae.dividedBy(causalAtr);
  const realizedR = traj.firstHit === 'target_first' ? new Decimal(config.targetR) : traj.firstHit === 'stop_first' ? new Decimal(-1) : new Decimal(0);

  return {
    eventId: event.id,
    horizonCandles: config.horizonCandles,
    mfe: traj.mfe,
    mae: traj.mae,
    mfeAtr,
    maeAtr,
    realizedR,
    firstHit: traj.firstHit,
    timeToFirstHitBars: traj.timeToFirstHitBars,
    isAmbiguous: traj.isAmbiguous,
    hit1R: mfeAtr.gte(1),
    hit2R: mfeAtr.gte(2),
    hit3R: mfeAtr.gte(3)
  };
}
