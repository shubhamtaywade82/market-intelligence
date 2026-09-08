import type { BaseEvent } from '@nemesis-oss/market-events';
import type { EventOutcome } from './types.js';

export interface EventObservation {
  readonly event: BaseEvent;
  readonly outcome: EventOutcome;
}

export interface InteractionPairAnalysis {
  readonly primaryType: string;
  readonly secondaryType: string;
  readonly sampleSizePrimary: number;
  readonly sampleSizeSecondary: number;
  readonly sampleSizeCombined: number;
  readonly probPrimary: number;
  readonly probSecondary: number;
  readonly probCombined: number;
  readonly interactionUplift: number;
  readonly incrementalContributionPrimary: number;
  readonly incrementalContributionSecondary: number;
  readonly redundancyScore: number;
}

/**
 * Checks if two events occurred within temporal and structural proximity (same episode / window).
 */
export function areEventsCoOccurring(
  eventA: BaseEvent,
  eventB: BaseEvent,
  maxBarGap: number = 3
): boolean {
  if (eventA.symbol !== eventB.symbol || eventA.timeframe !== eventB.timeframe) return false;
  return Math.abs(eventA.originIndex - eventB.originIndex) <= maxBarGap;
}

/**
 * Evaluates the empirical interaction and incremental contribution between two event families.
 */
export function analyzeEventPairInteraction(
  observationsA: readonly EventObservation[],
  observationsB: readonly EventObservation[],
  targetMetric: 'hit1R' | 'hit2R' | 'hit3R' = 'hit2R',
  maxBarGap: number = 3
): InteractionPairAnalysis {
  const typeA = observationsA[0]?.event.type ?? 'A';
  const typeB = observationsB[0]?.event.type ?? 'B';

  const probA = observationsA.length > 0
    ? observationsA.filter(o => o.outcome[targetMetric]).length / observationsA.length
    : 0;

  const probB = observationsB.length > 0
    ? observationsB.filter(o => o.outcome[targetMetric]).length / observationsB.length
    : 0;

  // Find co-occurring instances
  const combinedOutcomes = observationsA.filter(obsA =>
    observationsB.some(obsB => areEventsCoOccurring(obsA.event, obsB.event, maxBarGap))
  );

  const sampleCombined = combinedOutcomes.length;
  const probCombined = sampleCombined > 0
    ? combinedOutcomes.filter(o => o.outcome[targetMetric]).length / sampleCombined
    : 0;

  const interactionUplift = probCombined - Math.max(probA, probB);
  const incrementalA = probCombined - probB;
  const incrementalB = probCombined - probA;

  // Redundancy: 1.0 means B adds zero edge beyond A
  const maxSoloEdge = Math.max(0.0001, probB - 0.5);
  const redundancy = Math.max(0, Math.min(1, 1 - (incrementalB / maxSoloEdge)));

  return {
    primaryType: typeA,
    secondaryType: typeB,
    sampleSizePrimary: observationsA.length,
    sampleSizeSecondary: observationsB.length,
    sampleSizeCombined: sampleCombined,
    probPrimary: probA,
    probSecondary: probB,
    probCombined,
    interactionUplift,
    incrementalContributionPrimary: incrementalA,
    incrementalContributionSecondary: incrementalB,
    redundancyScore: redundancy
  };
}
