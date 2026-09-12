import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import { parseResearchCliArgs, buildResearchCliReport, runResearchCli } from '../src/cli.js';
import type { ResearchCandleLoader } from '../src/cli-market-data.js';

function fixtureCandles(count: number, step: number, startPrice: number): Candle[] {
  const candles: Candle[] = [];
  let price = new Decimal(startPrice);
  const startTs = 1_700_000_000_000;
  for (let i = 0; i < count; i++) {
    const delta = new Decimal(step + (i % 7));
    const open = price;
    const close = open.plus(delta);
    candles.push({
      timestamp: startTs + i * 15 * 60 * 1000,
      open,
      high: Decimal.max(open, close).plus(5),
      low: Decimal.min(open, close).minus(5),
      close,
      volume: new Decimal(100 + i)
    });
    price = close;
  }
  return candles;
}

function mockLoader(series: Partial<Record<Timeframe, Candle[]>>): ResearchCandleLoader {
  return async (_symbol, timeframe) => series[timeframe] ?? fixtureCandles(400, 10, 50_000);
}

describe('Research CLI Runner', () => {
  it('generates multi-timeframe markdown effectiveness report for ETHUSDT', async () => {
    const report = await runResearchCli(
      'ETHUSDT',
      {},
      mockLoader({
        '5m': fixtureCandles(400, 12, 60_000),
        '15m': fixtureCandles(400, 14, 61_000),
        '1h': fixtureCandles(400, 16, 62_000),
        '4h': fixtureCandles(400, 18, 63_000)
      })
    );
    expect(report).toContain('# Effectiveness Matrix: ETHUSDT');
    expect(report).toContain('Binance USDⓈ-M futures REST klines');
    expect(report).toContain('| Component |');
    expect(report).toContain('FVG');
    expect(report).toContain('5m');
    expect(report).toContain('15m');
    expect(report).toContain('1h');
    expect(report).toContain('4h');
  });

  it('honors custom timeframes and horizon options', () => {
    const report = buildResearchCliReport(
      'ETHUSDT',
      {
        '15m': fixtureCandles(400, 20, 3000),
        '1h': fixtureCandles(400, 8, 3000)
      },
      { timeframes: ['15m', '1h'], horizonCandles: 12, candleCount: 400 }
    );
    expect(report).toContain('# Effectiveness Matrix: ETHUSDT');
    expect(report).toContain('15m');
    expect(report).toContain('1h');
    expect(report).not.toMatch(/\|\s*5m\s*\|/);
  });

  it('uses distinct candle series per timeframe in the matrix', () => {
    const report = buildResearchCliReport(
      'SOLUSDT',
      {
        '15m': fixtureCandles(400, 25, 100),
        '1h': fixtureCandles(400, 3, 5000)
      },
      { timeframes: ['15m', '1h'], candleCount: 400 }
    );
    const rowMatch = report.match(/\| FVG \| ([^|]+) \| ([^|]+) \|/);
    expect(rowMatch).not.toBeNull();
    expect(rowMatch![1]).not.toEqual(rowMatch![2]);
  });

  it('parses CLI flags including pnpm separator and format', () => {
    const parsed = parseResearchCliArgs([
      '--',
      '--symbol',
      'SOLUSDT',
      '--timeframes',
      '15m,4h',
      '--horizon',
      '48',
      '--lookback',
      '600',
      '--markdown'
    ]);
    expect(parsed).toEqual({
      symbol: 'SOLUSDT',
      timeframes: ['15m', '4h'],
      horizonCandles: 48,
      candleCount: 600,
      format: 'markdown'
    });
  });

  it('renders Unicode box table with ANSI colors when format is terminal', () => {
    const report = buildResearchCliReport(
      'ETHUSDT',
      {
        '15m': fixtureCandles(400, 20, 3000),
        '1h': fixtureCandles(400, 8, 3000)
      },
      { timeframes: ['15m', '1h'], candleCount: 400, format: 'terminal' }
    );
    expect(report).toContain('┌');
    expect(report).toContain('┐');
    expect(report).toContain('└');
    expect(report).toContain('┘');
    expect(report).toContain('│');
    expect(report).toContain('STABLE');
  });

  it('renders markdown table when format is markdown', () => {
    const report = buildResearchCliReport(
      'ETHUSDT',
      {
        '15m': fixtureCandles(400, 20, 3000),
        '1h': fixtureCandles(400, 8, 3000)
      },
      { timeframes: ['15m', '1h'], candleCount: 400, format: 'markdown' }
    );
    expect(report).toContain('| Component |');
    expect(report).toContain('| :--- |');
    expect(report).not.toContain('┌');
  });

  it('rejects invalid timeframe tokens', () => {
    expect(() => parseResearchCliArgs(['--timeframes', '15m,bogus'])).toThrow(/Invalid timeframe/);
  });
});
