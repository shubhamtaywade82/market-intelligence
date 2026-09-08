import { describe, expect, it } from 'vitest';
import { runResearchCli } from '../src/cli.js';

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
});
