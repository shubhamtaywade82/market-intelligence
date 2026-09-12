import {
  createBinanceAdapter,
  createBinanceFuturesAdapter,
  type BinanceKlineMarket,
} from '@nemesis-oss/market-data';
import type { ExchangeAdapter } from '@nemesis-oss/market-data';

export type { BinanceKlineMarket };

/** Default for live perp research (align REST history with futures WS). */
export const DEFAULT_RESEARCH_KLINE_MARKET: BinanceKlineMarket = 'usdm_futures';

export function resolveResearchKlineMarket(raw?: string): BinanceKlineMarket {
  if (raw === 'spot' || raw === 'usdm_futures') return raw;
  if (raw === 'futures' || raw === 'perp') return 'usdm_futures';
  const fromEnv = process.env.RESEARCH_KLINE_MARKET;
  if (fromEnv === 'spot' || fromEnv === 'usdm_futures') return fromEnv;
  if (fromEnv === 'futures' || fromEnv === 'perp') return 'usdm_futures';
  return DEFAULT_RESEARCH_KLINE_MARKET;
}

export function createResearchBinanceAdapter(market: BinanceKlineMarket = DEFAULT_RESEARCH_KLINE_MARKET): ExchangeAdapter {
  return market === 'usdm_futures' ? createBinanceFuturesAdapter() : createBinanceAdapter();
}

export function datasetCacheFilename(symbol: string, timeframe: string, market: BinanceKlineMarket): string {
  const suffix = market === 'usdm_futures' ? 'usdm' : 'spot';
  return `${symbol.toUpperCase()}-${timeframe}-${suffix}.json`;
}
