import type { BaseEvent, EventDirection } from '@nemesis-oss/market-events';
import type { DirectionalOutcome, ZoneOutcome } from './types.js';

export interface EventWithOutcome {
  readonly event: BaseEvent;
  readonly outcome: DirectionalOutcome | ZoneOutcome;
}

export interface ConditionalEdgeReport {
  readonly targetOutcome: string;
  readonly baseProbability: number;
  readonly conditionedProbability: number;
  readonly uplift: number;
  readonly sampleSize: number;
}

/**
 * Calculates empirical conditional probability and edge uplift:
 * P(target | E1 and E2) vs P(target | E1)
 * Replaces hand-authored subjective confluence scores with observed empirical evidence.
 */
export function calculateConditionalEdge(
  observations: readonly EventWithOutcome[],
  conditionFilter: (obs: EventWithOutcome) => boolean,
  targetMetric: 'hit1R' | 'hit2R' | 'hit3R' = 'hit2R'
): ConditionalEdgeReport {
  if (observations.length === 0) {
    return {
      targetOutcome: targetMetric,
      baseProbability: 0,
      conditionedProbability: 0,
      uplift: 0,
      sampleSize: 0
    };
  }

  const baseHits = observations.filter(o => o.outcome[targetMetric]).length;
  const baseProbability = baseHits / observations.length;

  const conditioned = observations.filter(conditionFilter);
  if (conditioned.length === 0) {
    return {
      targetOutcome: targetMetric,
      baseProbability,
      conditionedProbability: 0,
      uplift: -baseProbability,
      sampleSize: 0
    };
  }

  const condHits = conditioned.filter(o => o.outcome[targetMetric]).length;
  const conditionedProbability = condHits / conditioned.length;
  const uplift = conditionedProbability - baseProbability;

  return {
    targetOutcome: targetMetric,
    baseProbability,
    conditionedProbability,
    uplift,
    sampleSize: conditioned.length
  };
}
