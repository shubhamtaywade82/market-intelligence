import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Timeframe } from '@nemesis-oss/market-events';
import { resolveResearchKlineMarket, type BinanceKlineMarket } from './kline-market.js';
import { runLiveMarketStudy } from './live-study.js';

const VALID_TIMEFRAMES = new Set<Timeframe>([
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '1w', '1M'
]);

function readFlagValue(args: readonly string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  if (!value || value.startsWith('-')) return undefined;
  return value;
}

function parseFormatArg(args: readonly string[]): 'auto' | 'terminal' | 'markdown' | undefined {
  if (args.includes('--markdown')) return 'markdown';
  if (args.includes('--terminal')) return 'terminal';
  const raw = readFlagValue(args, '--format');
  if (raw === 'markdown' || raw === 'terminal' || raw === 'auto') return raw;
  return undefined;
}

function parseArgs(args: readonly string[]): {
  symbol: string;
  timeframe: Timeframe;
  days: number;
  horizon: number;
  dataDir: string;
  refresh: boolean;
  format?: 'auto' | 'terminal' | 'markdown';
  klineMarket: BinanceKlineMarket;
} {
  const symbol = readFlagValue(args, '--symbol') ?? 'BTCUSDT';
  const tfRaw = readFlagValue(args, '--timeframe') ?? '15m';
  if (!VALID_TIMEFRAMES.has(tfRaw as Timeframe)) {
    throw new Error(`Invalid --timeframe: ${tfRaw}`);
  }
  const daysRaw = readFlagValue(args, '--days') ?? '30';
  const days = Number.parseInt(daysRaw, 10);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`Invalid --days: ${daysRaw}`);
  }
  const horizonRaw = readFlagValue(args, '--horizon') ?? '24';
  const horizon = Number.parseInt(horizonRaw, 10);
  if (!Number.isFinite(horizon) || horizon <= 0) {
    throw new Error(`Invalid --horizon: ${horizonRaw}`);
  }
  const dataDir = readFlagValue(args, '--data-dir') ?? path.join(process.cwd(), '.datasets');
  const refresh = args.includes('--refresh');
  const format = parseFormatArg(args);
  const marketRaw = readFlagValue(args, '--market');
  const klineMarket = resolveResearchKlineMarket(marketRaw);
  return {
    symbol,
    timeframe: tfRaw as Timeframe,
    days,
    horizon,
    dataDir,
    refresh,
    klineMarket,
    ...(format !== undefined ? { format } : {})
  };
}

const isMainModule = (): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === path.resolve(entry);
};

if (isMainModule()) {
  const cliArgs = process.argv.slice(2).filter(arg => arg !== '--');
  try {
    const parsed = parseArgs(cliArgs);
    const output = await runLiveMarketStudy({
      symbol: parsed.symbol,
      timeframe: parsed.timeframe,
      days: parsed.days,
      horizonCandles: parsed.horizon,
      dataDir: parsed.dataDir,
      useCache: !parsed.refresh,
      klineMarket: parsed.klineMarket,
      ...(parsed.format !== undefined ? { format: parsed.format } : {})
    });
    process.stdout.write(`${output}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`market-research live-study: ${message}\n`);
    process.exitCode = 1;
  }
}
