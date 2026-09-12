import {
  createResearchBinanceAdapter,
  datasetCacheFilename,
  resolveResearchKlineMarket,
  type BinanceKlineMarket,
} from './kline-market.js';
import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import { timeframeToMs } from './multi-timeframe.js';

export const DEFAULT_RESEARCH_CANDLE_COUNT = 1000;
export const MIN_RESEARCH_CANDLE_COUNT = 320;

export type ResearchMarketDataOptions = {
  readonly endTime?: number;
  readonly candleCount?: number;
  readonly klineMarket?: BinanceKlineMarket;
};

export type ResearchCandleLoader = (
  symbol: string,
  timeframe: Timeframe,
  window: { startTime: number; endTime: number }
) => Promise<readonly Candle[]>;

function historyWindow(
  timeframe: Timeframe,
  candleCount: number,
  endTime: number
): { startTime: number; endTime: number } {
  const spanMs = timeframeToMs(timeframe) * candleCount;
  return { startTime: endTime - spanMs, endTime };
}

export async function fetchBinanceCandlesByTimeframe(
  symbol: string,
  timeframes: readonly Timeframe[],
  options: ResearchMarketDataOptions = {},
  loadCandles: ResearchCandleLoader = defaultBinanceCandleLoader
): Promise<Partial<Record<Timeframe, readonly Candle[]>>> {
  const endTime = options.endTime ?? Date.now();
  const candleCount = options.candleCount ?? DEFAULT_RESEARCH_CANDLE_COUNT;
  const market = options.klineMarket ?? resolveResearchKlineMarket();
  if (candleCount < MIN_RESEARCH_CANDLE_COUNT) {
    throw new Error(
      `--lookback must be at least ${MIN_RESEARCH_CANDLE_COUNT} candles (got ${candleCount})`
    );
  }

  const byTimeframe: Partial<Record<Timeframe, readonly Candle[]>> = {};
  for (const timeframe of timeframes) {
    const window = historyWindow(timeframe, candleCount, endTime);
    const candles = loadCandles === defaultBinanceCandleLoader
      ? await defaultBinanceCandleLoader(symbol, timeframe, window, market)
      : await loadCandles(symbol, timeframe, window);
    if (candles.length < MIN_RESEARCH_CANDLE_COUNT) {
      throw new Error(
        `Insufficient ${timeframe} Binance data for ${symbol}: ${candles.length} candles (need ${MIN_RESEARCH_CANDLE_COUNT}+)`
      );
    }
    byTimeframe[timeframe] = candles;
  }
  return byTimeframe;
}

export async function defaultBinanceCandleLoader(
  symbol: string,
  timeframe: Timeframe,
  window: { startTime: number; endTime: number },
  market: BinanceKlineMarket = resolveResearchKlineMarket()
): Promise<readonly Candle[]> {
  const adapter = createResearchBinanceAdapter(market);
  return adapter.fetchKlines({
    symbol,
    timeframe,
    startTime: window.startTime,
    endTime: window.endTime
  });
}
