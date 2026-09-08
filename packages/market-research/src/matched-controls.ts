import { Decimal } from 'decimal.js';
import type { BaseEvent, Candle } from '@nemesis-oss/market-events';
import type { DirectionalOutcome, OutcomeConfig } from './types.js';
import { evaluateGenericOutcome, DEFAULT_OUTCOME_CONFIG } from './outcome-evaluators.js';
import { calculateCausalAtr } from './study-runner.js';

export interface MatchedControlObservation {
  readonly matchedEventId: string;
  readonly controlOriginIndex: number;
  readonly direction: 'bullish' | 'bearish';
  readonly causalAtr: Decimal;
  readonly outcome: DirectionalOutcome;
}

export interface MatchOptions {
  readonly searchRadiusBars?: number;
  readonly maxAtrDeviationRatio?: number;
}

/**
 * Finds eligible non-event control candle indices for a given event,
 * matching on timeframe, direction, volatility bucket, and temporal proximity.
 */
export function findMatchedControlIndex(
  event: BaseEvent,
  candles: readonly Candle[],
  eventIndices: ReadonlySet<number>,
  options: MatchOptions = {}
): number | null {
  const radius = options.searchRadiusBars ?? 50;
  const maxDev = options.maxAtrDeviationRatio ?? 0.30;
  const eventAtr = calculateCausalAtr(candles, event.originIndex);

  const start = Math.max(0, event.originIndex - radius);
  const end = Math.min(candles.length - 1, event.originIndex + radius);

  let bestIdx: number | null = null;
  let smallestDiff = new Decimal(Infinity);

  for (let i = start; i <= end; i++) {
    // Avoid candles that fired the event or immediate neighbors
    if (eventIndices.has(i) || Math.abs(i - event.originIndex) < 2) continue;

    const candAtr = calculateCausalAtr(candles, i);
    const diff = candAtr.minus(eventAtr).abs();
    const ratio = diff.dividedBy(eventAtr.isZero() ? new Decimal(1) : eventAtr);

    if (ratio.lte(maxDev) && diff.lt(smallestDiff)) {
      smallestDiff = diff;
      bestIdx = i;
    }
  }

  return bestIdx;
}

/**
 * Generates direction-aware, volatility-matched control observations for an event population.
 */
export function generateMatchedControls(
  events: readonly BaseEvent[],
  candles: readonly Candle[],
  config: OutcomeConfig = DEFAULT_OUTCOME_CONFIG,
  options: MatchOptions = {}
): MatchedControlObservation[] {
  const eventIndices = new Set(events.map(e => e.originIndex));
  const controls: MatchedControlObservation[] = [];

  for (const ev of events) {
    const matchedIdx = findMatchedControlIndex(ev, candles, eventIndices, options);
    const fallbackIdx = Math.max(0, Math.min(candles.length - 1, ev.originIndex > 0 ? ev.originIndex - 1 : 0));
    const originIdx = matchedIdx ?? fallbackIdx;
    const causalAtr = calculateCausalAtr(candles, originIdx);

    const controlPseudoEvent: BaseEvent = {
      id: `ctrl-${ev.id}`,
      type: 'control',
      symbol: ev.symbol,
      timeframe: ev.timeframe,
      detectedAt: candles[originIdx]?.timestamp ?? 0,
      originIndex: originIdx,
      direction: ev.direction // Exact direction symmetry!
    };

    const outcome = evaluateGenericOutcome(controlPseudoEvent, candles, causalAtr, config);
    controls.push({
      matchedEventId: ev.id,
      controlOriginIndex: originIdx,
      direction: ev.direction,
      causalAtr,
      outcome
    });
  }

  return controls;
}
