import type { FvgOutcome, BaseOutcome } from './types.js';

export interface SurvivalStep {
  readonly bars: number;
  readonly survivalRate: number; // P(unmitigated at bar t)
  readonly cumulativeTargetRate: number; // P(target reached <= bar t)
}

export interface TimeToEventProfile {
  readonly sampleSize: number;
  readonly medianBarsToTouch: number | null;
  readonly medianBarsToTarget: number | null;
  readonly survivalCurve: readonly SurvivalStep[];
}

function calculatePercentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(sorted.length - 1, idx)]!;
}

/**
 * Computes non-parametric empirical survival curves and time-to-event distributions.
 */
export function computeTimeToEventProfile(
  outcomes: readonly (FvgOutcome | BaseOutcome)[],
  maxHorizonBars: number = 24
): TimeToEventProfile {
  const sampleSize = outcomes.length;
  if (sampleSize === 0) {
    return { sampleSize: 0, medianBarsToTouch: null, medianBarsToTarget: null, survivalCurve: [] };
  }

  const touchBars: number[] = [];
  const targetBars: number[] = [];

  for (const o of outcomes) {
    if ('firstTouchBars' in o && typeof o.firstTouchBars === 'number') {
      touchBars.push(o.firstTouchBars);
    }
    if (o.firstHit === 'target_first' && o.timeToFirstHitBars > 0) {
      targetBars.push(o.timeToFirstHitBars);
    }
  }

  const survivalCurve: SurvivalStep[] = [];
  for (let t = 1; t <= maxHorizonBars; t++) {
    // Survives = touched strictly AFTER bar t or never touched
    const surviving = outcomes.filter(o => {
      if (!('firstTouchBars' in o) || o.firstTouchBars === null) return true;
      return o.firstTouchBars > t;
    }).length;

    const reachedTarget = targetBars.filter(b => b <= t).length;

    survivalCurve.push({
      bars: t,
      survivalRate: surviving / sampleSize,
      cumulativeTargetRate: reachedTarget / sampleSize
    });
  }

  return {
    sampleSize,
    medianBarsToTouch: calculatePercentile(touchBars, 0.5),
    medianBarsToTarget: calculatePercentile(targetBars, 0.5),
    survivalCurve
  };
}
