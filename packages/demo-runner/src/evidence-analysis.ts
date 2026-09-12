import { createBinanceAdapter } from '@nemesis-oss/market-data';
import {
  detectFvg,
  detectOrderBlocks,
  detectLiquiditySweeps,
  detectBos,
  detectChoch,
  detectSwings,
  detectStructureBreaks,
  type Candle,
  type Timeframe
} from '@nemesis-oss/market-events';
import {
  runObservationStudy,
  analyzeAnchorInteraction,
  evaluateNegativeEvidenceImpact
} from '@nemesis-oss/market-research';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[90m',
  boldCyan: '\x1b[1;36m',
  boldGreen: '\x1b[1;32m',
  boldRed: '\x1b[1;31m',
  boldYellow: '\x1b[1;33m'
};

function stripAnsi(text: string): string {
  // Strip escape codes to measure true printable character count in terminal cells
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function padCell(text: string, width: number): string {
  const visibleLen = stripAnsi(text).length;
  return text + ' '.repeat(Math.max(0, width - visibleLen));
}

function renderBoxTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = headers.map((header, colIdx) => {
    const maxRowWidth = rows.reduce(
      (max, row) => Math.max(max, stripAnsi(row[colIdx] ?? '').length),
      0
    );
    return Math.max(stripAnsi(header).length, maxRowWidth);
  });
  const top = '┌' + widths.map(w => '─'.repeat(w + 2)).join('┬') + '┐';
  const mid = '├' + widths.map(w => '─'.repeat(w + 2)).join('┼') + '┤';
  const bot = '└' + widths.map(w => '─'.repeat(w + 2)).join('┴') + '┘';

  const formatRow = (cells: readonly string[]): string =>
    '│ ' + cells.map((cell, i) => padCell(cell, widths[i]!)).join(' │ ') + ' │';

  const headerLine = formatRow(headers.map(h => `${ANSI.boldCyan}${h}${ANSI.reset}`));
  const bodyLines = rows.map(formatRow);
  return [top, headerLine, mid, ...bodyLines, bot].join('\n');
}

async function fetchRecentCandles(symbol: string, timeframe: Timeframe, days: number): Promise<Candle[]> {
  const adapter = createBinanceAdapter();
  const endTime = Date.now();
  const startTime = endTime - days * 24 * 60 * 60 * 1000;
  const fetched = await adapter.fetchKlines({ symbol, timeframe, startTime, endTime });
  return [...fetched];
}

export async function runAlphaLeaderboard(symbol: string, timeframe: Timeframe = '15m'): Promise<string> {
  const candles = await fetchRecentCandles(symbol, timeframe, 14);
  const study = runObservationStudy(candles, { symbol, timeframe, horizonCandles: 24 });
  const sorted = [...study.results].sort((a, b) => b.hitRates.r2 - a.hitRates.r2);

  const headers = ['Rank', 'Component', 'Hit Rate (+2R)', 'Baseline', 'Uplift', 'FDR Sig', 'Verdict'];
  const rows = sorted.map((res, i) => {
    const rate = `${(res.hitRates.r2 * 100).toFixed(1)}%`;
    const base = res.baselineComparisonR2 ? `${(res.baselineComparisonR2.baselineProbability * 100).toFixed(1)}%` : '-';
    const uplift = res.baselineComparisonR2
      ? `${res.baselineComparisonR2.uplift >= 0 ? '+' : ''}${(res.baselineComparisonR2.uplift * 100).toFixed(1)}pp`
      : '-';
    const fdr = res.baselineComparisonR2?.isFdrSignificant ? `${ANSI.boldGreen}YES${ANSI.reset}` : `${ANSI.dim}NO${ANSI.reset}`;
    const verdict = res.baselineComparisonR2?.isFdrSignificant && res.baselineComparisonR2.uplift > 0
      ? `${ANSI.boldGreen}POSITIVE EDGE${ANSI.reset}`
      : res.hitRates.r2 > 0.5
        ? `${ANSI.boldYellow}MODERATE EDGE${ANSI.reset}`
        : `${ANSI.dim}NO EDGE / NOISE${ANSI.reset}`;
    return [String(i + 1), res.eventType.toUpperCase(), rate, base, uplift, fdr, verdict];
  });

  const title = `${ANSI.boldCyan}# Component Alpha Leaderboard: ${symbol} ${timeframe}${ANSI.reset}`;
  const meta = `${ANSI.dim}Evaluated on ${candles.length} candles · Horizon 24 bars · Matched-control FDR correction${ANSI.reset}`;
  return [title, meta, '', renderBoxTable(headers, rows)].join('\n');
}

