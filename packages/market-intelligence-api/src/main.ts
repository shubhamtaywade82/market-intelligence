/**
 * Production entrypoint for the market intelligence API.
 *
 * Configuration is environment-driven (see .env.example at the repo root):
 *
 *   PORT                     — listen port (default 8080)
 *   HOST                     — bind address (default 0.0.0.0)
 *   CORS_ORIGIN              — '*' (default) or comma-separated origin list
 *   RATE_LIMIT_MAX_REQUESTS  — per-IP requests per window (default 120)
 *   RATE_LIMIT_WINDOW_MS     — rate limit window in ms (default 60000)
 *   DATA_MODE                — 'simulated' (default) | 'live'
 *   MARKET_SYMBOLS           — comma-separated symbols (default ETHUSDT,BTCUSDT)
 *   MARKET_TIMEFRAMES        — comma-separated timeframes (default 15m)
 *   LOG_LEVEL                — 'debug' | 'info' (default) | 'warn' | 'error'
 *
 * Simulated mode generates a synthetic candle stream so the API is fully
 * functional without exchange connectivity (useful for demos, smoke tests,
 * and container health checks). Live mode subscribes to Binance klines.
 *
 * Signals: SIGTERM/SIGINT trigger a graceful drain (stop stream →
 * stop accepting connections → close idle sockets → force after 10s).
 */
import { Decimal } from 'decimal.js';
import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import type {
  ExchangeAdapter,
  LiveKlineSubscription,
  StreamStatus,
  StreamSubscription,
} from '@nemesis-oss/market-data';
import { createMarketStream, type MarketStream } from '@nemesis-oss/market-stream';
import { createStrategyRegistry } from '@nemesis-oss/strategy-registry';
import { createResearchMemory } from '@nemesis-oss/research-memory';
import { startApiServer, stopApiServer } from './server.js';

