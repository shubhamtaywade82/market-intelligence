import { describe, expect, it } from 'vitest';
import { parseResearchCliArgs, runResearchCli } from '../src/cli.js';

describe('Research CLI Runner', () => {
  it('generates multi-timeframe markdown effectiveness report for BTCUSDT', () => {
    const report = runResearchCli('BTCUSDT');
    expect(report).toContain('# Effectiveness Matrix: BTCUSDT');
    expect(report).toContain('| Component |');
    expect(report).toContain('FVG');
    expect(report).toContain('5m');
    expect(report).toContain('15m');
    expect(report).toContain('1h');
    expect(report).toContain('4h');
  });

  it('honors custom timeframes and horizon options', () => {
    const report = runResearchCli('ETHUSDT', {
      timeframes: ['15m', '1h'],
      horizonCandles: 12
    });
    expect(report).toContain('# Effectiveness Matrix: ETHUSDT');
    expect(report).toContain('15m');
    expect(report).toContain('1h');
    expect(report).not.toMatch(/\|\s*5m\s*\|/);
  });

  it('parses CLI flags including pnpm separator', () => {
    const parsed = parseResearchCliArgs(['--', '--symbol', 'SOLUSDT', '--timeframes', '15m,4h', '--horizon', '48']);
    expect(parsed).toEqual({
      symbol: 'SOLUSDT',
      timeframes: ['15m', '4h'],
      horizonCandles: 48
    });
  });

  it('rejects invalid timeframe tokens', () => {
    expect(() => parseResearchCliArgs(['--timeframes', '15m,bogus'])).toThrow(/Invalid timeframe/);
  });
});
