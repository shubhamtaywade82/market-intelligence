import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import type { Candle } from '@nemesis-oss/market-events';

import { createResearchAgent } from '../src/agent.js';
import { checkOllamaReady } from '../src/ollama-preflight.js';

const runIntegration = process.env.OLLAMA_INTEGRATION === '1';

const FIFTEEN_MIN = 15 * 60_000;

function makeCandles(count: number): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    const drift = Math.sin(i / 13) * 0.8 + Math.sin(i / 47) * 0.4;
    const open = price;
    const close = price + drift + (i % 7 === 0 ? -2.5 : 0);
    candles.push({
      timestamp: 1_700_000_000_000 + i * FIFTEEN_MIN,
      open: new Decimal(open.toFixed(4)),
      high: new Decimal((Math.max(open, close) + 1.2).toFixed(4)),
      low: new Decimal((Math.min(open, close) - 1.2).toFixed(4)),
      close: new Decimal(close.toFixed(4)),
      volume: new Decimal(1000),
    });
    price = close;
  }
  return candles;
}

describe.skipIf(!runIntegration)('Ollama integration', () => {
  it('preflight sees a local model', async () => {
    const preflight = await checkOllamaReady({});
    expect(preflight.availableModels.length).toBeGreaterThan(0);
    expect(preflight.modelAvailable).toBe(true);
  }, 30_000);

  it('agent.research returns a sealed report citing tool evidence', async () => {
    const agent = createResearchAgent({
      symbol: 'SOLUSDT',
      timeframe: '15m',
      candles: makeCandles(280),
    });

    const outcome = await agent.research(
      'On this dataset, does FVG show meaningful +2R reach rate vs matched controls? Cite run_event_study for fvg and run_walk_forward briefly.',
    );

    expect(['ACHIEVED', 'PARTIAL', 'CEDED', 'FAILED']).toContain(outcome.status);
    expect(outcome.report.length).toBeGreaterThan(200);
    expect(outcome.intentsDispatched).toBeGreaterThan(0);
    expect(outcome.dataset.candleCount).toBe(280);
  }, 300_000);
});
