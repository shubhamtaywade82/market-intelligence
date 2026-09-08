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
  readonly type: string;
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

export type VsaEventType =
  | 'stopping_volume'
  | 'no_demand'
  | 'no_supply'
  | 'effort_vs_result'
  | 'climax';

export interface VsaEvent extends BaseEvent {
  readonly type: 'vsa';
  readonly vsaType: VsaEventType;
  readonly volumeRatio: Decimal;
  readonly spreadRatio: Decimal;
}

export interface DerivativesSnapshot {
  readonly timestamp: number;
  readonly openInterest: Decimal;
  readonly fundingRate: Decimal;
  readonly takerBuyVolume: Decimal;
  readonly takerSellVolume: Decimal;
}

export type DerivativesEventType =
  | 'oi_expansion'
  | 'oi_contraction'
  | 'funding_extreme'
  | 'aggressive_taker_flow';

export interface DerivativesEvent extends BaseEvent {
  readonly type: 'derivatives';
  readonly derivativesType: DerivativesEventType;
  readonly metricValue: Decimal;
  readonly baselineValue: Decimal;
}

export type WyckoffEventType =
  | 'spring'
  | 'upthrust'
  | 'selling_climax'
  | 'buying_climax'
  | 'sign_of_strength'
  | 'sign_of_weakness';

export interface WyckoffEvent extends BaseEvent {
  readonly type: 'wyckoff';
  readonly wyckoffType: WyckoffEventType;
  readonly referenceLevel: Decimal;
  readonly extremePrice: Decimal;
}

export type ChartPatternType =
  | 'double_top'
  | 'double_bottom'
  | 'ascending_triangle'
  | 'descending_triangle';

export interface ChartPatternEvent extends BaseEvent {
  readonly type: 'chart_pattern';
  readonly patternType: ChartPatternType;
  readonly firstLevel: Decimal;
  readonly secondLevel: Decimal;
  readonly neckline: Decimal;
}

export type HarmonicPatternType = 'gartley' | 'bat' | 'butterfly' | 'crab';

export interface HarmonicPatternEvent extends BaseEvent {
  readonly type: 'harmonic';
  readonly harmonicType: HarmonicPatternType;
  readonly xPrice: Decimal;
  readonly aPrice: Decimal;
  readonly bPrice: Decimal;
  readonly cPrice: Decimal;
  readonly dPrice: Decimal;
  readonly prz: { readonly top: Decimal; readonly bottom: Decimal };
}
