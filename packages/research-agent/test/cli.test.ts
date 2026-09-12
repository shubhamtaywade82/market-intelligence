import { describe, expect, it } from 'vitest';
import { parseResearchAgentCliArgs, DEFAULT_RESEARCH_QUESTION } from '../src/cli-args.js';

describe('research-agent CLI args', () => {
  it('parses symbol, timeframe, days, and question flag', () => {
    const parsed = parseResearchAgentCliArgs([
      '--symbol', 'ETHUSDT',
      '--timeframe', '1h',
      '--days', '21',
      '--question', 'Is BOS continuation significant?',
    ]);
    expect(parsed.symbol).toBe('ETHUSDT');
    expect(parsed.timeframe).toBe('1h');
    expect(parsed.days).toBe(21);
    expect(parsed.question).toBe('Is BOS continuation significant?');
  });

  it('uses default question when omitted', () => {
    const parsed = parseResearchAgentCliArgs(['--symbol', 'BTCUSDT']);
    expect(parsed.question).toBe(DEFAULT_RESEARCH_QUESTION);
  });

  it('rejects invalid timeframe tokens', () => {
    expect(() => parseResearchAgentCliArgs(['--timeframe', '2m'])).toThrow(/Invalid --timeframe/);
  });
});
