import { Decimal } from 'decimal.js';
import type { Timeframe } from '@nemesis-oss/market-events';

export interface EventOutcome {
  readonly eventId: string;
  readonly horizonCandles: number;
  readonly firstTouchIndex: number | null;
  readonly touch25: boolean;
  readonly touch50: boolean;
  readonly touch75: boolean;
  readonly fullFill: boolean;
  readonly mfe: Decimal;
  readonly mae: Decimal;
  readonly mfeAtr: Decimal;
  readonly maeAtr: Decimal;
  readonly hit1R: boolean;
  readonly hit2R: boolean;
  readonly hit3R: boolean;
}

export interface ComponentStudyResult {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly eventType: string;
  readonly sampleSize: number;
  readonly retestProbability: number;
  readonly fill25Rate: number;
  readonly fill50Rate: number;
  readonly fullFillRate: number;
  readonly medianMfeAtr: number;
  readonly medianMaeAtr: number;
  readonly hitRates: {
    readonly r1: number;
    readonly r2: number;
    readonly r3: number;
  };
}
