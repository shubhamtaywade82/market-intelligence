import { Decimal } from 'decimal.js';
import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import { calculateCausalAtr } from './study-runner.js';
import type { HtfRegimeSnapshot } from './types.js';

export { HtfRegimeSnapshot };

export type HtfCandlesMap = Readonly<Partial<Record<Timeframe, readonly Candle[]>>>;
export type MultiTimeframeSnapshot = Readonly<Partial<Record<Timeframe, HtfRegimeSnapshot>>>;

export function timeframeToMs(tf: Timeframe): number {
  switch (tf) {
    case '1m': return 60 * 1000;
    case '5m': return 5 * 60 * 1000;
    case '15m': return 15 * 60 * 1000;
    case '1h': return 60 * 60 * 1000;
    case '4h': return 4 * 60 * 60 * 1000;
    case '1d': return 24 * 60 * 60 * 1000;
    default: return 15 * 60 * 1000;
  }
}

/**
 * Returns candles from higher timeframe that were strictly COMPLETED prior to or at eventTimestamp.
 * Guarantees zero lookahead bias from unclosed higher timeframe candles.
 */
export function getCausalHtfCandles(
  htfCandles: readonly Candle[],
  eventTimestamp: number,
  htf: Timeframe
): readonly Candle[] {
  const durationMs = timeframeToMs(htf);
  // A HTF bar is only completed when eventTimestamp >= bar.timestamp + durationMs
  return htfCandles.filter(c => c.timestamp + durationMs <= eventTimestamp);
}

/**
 * Extracts causal multi-timeframe context strictly as-of event timestamp.
 */
export function extractCausalHtfContext(
  htfCandles: readonly Candle[],
  eventTimestamp: number,
  htf: Timeframe
): HtfRegimeSnapshot | null {
  const causalCandles = getCausalHtfCandles(htfCandles, eventTimestamp, htf);
  if (causalCandles.length < 2) return null;

  const lastIdx = causalCandles.length - 1;
  const last = causalCandles[lastIdx]!;
  const prev = causalCandles[Math.max(0, lastIdx - 5)]!;
  const causalAtr = calculateCausalAtr(causalCandles, lastIdx);

  const delta = last.close.minus(prev.close);
  const trend = delta.gt(causalAtr) ? 'bullish' : delta.lt(causalAtr.negated()) ? 'bearish' : 'sideways';

  return {
    timeframe: htf,
    causalCandleCount: causalCandles.length,
    lastCompletedTimestamp: last.timestamp,
    causalAtr,
    trend,
    lastClose: last.close
  };
}

/**
 * Extracts causal multi-timeframe snapshots across multiple higher timeframes.
 */
export function extractMultiTimeframeSnapshot(
  htfCandlesMap: HtfCandlesMap,
  eventTimestamp: number
): MultiTimeframeSnapshot {
  const result: Partial<Record<Timeframe, HtfRegimeSnapshot>> = {};
  for (const [tf, candles] of Object.entries(htfCandlesMap) as [Timeframe, readonly Candle[] | undefined][]) {
    if (candles && candles.length >= 2) {
      const snap = extractCausalHtfContext(candles, eventTimestamp, tf);
      if (snap) result[tf] = snap;
    }
  }
  return result;
}