export async function runConfluenceAnalysis(symbol: string, timeframe: Timeframe = '15m'): Promise<string> {
  const candles = await fetchRecentCandles(symbol, timeframe, 14);
  const swings = detectSwings(candles, { leftBars: 2, rightBars: 2 });
  const structure = detectStructureBreaks(candles, swings, { symbol, timeframe });
  const fvg = detectFvg(candles, { symbol, timeframe });
  const obs = detectOrderBlocks(candles, structure, { symbol, timeframe });
  const sweeps = detectLiquiditySweeps(candles, swings, { symbol, timeframe });
  const bos = detectBos(candles, swings, { symbol, timeframe });
  const choch = detectChoch(candles, swings, { symbol, timeframe });

  const study = runObservationStudy(candles, { symbol, timeframe, horizonCandles: 24 });
  const fvgItems = study.observations.filter(o => o.event.type === 'fvg');
  const obItems = study.observations.filter(o => o.event.type === 'order_block');
  const sweepItems = study.observations.filter(o => o.event.type === 'liquidity_sweep');

  const pairs = [
    { anchor: 'ORDER_BLOCK', secName: 'BOS', res: analyzeAnchorInteraction(obItems, bos, { maxBarGap: 3, targetMetric: 'hit2R' }) },
    { anchor: 'ORDER_BLOCK', secName: 'LIQUIDITY_SWEEP', res: analyzeAnchorInteraction(obItems, sweeps, { maxBarGap: 3, targetMetric: 'hit2R' }) },
    { anchor: 'FVG', secName: 'LIQUIDITY_SWEEP', res: analyzeAnchorInteraction(fvgItems, sweeps, { maxBarGap: 3, targetMetric: 'hit2R' }) },
    { anchor: 'FVG', secName: 'BOS', res: analyzeAnchorInteraction(fvgItems, bos, { maxBarGap: 3, targetMetric: 'hit2R' }) },
    { anchor: 'LIQUIDITY_SWEEP', secName: 'CHOCH', res: analyzeAnchorInteraction(sweepItems, choch, { maxBarGap: 3, targetMetric: 'hit2R' }) }
  ];

  const headers = ['Anchor', 'Confluence (+)', 'Solo Rate', 'With Confluence', 'Uplift', 'Redundancy', 'Synergy'];
  const rows = pairs.map(p => {
    const solo = `${(p.res.probAnchor * 100).toFixed(1)}%`;
    const conf = `${(p.res.probWithSecondary * 100).toFixed(1)}%`;
    const upliftVal = p.res.conditionalUplift * 100;
    const upliftStr = `${upliftVal >= 0 ? '+' : ''}${upliftVal.toFixed(1)}pp`;
    const red = `${(p.res.redundancyScore * 100).toFixed(0)}%`;
    const synergy = upliftVal > 3
      ? `${ANSI.boldGreen}SYNERGISTIC${ANSI.reset}`
      : p.res.redundancyScore > 0.6
        ? `${ANSI.boldYellow}REDUNDANT${ANSI.reset}`
        : `${ANSI.dim}NEUTRAL${ANSI.reset}`;
    return [p.anchor, p.secName, solo, conf, upliftStr, red, synergy];
  });

  const title = `${ANSI.boldCyan}# Multi-Component Confluence & Synergy: ${symbol} ${timeframe}${ANSI.reset}`;
  const meta = `${ANSI.dim}Evaluated within 3-bar proximity window on ${candles.length} bars${ANSI.reset}`;
  return [title, meta, '', renderBoxTable(headers, rows)].join('\n');
}

export async function runNegativeEvidenceAnalysis(symbol: string, timeframe: Timeframe = '15m'): Promise<string> {
  const candles = await fetchRecentCandles(symbol, timeframe, 14);
  const study = runObservationStudy(candles, { symbol, timeframe, horizonCandles: 24 });
  const eventTypes = ['order_block', 'fvg', 'liquidity_sweep', 'bos', 'choch'] as const;

  const results = eventTypes.map(type => {
    const obs = study.observations.filter(o => o.event.type === type);
    return { type, impact: evaluateNegativeEvidenceImpact(obs, '1h') };
  });

  const headers = ['Component', 'Aligned Rate', 'Conflicted Rate', 'Conflict Penalty', 'Net Score', 'Recommendation'];
  const rows = results.map(r => {
    const aligned = `${(r.impact.alignedHitRateR2 * 100).toFixed(1)}%`;
    const conflicted = `${(r.impact.conflictedHitRateR2 * 100).toFixed(1)}%`;
    const penalty = `${(r.impact.conflictPenalty * 100).toFixed(1)}pp`;
    const net = r.impact.netEvidenceScore.toFixed(2);
    const rec = r.impact.conflictPenalty < -0.05
      ? `${ANSI.boldRed}REQUIRE HTF ALIGNMENT${ANSI.reset}`
      : `${ANSI.dim}NEUTRAL FILTER${ANSI.reset}`;
    return [r.type.toUpperCase(), aligned, conflicted, penalty, net, rec];
  });

  const title = `${ANSI.boldCyan}# Negative Evidence & HTF Trend Conflict: ${symbol} ${timeframe}${ANSI.reset}`;
  const meta = `${ANSI.dim}Measures performance degradation when local setup conflicts with 1h HTF trend${ANSI.reset}`;
  return [title, meta, '', renderBoxTable(headers, rows)].join('\n');
}
