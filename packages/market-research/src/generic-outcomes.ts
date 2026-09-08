import { Decimal } from 'decimal.js';
import type { BaseEvent, Candle } from '@nemesis-oss/market-events';
import type { OutcomeConfig, BaseOutcome, DirectionalOutcome, PathResolution } from './types.js';

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
  readonly pathResolution: PathResolution;
  readonly collision: boolean;
  readonly targetFirst: boolean;
  readonly stopFirst: boolean;
  readonly stopHit: boolean;
  readonly timeToTarget: number | null;
  readonly timeToStop: number | null;
}

export function resolveCollision(policy: OutcomeConfig['ambiguityPolicy']): BaseOutcome['firstHit'] {
  if (policy === 'optimistic') return 'target_first';
  if (policy === 'pessimistic') return 'stop_first';
  return 'simultaneous_collision';
}

export interface TrajectoryParams {
  readonly entry: Decimal;
  readonly direction: 'bullish' | 'bearish';
  readonly atr: Decimal;
  readonly config: OutcomeConfig;
  readonly startOffset?: number | undefined;
}

function checkBarHit(c: Candle, isBull: boolean, target: Decimal, stop: Decimal) {
  return {
    hitTarget: isBull ? c.high.gte(target) : c.low.lte(target),
    hitStop: isBull ? c.low.lte(stop) : c.high.gte(stop)
  };
}

export function evaluateTrajectory(
  candles: readonly Candle[],
  params: TrajectoryParams
): TrajectoryResult {
  const { entry, direction, atr, config, startOffset = 1 } = params;
  const isBull = direction === 'bullish';
  const target = isBull ? entry.plus(atr.times(config.targetR)) : entry.minus(atr.times(config.targetR));
  const stop = isBull ? entry.minus(atr.times(config.stopAtrMultiplier)) : entry.plus(atr.times(config.stopAtrMultiplier));

  let mfe = new Decimal(0), mae = new Decimal(0), timeToHit = 0;
  let firstHit: BaseOutcome['firstHit'] = 'horizon_expired';
  let isAmbiguous = false, collision = false, stopHit = false;
  let pathResolution: PathResolution = 'exact';
  let timeToTarget: number | null = null, timeToStop: number | null = null;

  const horizon = Math.min(candles.length, startOffset + config.horizonCandles);
  for (let i = startOffset; i < horizon; i++) {
    const c = candles[i]!;
    const offset = i - startOffset + 1;
    const fav = isBull ? c.high.minus(entry) : entry.minus(c.low);
    if (fav.gt(mfe)) mfe = fav;
    const adv = isBull ? entry.minus(c.low) : c.high.minus(entry);
    if (adv.gt(mae)) mae = adv;

    const { hitTarget, hitStop } = checkBarHit(c, isBull, target, stop);
    if (hitStop && !stopHit) { stopHit = true; timeToStop = offset; }
    if (hitTarget && timeToTarget === null) timeToTarget = offset;

    if (hitTarget && hitStop) {
      collision = true;
      isAmbiguous = true;
      timeToHit = offset;
      firstHit = resolveCollision(config.ambiguityPolicy);
      pathResolution = config.ambiguityPolicy === 'optimistic' ? 'ohlc_optimistic'
        : config.ambiguityPolicy === 'pessimistic' ? 'ohlc_pessimistic' : 'ambiguous';
      break;
    }
    if (hitTarget) { firstHit = 'target_first'; timeToHit = offset; pathResolution = 'exact'; break; }
    if (hitStop) { firstHit = 'stop_first'; timeToHit = offset; pathResolution = 'exact'; break; }
  }

  return {
    mfe, mae, firstHit, timeToFirstHitBars: timeToHit, isAmbiguous, pathResolution, collision,
    targetFirst: firstHit === 'target_first', stopFirst: firstHit === 'stop_first', stopHit, timeToTarget, timeToStop
  };
}

export function evaluateGenericOutcome(
  event: BaseEvent,
  candles: readonly Candle[],
  causalAtr: Decimal,
  config: OutcomeConfig = DEFAULT_OUTCOME_CONFIG
): DirectionalOutcome {
  const c = candles[event.originIndex];
  const entry = c ? c.close : new Decimal(0);
  const traj = evaluateTrajectory(candles, {
    entry,
    direction: event.direction,
    atr: causalAtr,
    config,
    startOffset: event.originIndex + 1
  });

  const mfeAtr = causalAtr.isZero() ? new Decimal(0) : traj.mfe.dividedBy(causalAtr);
  const maeAtr = causalAtr.isZero() ? new Decimal(0) : traj.mae.dividedBy(causalAtr);
  const targetHitR = traj.firstHit === 'target_first'
    ? new Decimal(config.targetR)
    : traj.firstHit === 'stop_first'
      ? new Decimal(-config.stopAtrMultiplier)
      : new Decimal(0);

  return {
    eventId: event.id,
    horizonCandles: config.horizonCandles,
    mfe: traj.mfe,
    mae: traj.mae,
    mfeAtr,
    maeAtr,
    mfeR: mfeAtr,
    maeR: maeAtr,
    targetHitR,
    realizedR: targetHitR,
    firstHit: traj.firstHit,
    timeToFirstHitBars: traj.timeToFirstHitBars,
    isAmbiguous: traj.isAmbiguous,
    pathResolution: traj.pathResolution,
    collision: traj.collision,
    targetFirst: traj.targetFirst,
    stopFirst: traj.stopFirst,
    stopHit: traj.stopHit,
    timeToTarget: traj.timeToTarget,
    timeToStop: traj.timeToStop,
    targetHit1R: mfeAtr.gte(1),
    targetHit2R: mfeAtr.gte(2),
    targetHit3R: mfeAtr.gte(3),
    hit1R: traj.firstHit === 'target_first' || mfeAtr.gte(1),
    hit2R: traj.firstHit === 'target_first' || (traj.firstHit !== 'stop_first' && mfeAtr.gte(2)),
    hit3R: traj.firstHit !== 'stop_first' && mfeAtr.gte(3)
  };
}
