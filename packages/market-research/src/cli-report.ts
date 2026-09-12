import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import { runUniversalStudy } from './study-runner.js';
import { buildEffectivenessMatrix, formatMatrixMarkdown } from './matrix-report.js';
import { runWalkForwardValidation, formatStabilityMarkdown } from './walk-forward.js';
import type { ResearchMarketDataOptions } from './cli-market-data.js';
import { DEFAULT_RESEARCH_CANDLE_COUNT } from './cli-market-data.js';

export const DEFAULT_TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h', '4h'];
export const DEFAULT_HORIZON_CANDLES = 24;

export type ResearchCliOptions = {
  timeframes?: Timeframe[];
  horizonCandles?: number;
  candleCount?: number;
  endTime?: number;
};

function walkForwardSizing(candleCount: number): {
  trainCandlesCount: number;
  testCandlesCount: number;
  stepCandlesCount: number;
} {
  const trainCandlesCount = Math.min(160, Math.floor(candleCount * 0.45));
  const testCandlesCount = Math.min(80, Math.floor(candleCount * 0.2));
  const stepCandlesCount = Math.max(20, Math.floor(testCandlesCount / 2));
  return { trainCandlesCount, testCandlesCount, stepCandlesCount };
}

export function formatResearchProvenance(
  symbol: string,
  candlesByTimeframe: Readonly<Partial<Record<Timeframe, readonly Candle[]>>>,
  timeframes: readonly Timeframe[],
  options: ResearchCliOptions
): string {
  const candleCount = options.candleCount ?? DEFAULT_RESEARCH_CANDLE_COUNT;
  const endIso = new Date(options.endTime ?? Date.now()).toISOString();
  const tfSummary = timeframes
    .map(tf => {
      const n = candlesByTimeframe[tf]?.length ?? 0;
      const from = candlesByTimeframe[tf]?.[0]?.timestamp;
      const to = candlesByTimeframe[tf]?.[n - 1]?.timestamp;
      const range =
        from !== undefined && to !== undefined
          ? `${new Date(from).toISOString()} → ${new Date(to).toISOString()}`
          : 'n/a';
      return `${tf}: ${n} bars (${range})`;
    })
    .join(' · ');
  return [
    `*Data source: Binance spot REST klines · symbol ${symbol} · lookback ~${candleCount} bars per TF · as-of ${endIso}*`,
    `*Series: ${tfSummary}*`
  ].join('\n');
}

export function buildResearchCliReport(
  symbol: string,
  candlesByTimeframe: Readonly<Partial<Record<Timeframe, readonly Candle[]>>>,
  options: ResearchCliOptions = {}
): string {
  const timeframes = options.timeframes ?? DEFAULT_TIMEFRAMES;
  const horizonCandles = options.horizonCandles ?? DEFAULT_HORIZON_CANDLES;

  const allStudies = timeframes.flatMap(tf => {
    const candles = candlesByTimeframe[tf];
    if (!candles?.length) {
      throw new Error(`Missing candle series for timeframe ${tf}`);
    }
    return runUniversalStudy(candles, {
      symbol,
      timeframe: tf,
      horizonCandles
    });
  });

  const matrix = buildEffectivenessMatrix(symbol, allStudies);
  const matrixMd = formatMatrixMarkdown(matrix, timeframes);
  const provenance = formatResearchProvenance(symbol, candlesByTimeframe, timeframes, options);

  const wfTimeframe = timeframes.includes('15m') ? '15m' : timeframes[0]!;
  const wfCandles = candlesByTimeframe[wfTimeframe];
  if (!wfCandles?.length) {
    throw new Error(`Missing candle series for walk-forward timeframe ${wfTimeframe}`);
  }

  const wfSizing = walkForwardSizing(wfCandles.length);
  const wfResult = runWalkForwardValidation(wfCandles, {
    symbol,
    timeframe: wfTimeframe,
    ...wfSizing,
    horizonCandles
  });
  const stabilityMd = formatStabilityMarkdown(wfResult.stability);

  return `${provenance}\n\n${matrixMd}\n\n${stabilityMd}`;
}