// ---------------------------------------------------------------------------
// Environment configuration
// ---------------------------------------------------------------------------

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LOG_LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: expected a positive integer, got "${raw}"`);
  }
  return parsed;
}

function envString(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw !== undefined && raw.trim() !== '' ? raw.trim() : fallback;
}

function envList(name: string, fallback: readonly string[]): string[] {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return [...fallback];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function envLogLevel(): LogLevel {
  const raw = (process.env['LOG_LEVEL'] ?? 'info').toLowerCase();
  return raw in LOG_LEVELS ? (raw as LogLevel) : 'info';
}

const config = {
  port: envInt('PORT', 8080),
  host: envString('HOST', '0.0.0.0'),
  corsOrigin: envString('CORS_ORIGIN', '*'),
  rateLimitMax: envInt('RATE_LIMIT_MAX_REQUESTS', 120),
  rateLimitWindowMs: envInt('RATE_LIMIT_WINDOW_MS', 60_000),
  dataMode: envString('DATA_MODE', 'simulated') as 'simulated' | 'live',
  symbols: envList('MARKET_SYMBOLS', ['ETHUSDT', 'BTCUSDT']),
  timeframes: envList('MARKET_TIMEFRAMES', ['15m']),
  logLevel: envLogLevel(),
};

const logThreshold = LOG_LEVELS[config.logLevel];

function log(level: LogLevel, message: string, extra?: Record<string, unknown>): void {
  if (LOG_LEVELS[level] < logThreshold) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(extra ?? {}),
  };
  // Single-line JSON to stdout — container/collector friendly.
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

// ---------------------------------------------------------------------------
// Simulated market stream (no exchange connectivity required)
// ---------------------------------------------------------------------------

const FIFTEEN_MIN = 15 * 60_000;

function makeCandle(i: number, seed: number): Candle {
  const drift = Math.sin(i / 13 + seed) * 0.8 + Math.sin(i / 47 + seed) * 0.4;
  const open = 100 + i * 0.01 + seed;
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

function createSimulatedAdapter(): {
  adapter: ExchangeAdapter;
  startStreaming: () => void;
  stopStreaming: () => void;
} {
  const handlers = new Map<
    string,
    { onCandle: (c: Candle) => void; onStatus?: ((s: StreamStatus) => void) | undefined }
  >();
  const key = (s: string, tf: Timeframe) => `${s}:${tf}`;
  let candleIndex = 0;
  let interval: ReturnType<typeof setInterval> | null = null;

  const adapter: ExchangeAdapter = {
    // ExchangeId has no 'simulated' member; 'binance' is used as the label
    // for the wire-compatible mock below. All URLs point at .invalid TLDs.
    exchange: 'binance',
    restBaseUrl: 'https://simulated.invalid',
    wsBaseUrl: 'wss://simulated.invalid',
    async fetchKlines() {
      return [];
    },
    async subscribeKlines(sub: LiveKlineSubscription): Promise<StreamSubscription> {
      const k = key(sub.symbol, sub.timeframe);
      handlers.set(k, { onCandle: sub.onCandle, onStatus: sub.onStatus });
      sub.onStatus?.('open');
      return {
        status: 'open' as StreamStatus,
        async unsubscribe() {
          handlers.delete(k);
        },
      };
    },
    async fetchFundingRate() {
      return null;
    },
    async fetchOpenInterest() {
      return null;
    },
    async fetchMarkPrice() {
      return null;
    },
  };

  const startStreaming = (): void => {
    if (interval !== null) return;
    interval = setInterval(() => {
      const candle = makeCandle(candleIndex++, 0);
      for (const h of handlers.values()) {
        h.onCandle(candle);
      }
    }, 500);
  };

  const stopStreaming = (): void => {
    if (interval !== null) {
      clearInterval(interval);
      interval = null;
    }
  };

  return { adapter, startStreaming, stopStreaming };
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log('info', 'starting market-intelligence-api', {
    port: config.port,
    host: config.host,
    dataMode: config.dataMode,
    symbols: config.symbols,
    timeframes: config.timeframes,
    rateLimit: `${config.rateLimitMax}/${config.rateLimitWindowMs}ms`,
  });

  if (config.dataMode === 'live') {
    throw new Error(
      "DATA_MODE=live requires the Binance adapter wiring from packages/market-data; " +
        'set DATA_MODE=simulated or wire createBinanceAdapter() here.',
    );
  }

  const { adapter, startStreaming, stopStreaming } = createSimulatedAdapter();

  const streams = config.symbols.flatMap((symbol) =>
    config.timeframes.map((timeframe) => ({ symbol, timeframe: timeframe as Timeframe })),
  );

  const stream: MarketStream = createMarketStream(
    {
      adapter,
      streams,
      detectors: ['fvg', 'bos', 'liquidity_sweep'],
      eventLookbackBars: 10,
    },
    {
      onState: (state) => {
        log(
          'debug',
          'market state updated',
          { symbol: state.symbol, timeframe: state.timeframe, price: state.price },
        );
      },
      onEvent: (event, key) => {
        log('info', 'market event detected', {
          symbol: key.symbol,
          timeframe: key.timeframe,
          type: event.type,
          direction: event.direction,
        });
      },
    },
  );

  const registry = createStrategyRegistry();
  const memory = createResearchMemory();

  await stream.start();
  startStreaming();

  const cors =
    config.corsOrigin === '*'
      ? { origin: '*' as const }
      : { origin: config.corsOrigin.split(',').map((s) => s.trim()) };

  const server = await startApiServer({
    port: config.port,
    host: config.host,
    stream,
    registry,
    memory,
    cors,
    rateLimit: {
      maxRequests: config.rateLimitMax,
      windowMs: config.rateLimitWindowMs,
    },
    logger: (r) => {
      log('info', 'http request', {
        method: r.method,
        path: r.path,
        status: r.status,
        durationMs: r.durationMs,
        requestId: r.requestId,
        clientIp: r.clientIp,
      });
    },
  });

  log('info', 'api server listening', {
    url: `http://${config.host}:${config.port}`,
    endpoints: [
      '/health',
      '/markets',
      '/state/:symbol/:timeframe',
      '/events',
      '/strategies',
      '/research',
      '/datasets',
    ],
  });

  // --- Graceful shutdown -------------------------------------------------
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'graceful shutdown initiated', { signal });

    const forceExit = setTimeout(() => {
      log('error', 'graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 15_000);
    forceExit.unref?.();

    void (async () => {
      try {
        stopStreaming();
        await stream.stop();
        await stopApiServer(server, 10_000);
        log('info', 'shutdown complete');
        process.exit(0);
      } catch (err) {
        log('error', 'error during shutdown', {
          error: err instanceof Error ? err.message : String(err),
        });
        process.exit(1);
      }
    })();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    log('error', 'unhandled promise rejection', {
      error: reason instanceof Error ? reason.message : String(reason),
    });
  });

  process.on('uncaughtException', (err) => {
    log('error', 'uncaught exception', { error: err.message, stack: err.stack });
    shutdown('uncaughtException');
  });
}

main().catch((err) => {
  log('error', 'fatal startup error', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
