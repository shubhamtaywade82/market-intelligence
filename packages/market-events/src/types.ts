import { Decimal } from 'decimal.js';

export type Timeframe = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '8h' | '12h' | '1d' | '1w' | '1M';

export interface Candle {
  readonly timestamp: number;
  readonly open: Decimal;
  readonly high: Decimal;
  readonly low: Decimal;
  readonly close: Decimal;
  readonly volume: Decimal;
}

export type EventDirection = 'bullish' | 'bearish';

export interface BaseEvent {
  readonly id: string;
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly detectedAt: number;
  readonly originIndex: number;
  readonly direction: EventDirection;
}

export interface FvgEvent extends BaseEvent {
  readonly type: 'fvg';
  readonly top: Decimal;
  readonly bottom: Decimal;
  readonly consequentEncroachment: Decimal;
  readonly size: Decimal;
}

export type SwingType = 'high' | 'low';

export interface SwingPoint {
  readonly id: string;
  readonly type: SwingType;
  readonly index: number;
  readonly timestamp: number;
  readonly price: Decimal;
  readonly confirmedAtIndex: number;
}

export interface StructureBreakEvent extends BaseEvent {
  readonly type: 'bos' | 'choch' | 'mss';
  readonly brokenSwing: SwingPoint;
  readonly breakPrice: Decimal;
  readonly isCloseConfirmed: boolean;
}

export interface OrderBlockEvent extends BaseEvent {
  readonly type: 'order_block';
  readonly top: Decimal;
  readonly bottom: Decimal;
  readonly size: Decimal;
  readonly originCandleIndex: number;
}

export interface LiquiditySweepEvent extends BaseEvent {
  readonly type: 'liquidity_sweep';
  readonly sweptLevel: Decimal;
  readonly sweepExtreme: Decimal;
  readonly targetType: 'bsl' | 'ssl';
  readonly reclaimed: boolean;
}

export interface BreakerBlockEvent extends BaseEvent {
  readonly type: 'breaker_block';
  readonly top: Decimal;
  readonly bottom: Decimal;
  readonly size: Decimal;
  readonly originalOrderBlockId: string;
}

export interface InvertedFvgEvent extends BaseEvent {
  readonly type: 'ifvg';
  readonly top: Decimal;
  readonly bottom: Decimal;
  readonly size: Decimal;
  readonly originalFvgId: string;
}

export interface DisplacementEvent extends BaseEvent {
  readonly type: 'displacement';
  readonly magnitudeAtr: Decimal;
  readonly bodyRatio: Decimal;
  readonly candleIndex: number;
}
