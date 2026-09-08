import type { BaseEvent } from '@nemesis-oss/market-events';

export type CanonicalBehaviorType =
  | 'FAILED_DOWNSIDE_AUCTION'
  | 'FAILED_UPSIDE_AUCTION'
  | 'AGGRESSIVE_DIRECTIONAL_EXPANSION'
  | 'LIQUIDITY_IMBALANCE';

export interface CanonicalMapping {
  readonly canonicalType: CanonicalBehaviorType;
  readonly matchedEvents: readonly BaseEvent[];
  readonly representations: readonly string[];
  readonly timestamp: number;
}

/**
 * Maps disparate methodologies (ICT Sweeps, Wyckoff Springs, VSA Stopping Volume)
 * to a canonical underlying behavior archetype to test cross-framework equivalence.
 */
export function mapToCanonicalEquivalence(events: readonly BaseEvent[]): CanonicalMapping[] {
  const byTimestamp = new Map<number, BaseEvent[]>();

  for (const e of events) {
    const list = byTimestamp.get(e.detectedAt) ?? [];
    list.push(e);
    byTimestamp.set(e.detectedAt, list);
  }

  const mappings: CanonicalMapping[] = [];

  for (const [timestamp, group] of byTimestamp.entries()) {
    const types = group.map(e => {
      if (e.type === 'liquidity_sweep') return 'SMC_SWEEP';
      if (e.type === 'wyckoff' && (e as any).wyckoffType === 'spring') return 'WYCKOFF_SPRING';
      if (e.type === 'wyckoff' && (e as any).wyckoffType === 'upthrust') return 'WYCKOFF_UPTHRUST';
      if (e.type === 'vsa' && (e as any).vsaType === 'stopping_volume') return 'VSA_STOPPING_VOLUME';
      if (e.type === 'chart_pattern' && (e as any).patternType === 'double_bottom') return 'CLASSICAL_DOUBLE_BOTTOM';
      return e.type.toUpperCase();
    });

    const isFailedDownside = group.some(e =>
      (e.type === 'liquidity_sweep' && (e as any).targetType === 'ssl') ||
      (e.type === 'wyckoff' && (e as any).wyckoffType === 'spring') ||
      (e.type === 'vsa' && (e as any).vsaType === 'stopping_volume')
    );

    if (isFailedDownside) {
      mappings.push({
        canonicalType: 'FAILED_DOWNSIDE_AUCTION',
        matchedEvents: group,
        representations: Array.from(new Set(types)),
        timestamp
      });
    }
  }

  return mappings;
}
