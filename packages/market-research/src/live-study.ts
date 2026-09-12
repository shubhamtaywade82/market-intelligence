import path from 'node:path';
import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import { loadDataset, saveDataset } from './data/dataset-store.js';
import {
  createResearchBinanceAdapter,
  datasetCacheFilename,
  resolveResearchKlineMarket,
  type BinanceKlineMarket,
} from './kline-market.js';
import { buildEffectivenessMatrix, formatMatrixMarkdown } from './matrix-report.js';
import { runObservationStudy } from './study-runner.js';
import { formatStabilityMarkdown, runWalkForwardValidation } from './walk-forward.js';
import { formatMatrixTerminal, formatStabilityTerminal, shouldFormatTerminal } from './cli-report.js';

export interface LiveStudyFromCandlesOptions {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly horizonCandles?: number | undefined;
  readonly datasetPath?: string | undefined;
  readonly format?: 'auto' | 'terminal' | 'markdown' | undefined;
  readonly klineMarket?: BinanceKlineMarket | undefined;
}

export interface LiveStudyOptions extends LiveStudyFromCandlesOptions {
  readonly days?: number | undefined;
  readonly dataDir?: string | undefined;
  readonly useCache?: boolean | undefined;
}

async function fetchCandles(
  symbol: string,
  timeframe: Timeframe,
  days: number,
  market: BinanceKlineMarket
): Promise<Candle[]> {
  const endTime = Date.now();
  const startTime = endTime - days * 24 * 60 * 60 * 1000;
  const adapter = createResearchBinanceAdapter(market);
  const fetched = await adapter.fetchKlines({ symbol, timeframe, startTime, endTime });
  return [...fetched];
}

function walkForwardSizing(candleCount: number): {
  trainCandlesCount: number;
  testCandlesCount: number;
  stepCandlesCount: number;
} {
  const testCandlesCount = Math.max(50, Math.floor(candleCount * 0.2));
  const trainCandlesCount = Math.max(200, Math.floor(candleCount * 0.6));
  return { trainCandlesCount, testCandlesCount, stepCandlesCount: testCandlesCount };
}

/**
 * Format a full markdown report from an in-memory candle series (no network).
 */
export function runLiveStudyFromCandles(
  candles: readonly Candle[],
  options: LiveStudyFromCandlesOptions
): string {
  if (candles.length < 100) {
    throw new Error(`Insufficient candles (${candles.length}); need at least 100 for walk-forward.`);
  }

  const horizonCandles = options.horizonCandles ?? 24;
  const study = runObservationStudy(candles, {
    symbol: options.symbol,
    timeframe: options.timeframe,
    horizonCandles
  });
  const isTerminal = shouldFormatTerminal(options.format);
  const matrix = buildEffectivenessMatrix(options.symbol, study.results);
  const matrixStr = isTerminal
    ? formatMatrixTerminal(matrix, [options.timeframe])
    : formatMatrixMarkdown(matrix, [options.timeframe]);
  const wfSizes = walkForwardSizing(candles.length);
  const wf = runWalkForwardValidation(candles, {
    symbol: options.symbol,
    timeframe: options.timeframe,
    ...wfSizes,
    horizonCandles,
    warmupBars: 50
  });
  const stabilityStr = isTerminal
    ? formatStabilityTerminal(wf.stability)
    : formatStabilityMarkdown(wf.stability);

  const lines = [
    `# Live study: ${options.symbol} ${options.timeframe}`,
    `Candles: ${candles.length}`,
    ...(options.klineMarket ? [`Kline market: ${options.klineMarket}`] : []),
    ...(options.datasetPath ? [`Dataset: ${options.datasetPath}`] : []),
    '',
    matrixStr,
    '',
    stabilityStr
  ];
  return lines.join('\n');
}

/**
 * Fetch (or load cached) BTC/alt candles from Binance, persist JSON, run study + walk-forward.
 */
export async function runLiveMarketStudy(options: LiveStudyOptions = {
  symbol: 'BTCUSDT',
  timeframe: '15m'
}): Promise<string> {
  const symbol = options.symbol;
  const timeframe = options.timeframe;
  const days = options.days ?? 30;
  const market = options.klineMarket ?? resolveResearchKlineMarket();
  const dataDir = options.dataDir ?? path.join(process.cwd(), '.datasets');
  const useCache = options.useCache ?? true;
  const cachePath = path.join(dataDir, datasetCacheFilename(symbol, timeframe, market));

  let candles: Candle[];
  if (useCache) {
    try {
      candles = (await loadDataset(cachePath)).candles;
    } catch {
      candles = await fetchCandles(symbol, timeframe, days, market);
      await saveDataset(dataDir, symbol, timeframe, candles, market === 'usdm_futures' ? 'usdm' : 'spot');
    }
  } else {
    candles = await fetchCandles(symbol, timeframe, days, market);
    await saveDataset(dataDir, symbol, timeframe, candles, market === 'usdm_futures' ? 'usdm' : 'spot');
  }

  return runLiveStudyFromCandles(candles, {
    symbol,
    timeframe,
    horizonCandles: options.horizonCandles,
    datasetPath: cachePath,
    format: options.format,
    klineMarket: market
  });
}
