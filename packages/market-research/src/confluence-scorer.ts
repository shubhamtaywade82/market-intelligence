import { Decimal } from 'decimal.js';
import type { BaseEvent, EventDirection } from '@nemesis-oss/market-events';

export interface ConfluenceFactors {
  readonly hasFvg: boolean;
  readonly hasOrderBlock: boolean;
  readonly hasLiquiditySweep: boolean;
  readonly hasStructureBreak: boolean;
  readonly hasDisplacement: boolean;
  readonly hasOiExpansion: boolean;
  readonly hasFundingAlignment: boolean;
}

export interface ConfluenceScore {
  readonly direction: EventDirection;
  readonly score: number;
  readonly totalWeight: number;
  readonly normalizedConfidence: number;
  readonly activeFactors: readonly string[];
}

const FACTOR_WEIGHTS: Record<keyof ConfluenceFactors, number> = {
  hasLiquiditySweep: 25,
  hasStructureBreak: 20,
  hasFvg: 15,
  hasOrderBlock: 15,
  hasDisplacement: 10,
  hasOiExpansion: 10,
  hasFundingAlignment: 5
};

/**
 * Evaluates multi-component evidence and calculates an objective confluence score.
 */
export function scoreConfluence(
  direction: EventDirection,
  events: readonly BaseEvent[]
): ConfluenceScore {
  const dirEvents = events.filter(e => e.direction === direction);
  const eventTypes = new Set(dirEvents.map(e => e.type));

  const factors: ConfluenceFactors = {
    hasFvg: eventTypes.has('fvg'),
    hasOrderBlock: eventTypes.has('order_block'),
    hasLiquiditySweep: eventTypes.has('liquidity_sweep'),
    hasStructureBreak: eventTypes.has('bos') || eventTypes.has('mss') || eventTypes.has('choch'),
    hasDisplacement: eventTypes.has('displacement'),
    hasOiExpansion: dirEvents.some(e => e.type === 'derivatives' && (e as any).derivativesType === 'oi_expansion'),
    hasFundingAlignment: dirEvents.some(e => e.type === 'derivatives' && (e as any).derivativesType === 'funding_extreme')
  };

  let score = 0;
  let totalWeight = 0;
  const activeFactors: string[] = [];

  for (const [key, weight] of Object.entries(FACTOR_WEIGHTS) as [keyof ConfluenceFactors, number][]) {
    totalWeight += weight;
    if (factors[key]) {
      score += weight;
      activeFactors.push(key);
    }
  }

  const normalizedConfidence = totalWeight > 0 ? score / totalWeight : 0;

  return {
    direction,
    score,
    totalWeight,
    normalizedConfidence,
    activeFactors
  };
}
