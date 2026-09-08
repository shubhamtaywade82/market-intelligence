import { Decimal } from 'decimal.js';
import type { BaseEvent, Timeframe } from '@nemesis-oss/market-events';

export interface DirectionalOutcome {
  readonly eventId: string;
  readonly horizonCandles: number;
  readonly mfe: Decimal;
  readonly mae: Decimal;
  readonly mfeAtr: Decimal;
  readonly maeAtr: Decimal;
  readonly hit1R: boolean;
  readonly hit2R: boolean;
  readonly hit3R: boolean;
}

export interface ZoneOutcome extends DirectionalOutcome {
  readonly firstTouchIndex: number | null;
  readonly touch25: boolean;
  readonly touch50: boolean;
  readonly touch75: boolean;
  readonly fullFill: boolean;
}

export type EventOutcome = ZoneOutcome | DirectionalOutcome;

export interface ComponentStudyResult {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly eventType: string;
  readonly sampleSize: number;
  readonly retestProbability: number | null;
  readonly fill25Rate: number | null;
  readonly fill50Rate: number | null;
  readonly fullFillRate: number | null;
  readonly medianMfeAtr: number;
  readonly medianMaeAtr: number;
  readonly hitRates: {
    readonly r1: number;
    readonly r2: number;
    readonly r3: number;
  };
  readonly confidenceIntervalR2?: {
    readonly lower: number;
    readonly upper: number;
  };
  readonly baselineComparisonR2?: {
    readonly baselineProbability: number;
    readonly uplift: number;
    readonly isStatisticallySignificant: boolean;
    readonly pValueEstimate: number;
  };
}

export interface ContextSnapshot {
  readonly atr: Decimal;
  readonly trendRegime: 'bullish' | 'bearish' | 'range';
  readonly volatilityRegime: 'low' | 'normal' | 'high';
}

export interface ResearchObservation {
  readonly event: BaseEvent;
  readonly context: ContextSnapshot;
  readonly outcome: EventOutcome;
}
