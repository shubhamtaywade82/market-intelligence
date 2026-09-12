import { describe, it, expect } from 'vitest';
import { Decimal } from 'decimal.js';
import type { Candle } from '@nemesis-oss/market-events';

import { createResearchAgent } from '../src/agent.js';
import type { ResearchContext } from '../src/context.js';

const FIFTEEN_MIN = 15 * 60_000;

function makeCandles(count: number, startTs = 1_700_000_000_000): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    const drift = Math.sin(i / 13) * 0.8 + Math.sin(i / 47) * 0.4;
    const open = price;
    const close = price + drift + (i % 7 === 0 ? -2.5 : 0);
    const high = Math.max(open, close) + Math.abs(Math.sin(i / 3)) * 1.2;
    const low = Math.min(open, close) - Math.abs(Math.cos(i / 3)) * 1.2;
    const volume = 1000 + Math.abs(Math.sin(i / 5)) * 500;
    candles.push({
      timestamp: startTs + i * FIFTEEN_MIN,
      open: new Decimal(open.toFixed(4)),
      high: new Decimal(high.toFixed(4)),
      low: new Decimal(low.toFixed(4)),
      close: new Decimal(close.toFixed(4)),
      volume: new Decimal(volume.toFixed(4)),
    });
    price = close;
  }
  return candles;
}

function makeContext(): ResearchContext {
  return { symbol: 'BTCUSDT', timeframe: '15m', candles: makeCandles(400) };
}

describe('research-agent smoke (no LLM)', () => {
  it('runs detect → study → walk-forward tools in sequence', async () => {
    const agent = createResearchAgent(makeContext());

    const detect = await agent.invokeTool('detect_events', { eventType: 'fvg' });
    expect(detect.success).toBe(true);
    expect(detect.trustLevel).toBe('verified');
    const detectOut = detect.output as { count: number };
    expect(detectOut.count).toBeGreaterThanOrEqual(0);

    const study = await agent.invokeTool('run_study', { horizonCandles: 24, ambiguityPolicy: 'pessimistic' });
    expect(study.success).toBe(true);
    const studyOut = study.output as { results: unknown[]; multipleTesting: unknown };
    expect(studyOut.results.length).toBeGreaterThan(0);
    expect(studyOut.multipleTesting).toBeDefined();

    const wf = await agent.invokeTool('run_walk_forward', {
      trainCandlesCount: 200,
      testCandlesCount: 80,
      stepCandlesCount: 80,
      horizonCandles: 24,
    });
    expect(wf.success).toBe(true);
    const wfOut = wf.output as { stabilityMarkdown: string };
    expect(wfOut.stabilityMarkdown).toContain('Walk-Forward');
  });
});
