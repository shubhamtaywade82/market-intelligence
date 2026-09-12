import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Decimal } from 'decimal.js';
import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import { runUniversalStudy } from './study-runner.js';
import { buildEffectivenessMatrix, formatMatrixMarkdown } from './matrix-report.js';
import { runWalkForwardValidation, formatStabilityMarkdown } from './walk-forward.js';

const DEFAULT_TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h', '4h'];
const DEFAULT_HORIZON_CANDLES = 24;
const VALID_TIMEFRAMES = new Set<Timeframe>([
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '1w', '1M'
]);

export type ResearchCliOptions = {
  timeframes?: Timeframe[];
  horizonCandles?: number;
};

function generateRealisticCandles(count: number, basePrice: number = 60000): Candle[] {
  const candles: Candle[] = [];
  let currentPrice = new Decimal(basePrice);
  const startTs = Date.now() - count * 15 * 60 * 1000;

  for (let i = 0; i < count; i++) {
    // Multi-cycle trending and pulling-back waves designed to generate structural breaks and order blocks
    const cycle = i % 40;
    let step = 0;

    if (cycle < 10) step = 15;        // initial climb
    else if (cycle < 16) step = -20;   // retracement establishing swing high
    else if (cycle < 26) step = 30;    // powerful expansion breaking the swing high (BOS + OB)
    else if (cycle < 32) step = -15;   // pullback
    else step = 10;                    // continuation

    const deltaDec = new Decimal(step * 4);
    const open = currentPrice;
    const close = open.plus(deltaDec);
    const wickHigh = step > 0 ? 25 : 10;
    const wickLow = step < 0 ? 25 : 10;
    const high = Decimal.max(open, close).plus(wickHigh);
    const low = Decimal.min(open, close).minus(wickLow);
    const volume = new Decimal(100 + Math.abs(step) * 10);

    candles.push({
      timestamp: startTs + i * 15 * 60 * 1000,
      open,
      high,
      low,
      close,
      volume
    });

    currentPrice = close;
  }

  return candles;
}

/**
 * Main execution function for running research studies across all components and timeframes.
 */
export function runResearchCli(
  symbol: string = 'BTCUSDT',
  options: ResearchCliOptions = {}
): string {
  const timeframes = options.timeframes ?? DEFAULT_TIMEFRAMES;
  const horizonCandles = options.horizonCandles ?? DEFAULT_HORIZON_CANDLES;
  const sampleCandles = generateRealisticCandles(320, 65000);

  const allStudies = timeframes.flatMap(tf => {
    return runUniversalStudy(sampleCandles, {
      symbol,
      timeframe: tf,
      horizonCandles
    });
  });

  const matrix = buildEffectivenessMatrix(symbol, allStudies);
  const matrixMd = formatMatrixMarkdown(matrix, timeframes);

  const wfTimeframe = timeframes.includes('15m') ? '15m' : timeframes[0]!;
  const wfResult = runWalkForwardValidation(sampleCandles, {
    symbol,
    timeframe: wfTimeframe,
    trainCandlesCount: 160,
    testCandlesCount: 80,
    stepCandlesCount: 40,
    horizonCandles
  });
  const stabilityMd = formatStabilityMarkdown(wfResult.stability);

  return `${matrixMd}\n\n${stabilityMd}`;
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

function parseSymbolArg(args: readonly string[]): string {
  const fromFlag = readFlagValue(args, '--symbol');
  if (fromFlag) return fromFlag;
  const firstNonFlag = args.find(a => !a.startsWith('-'));
  return firstNonFlag ?? 'BTCUSDT';
}

export function parseResearchCliArgs(args: readonly string[]): {
  symbol: string;
  timeframes?: Timeframe[];
  horizonCandles?: number;
} {
  const timeframes = parseTimeframesArg(args);
  const horizonCandles = parseHorizonArg(args);
  return {
    symbol: parseSymbolArg(args),
    ...(timeframes !== undefined ? { timeframes } : {}),
    ...(horizonCandles !== undefined ? { horizonCandles } : {})
  };
}

const isMainModule = (): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === path.resolve(entry);
};

if (isMainModule()) {
  try {
    const cliArgs = process.argv.slice(2).filter(arg => arg !== '--');
    const { symbol, timeframes, horizonCandles } = parseResearchCliArgs(cliArgs);
    const options: ResearchCliOptions = {};
    if (timeframes !== undefined) options.timeframes = timeframes;
    if (horizonCandles !== undefined) options.horizonCandles = horizonCandles;
    const output = runResearchCli(symbol, options);
    process.stdout.write(`${output}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`market-research cli: ${message}\n`);
    process.exitCode = 1;
  }
}
