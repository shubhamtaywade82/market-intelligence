import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Timeframe } from '@nemesis-oss/market-events';
import {
  DEFAULT_RESEARCH_CANDLE_COUNT,
  fetchBinanceCandlesByTimeframe,
  type ResearchCandleLoader,
  type ResearchMarketDataOptions
} from './cli-market-data.js';
import {
  buildResearchCliReport,
  DEFAULT_HORIZON_CANDLES,
  DEFAULT_TIMEFRAMES,
  type ResearchCliOptions
} from './cli-report.js';

export type { ResearchCliOptions } from './cli-report.js';
export { buildResearchCliReport, DEFAULT_TIMEFRAMES, DEFAULT_HORIZON_CANDLES } from './cli-report.js';

const VALID_TIMEFRAMES = new Set<Timeframe>([
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '1w', '1M'
]);

export async function runResearchCli(
  symbol: string = 'ETHUSDT',
  options: ResearchCliOptions = {},
  loadCandles?: ResearchCandleLoader
): Promise<string> {
  const timeframes = options.timeframes ?? DEFAULT_TIMEFRAMES;
  const candleCount = options.candleCount ?? DEFAULT_RESEARCH_CANDLE_COUNT;
  const marketOptions: ResearchMarketDataOptions = {
    candleCount,
    ...(options.endTime !== undefined ? { endTime: options.endTime } : {})
  };
  const candlesByTimeframe = await fetchBinanceCandlesByTimeframe(
    symbol,
    timeframes,
    marketOptions,
    loadCandles
  );
  const reportOptions: ResearchCliOptions = { timeframes, candleCount };
  if (options.horizonCandles !== undefined) reportOptions.horizonCandles = options.horizonCandles;
  if (options.endTime !== undefined) reportOptions.endTime = options.endTime;
  return buildResearchCliReport(symbol, candlesByTimeframe, reportOptions);
}

function readFlagValue(args: readonly string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  if (!value || value.startsWith('-')) return undefined;
  return value;
}

function parseTimeframesArg(args: readonly string[]): Timeframe[] | undefined {
  const raw = readFlagValue(args, '--timeframes');
  if (!raw) return undefined;
  const parsed = raw.split(',').map(part => part.trim()).filter(Boolean);
  const invalid = parsed.filter(tf => !VALID_TIMEFRAMES.has(tf as Timeframe));
  if (invalid.length > 0) {
    throw new Error(`Invalid timeframe(s): ${invalid.join(', ')}`);
  }
  return parsed as Timeframe[];
}

function parseHorizonArg(args: readonly string[]): number | undefined {
  const raw = readFlagValue(args, '--horizon');
  if (!raw) return undefined;
  const horizon = Number.parseInt(raw, 10);
  if (!Number.isFinite(horizon) || horizon <= 0) {
    throw new Error(`Invalid --horizon value: ${raw}`);
  }
  return horizon;
}

function parseLookbackArg(args: readonly string[]): number | undefined {
  const raw = readFlagValue(args, '--lookback');
  if (!raw) return undefined;
  const lookback = Number.parseInt(raw, 10);
  if (!Number.isFinite(lookback) || lookback <= 0) {
    throw new Error(`Invalid --lookback value: ${raw}`);
  }
  return lookback;
}

function parseSymbolArg(args: readonly string[]): string {
  const fromFlag = readFlagValue(args, '--symbol');
  if (fromFlag) return fromFlag;
  const firstNonFlag = args.find(a => !a.startsWith('-'));
  return firstNonFlag ?? 'ETHUSDT';
}

export function parseResearchCliArgs(args: readonly string[]): {
  symbol: string;
  timeframes?: Timeframe[];
  horizonCandles?: number;
  candleCount?: number;
} {
  const timeframes = parseTimeframesArg(args);
  const horizonCandles = parseHorizonArg(args);
  const candleCount = parseLookbackArg(args);
  return {
    symbol: parseSymbolArg(args),
    ...(timeframes !== undefined ? { timeframes } : {}),
    ...(horizonCandles !== undefined ? { horizonCandles } : {}),
    ...(candleCount !== undefined ? { candleCount } : {})
  };
}

const isMainModule = (): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === path.resolve(entry);
};

async function runCliMain(): Promise<void> {
  const cliArgs = process.argv.slice(2).filter(arg => arg !== '--');
  const { symbol, timeframes, horizonCandles, candleCount } = parseResearchCliArgs(cliArgs);
  const options: ResearchCliOptions = {};
  if (timeframes !== undefined) options.timeframes = timeframes;
  if (horizonCandles !== undefined) options.horizonCandles = horizonCandles;
  if (candleCount !== undefined) options.candleCount = candleCount;
  const output = await runResearchCli(symbol, options);
  process.stdout.write(`${output}\n`);
}

if (isMainModule()) {
  runCliMain().catch(err => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`market-research cli: ${message}\n`);
    process.exitCode = 1;
  });
}
