/**
 * API Server Demo — Live Market Intelligence HTTP API
 *
 * Starts the market-intelligence HTTP API server with a simulated
 * market stream (no real exchange connection needed). Demonstrates
 * all endpoints:
 *
 *   GET /health           — health check
 *   GET /markets          — list active market streams
 *   GET /state/:symbol/:timeframe — current MarketState
 *   GET /events           — all active events across streams
 *   GET /strategies       — registered strategies
 *   GET /research         — experiment count from research memory
 *   GET /datasets         — stored datasets
 *
 * Run: npx tsx src/demos/api-server.ts
 */
import { Decimal } from 'decimal.js';
import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import type { ExchangeAdapter, StreamSubscription, StreamStatus } from '@nemesis-oss/market-data';
import { createMarketStream } from '@nemesis-oss/market-stream';
import { aggregateMarketState } from '@nemesis-oss/market-state';
import { createStrategyRegistry } from '@nemesis-oss/strategy-registry';
import { createResearchMemory } from '@nemesis-oss/research-memory';
import { startApiServer } from '@nemesis-oss/market-intelligence-api';

const FIFTEEN_MIN = 15 * 60_000;

function makeCandle(i: number): Candle {
  const drift = Math.sin(i / 13) * 0.8 + Math.sin(i / 47) * 0.4;
  const open = 100 + i * 0.01;
  const close = open + drift;
  return {
    timestamp: 1_700_000_000_000 + i * FIFTEEN_MIN,
    open: new Decimal(open.toFixed(4)),
    high: new Decimal((Math.max(open, close) + 0.5).toFixed(4)),
    low: new Decimal((Math.min(open, close) - 0.5).toFixed(4)),
    close: new Decimal(close.toFixed(4)),
    volume: new Decimal('1000'),
  };
}

/**
 * Mock exchange adapter that simulates live candle arrivals.
 */
function createMockAdapter(): {
  adapter: ExchangeAdapter;
  startStreaming: () => void;
} {
  const handlers = new Map<string, { onCandle: (c: Candle) => void; onStatus?: (s: string) => void }>();
  const key = (s: string, tf: Timeframe) => `${s}:${tf}`;

  const adapter: ExchangeAdapter = {
    exchange: 'binance',
    restBaseUrl: 'https://mock',
    wsBaseUrl: 'wss://mock',
    async fetchKlines() { return []; },
    async subscribeKlines(sub) {
      const k = key(sub.symbol, sub.timeframe);
      handlers.set(k, { onCandle: sub.onCandle, onStatus: sub.onStatus });
      sub.onStatus?.('open');
      return {
        status: 'open' as StreamStatus,
        async unsubscribe() { handlers.delete(k); },
      };
    },
    async fetchFundingRate() { return null; },
    async fetchOpenInterest() { return null; },
    async fetchMarkPrice() { return null; },
  };

  let candleIndex = 0;
  let interval: NodeJS.Timeout | null = null;

  const startStreaming = () => {
    if (interval) return;
    interval = setInterval(() => {
      const candle = makeCandle(candleIndex++);
      for (const h of handlers.values()) {
        h.onCandle(candle);
      }
    }, 500); // new candle every 500ms
  };

  return { adapter, startStreaming };
}

async function main() {
  console.log('═'.repeat(72));
  console.log('  Market Intelligence API Server Demo');
  console.log('═'.repeat(72));
  console.log();

  // Set up the mock adapter and stream
  const { adapter, startStreaming } = createMockAdapter();

  const stream = createMarketStream(
    {
      adapter,
      streams: [
        { symbol: 'ETHUSDT', timeframe: '15m' },
        { symbol: 'ETHUSDT', timeframe: '15m' },
      ],
      detectors: ['fvg', 'bos', 'liquidity_sweep'],
      eventLookbackBars: 10,
    },
    {
      onState: (state) => {
        // Quiet logging — just dots
        process.stdout.write('.');
      },
    },
  );

  // Create registry and memory
  const registry = createStrategyRegistry();
  const memory = createResearchMemory();

  // Start the stream
  await stream.start();
  startStreaming();

  // Start the API server on port 8080
  const port = 8080;
  const server = await startApiServer({
    port,
    stream,
    registry,
    memory,
  });

  console.log(`  API server running on http://localhost:${port}`);
  console.log();
  console.log('  Endpoints:');
  console.log('    GET /health              — health check');
  console.log('    GET /markets             — active market streams');
  console.log('    GET /state/ETHUSDT/15m    — current ETHUSDT MarketState');
  console.log('    GET /events               — all active events');
  console.log('    GET /strategies           — registered strategies');
  console.log('    GET /research             — experiment count');
  console.log('    GET /datasets             — stored datasets');
  console.log();
  console.log('  Streaming candles every 500ms...');
  console.log('  Press Ctrl+C to stop.');
  console.log();

  // Give the stream a few seconds to accumulate state, then probe endpoints
  await sleep(3000);

  console.log();
  console.log('── Probing endpoints ──────────────────────────────────────────');
  console.log();

  // Probe /health
  let res = await fetch(`http://localhost:${port}/health`);
  let body = await res.json();
  console.log(`  GET /health → ${res.status}`);
  console.log(`    ${JSON.stringify(body)}`);
  console.log();

  // Probe /markets
  await sleep(1000);
  res = await fetch(`http://localhost:${port}/markets`);
  body = await res.json();
  console.log(`  GET /markets → ${res.status}`);
  console.log(`    ${JSON.stringify(body)}`);
  console.log();

  // Probe /state/ETHUSDT/15m
  await sleep(1000);
  res = await fetch(`http://localhost:${port}/state/ETHUSDT/15m`);
  body = await res.json();
  console.log(`  GET /state/ETHUSDT/15m → ${res.status}`);
  if (res.status === 200) {
    const state = body as {
      symbol: string;
      timeframe: string;
      price: string;
      trendRegime: string;
      volatilityRegime: string;
      activeEvents: unknown[];
      candleCount: number;
    };
    console.log(`    symbol: ${state.symbol}`);
    console.log(`    timeframe: ${state.timeframe}`);
    console.log(`    price: ${state.price}`);
    console.log(`    trend: ${state.trendRegime}`);
    console.log(`    volatility: ${state.volatilityRegime}`);
    console.log(`    candles: ${state.candleCount}`);
    console.log(`    active events: ${state.activeEvents.length}`);
  } else {
    console.log(`    ${JSON.stringify(body)}`);
  }
  console.log();

  // Probe /events
  await sleep(1000);
  res = await fetch(`http://localhost:${port}/events`);
  body = await res.json();
  console.log(`  GET /events → ${res.status}`);
  console.log(`    ${JSON.stringify(body)}`);
  console.log();

  // Probe /strategies
  res = await fetch(`http://localhost:${port}/strategies`);
  body = await res.json();
  console.log(`  GET /strategies → ${res.status}`);
  console.log(`    ${JSON.stringify(body)}`);
  console.log();

  // Probe /research
  res = await fetch(`http://localhost:${port}/research`);
  body = await res.json();
  console.log(`  GET /research → ${res.status}`);
  console.log(`    ${JSON.stringify(body)}`);
  console.log();

  console.log('── Demo complete. Server still running — press Ctrl+C to stop. ──');

  // Keep the server alive
  process.on('SIGINT', () => {
    console.log('\n  Shutting down...');
    server.close();
    stream.stop();
    process.exit(0);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
