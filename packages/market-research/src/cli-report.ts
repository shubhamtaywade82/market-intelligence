import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import { runUniversalStudy } from './study-runner.js';
import { buildEffectivenessMatrix, formatMatrixMarkdown, type EffectivenessMatrixReport, type TimeframeCell } from './matrix-report.js';
import { runWalkForwardValidation, formatStabilityMarkdown, type StabilitySummary } from './walk-forward.js';
import { DEFAULT_RESEARCH_CANDLE_COUNT } from './cli-market-data.js';
import type { BinanceKlineMarket } from './kline-market.js';

export const DEFAULT_TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h', '4h'];
export const DEFAULT_HORIZON_CANDLES = 24;

export type ResearchCliOptions = {
  timeframes?: Timeframe[];
  horizonCandles?: number;
  candleCount?: number;
  endTime?: number;
  format?: 'auto' | 'terminal' | 'markdown';
  klineMarket?: BinanceKlineMarket;
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
  const market = options.klineMarket ?? 'usdm_futures';
  const marketLabel = market === 'usdm_futures' ? 'Binance USDⓈ-M futures REST klines' : 'Binance spot REST klines';
  return [
    `*Data source: ${marketLabel} · symbol ${symbol} · lookback ~${candleCount} bars per TF · as-of ${endIso}*`,
    `*Series: ${tfSummary}*`
  ].join('\n');
}

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[90m',
  cyan: '\x1b[36m',
  boldCyan: '\x1b[1;36m',
  green: '\x1b[32m',
  boldGreen: '\x1b[1;32m',
  boldRed: '\x1b[1;31m'
};

export function shouldFormatTerminal(format?: 'auto' | 'terminal' | 'markdown'): boolean {
  if (format === 'terminal') return true;
  if (format === 'markdown') return false;
  // Default to markdown when piped or in CI to keep stream output clean and composable
  return Boolean(process.stdout?.isTTY);
}

function stripAnsi(text: string): string {
  // Strip escape codes to measure true printable character count in terminal cells
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function padCell(text: string, width: number): string {
  const visibleLen = stripAnsi(text).length;
  return text + ' '.repeat(Math.max(0, width - visibleLen));
}

function computeColWidths(headers: readonly string[], rows: readonly (readonly string[])[]): number[] {
  return headers.map((header, colIdx) => {
    const maxRowWidth = rows.reduce(
      (max, row) => Math.max(max, stripAnsi(row[colIdx] ?? '').length),
      0
    );
    return Math.max(stripAnsi(header).length, maxRowWidth);
  });
}

function renderBoxTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = computeColWidths(headers, rows);
  const top = '┌' + widths.map(w => '─'.repeat(w + 2)).join('┬') + '┐';
  const mid = '├' + widths.map(w => '─'.repeat(w + 2)).join('┼') + '┤';
  const bot = '└' + widths.map(w => '─'.repeat(w + 2)).join('┴') + '┘';

  const formatRow = (cells: readonly string[]): string =>
    '│ ' + cells.map((cell, i) => padCell(cell, widths[i]!)).join(' │ ') + ' │';

  const headerLine = formatRow(headers.map(h => `${ANSI.boldCyan}${h}${ANSI.reset}`));
  const bodyLines = rows.map(formatRow);
  return [top, headerLine, mid, ...bodyLines, bot].join('\n');
}

function formatTerminalCell(cell: TimeframeCell | undefined): string {
  if (!cell || cell.sampleSize === 0) return `${ANSI.dim}-${ANSI.reset}`;
  const pct = (cell.hitRateR2 * 100).toFixed(1);
  const ci = cell.ciLower !== undefined && cell.ciUpper !== undefined
    ? `${ANSI.dim}[${(cell.ciLower * 100).toFixed(0)}-${(cell.ciUpper * 100).toFixed(0)}%]${ANSI.reset}`
    : '';
  const star = cell.isSignificant ? `${ANSI.boldGreen}*${ANSI.reset}` : '';
  const uplift = cell.uplift !== undefined
    ? `${cell.uplift >= 0 ? '+' : ''}${(cell.uplift * 100).toFixed(1)}pp`
    : '';
  const meta = `${ANSI.dim}(${cell.medianMfeAtr.toFixed(1)} ATR, ${uplift}, n=${cell.sampleSize})${ANSI.reset}`;
  return `${ANSI.bold}${pct}%${ANSI.reset}${star} ${ci} ${meta}`.trim();
}

export function formatMatrixTerminal(report: EffectivenessMatrixReport, timeframes: readonly string[]): string {
  const headers = ['Component', ...timeframes.map(tf => `${tf} (+2R [95% CI] / MFE / Δ)`)];
  const rows = report.rows.map(row => {
    const comp = `${ANSI.bold}${row.component.toUpperCase()}${ANSI.reset}`;
    const cells = timeframes.map(tf => formatTerminalCell(row.cells[tf]));
    return [comp, ...cells];
  });
  const title = `${ANSI.boldCyan}# Effectiveness Matrix: ${report.symbol}${ANSI.reset}`;
  const note = `${ANSI.dim}* Asterisk (*) indicates statistically significant positive edge over baseline (p < 0.05)${ANSI.reset}`;
  return [title, note, '', renderBoxTable(headers, rows)].join('\n');
}

export function formatStabilityTerminal(stability: readonly StabilitySummary[]): string {
  const headers = ['Component', 'Windows', 'Train Hit Rate', 'Test Hit Rate', 'Degradation', 'Status'];
  const rows = stability.map(s => {
    const train = `${(s.meanTrainHitRateR2 * 100).toFixed(1)}%`;
    const test = `${(s.meanTestHitRateR2 * 100).toFixed(1)}%`;
    const deg = `${(s.hitRateDegradation * 100).toFixed(1)}pp`;
    const status = s.isStable
      ? `${ANSI.boldGreen}STABLE${ANSI.reset}`
      : `${ANSI.boldRed}DEGRADED${ANSI.reset}`;
    return [s.component.toUpperCase(), String(s.windowsCount), train, test, deg, status];
  });
  const title = `${ANSI.boldCyan}## Walk-Forward Stability (Out-of-Sample)${ANSI.reset}`;
  return [title, '', renderBoxTable(headers, rows)].join('\n');
}

export function buildResearchCliReport(
  symbol: string,
  candlesByTimeframe: Readonly<Partial<Record<Timeframe, readonly Candle[]>>>,
  options: ResearchCliOptions = {}
): string {
  const timeframes = options.timeframes ?? DEFAULT_TIMEFRAMES;
  const horizonCandles = options.horizonCandles ?? DEFAULT_HORIZON_CANDLES;
  const isTerminal = shouldFormatTerminal(options.format);

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
  const matrixStr = isTerminal
    ? formatMatrixTerminal(matrix, timeframes)
    : formatMatrixMarkdown(matrix, timeframes);
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
  const stabilityStr = isTerminal
    ? formatStabilityTerminal(wfResult.stability)
    : formatStabilityMarkdown(wfResult.stability);

  return `${provenance}\n\n${matrixStr}\n\n${stabilityStr}`;
}
