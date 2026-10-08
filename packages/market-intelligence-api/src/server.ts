import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';

import type { MarketStream } from '@nemesis-oss/market-stream';
import type { StrategyRegistry } from '@nemesis-oss/strategy-registry';
import type { ResearchMemory } from '@nemesis-oss/research-memory';

/**
 * CORS configuration.
 *
 * @param origin Allowed origin(s). `'*'` (default, public read-only API) or an
 *   explicit list of origins. When a list is given, the request Origin header
 *   must match one entry exactly and is echoed back; requests with a
 *   non-matching origin receive no CORS headers.
 */
export interface CorsConfig {
  readonly origin: '*' | readonly string[];
}

/**
 * Sliding-window rate limiting configuration.
 *
 * The limiter is in-memory and per-client-IP. It is intentionally
 * dependency-free; for multi-instance deployments put a shared limiter
 * (e.g. Redis-backed) in front of the API via a reverse proxy.
 */
export interface RateLimitConfig {
  /** Max requests per window per client IP. Default 120. */
  readonly maxRequests: number;
  /** Sliding window length in milliseconds. Default 60_000 (1 minute). */
  readonly windowMs: number;
}

/**
 * HTTP server timeout configuration (all values in milliseconds).
 *
 * Defaults follow Node.js hardened guidance: requests cannot hang forever,
 * headers must arrive quickly, and keep-alive sockets are reclaimed
 * aggressively so graceful shutdown does not stall.
 */
export interface TimeoutConfig {
  /** Max time for receiving the complete request headers. Default 10_000. */
  readonly headersTimeoutMs: number;
  /** Max time for processing an entire request. Default 30_000. */
  readonly requestTimeoutMs: number;
  /** Keep-alive socket idle timeout. Default 5_000. */
  readonly keepAliveTimeoutMs: number;
}

/** Structured request log record. */
export interface RequestLogRecord {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly durationMs: number;
  readonly requestId: string;
  readonly clientIp: string;
}

/** Callback invoked after every completed request. */
export type RequestLogger = (record: RequestLogRecord) => void;

/**
 * Configuration for the market intelligence API server.
 */
export interface ApiServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly stream?: MarketStream | undefined;
  readonly registry?: StrategyRegistry | undefined;
  readonly memory?: ResearchMemory | undefined;
  readonly cors?: CorsConfig | undefined;
  readonly rateLimit?: RateLimitConfig | undefined;
  readonly timeouts?: TimeoutConfig | undefined;
  readonly logger?: RequestLogger | undefined;
}

const DEFAULT_RATE_LIMIT: Required<RateLimitConfig> = {
  maxRequests: 120,
  windowMs: 60_000,
};

const DEFAULT_TIMEOUTS: Required<TimeoutConfig> = {
  headersTimeoutMs: 10_000,
  requestTimeoutMs: 30_000,
  keepAliveTimeoutMs: 5_000,
};

interface RateLimitEntry {
  readonly timestamps: number[];
}

/**
 * Dependency-free sliding-window rate limiter keyed by client IP.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, RateLimitEntry>();
  /** Configured maximum requests per window. */
  readonly maxRequests: number;
  private readonly windowMs: number;
  private lastSweep = Date.now();

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.maxRequests = config.maxRequests ?? DEFAULT_RATE_LIMIT.maxRequests;
    this.windowMs = config.windowMs ?? DEFAULT_RATE_LIMIT.windowMs;
  }

  /**
   * Consume one request slot for `key`.
   * Returns remaining allowance and retry-after hint when limited.
   */
  consume(key: string): { allowed: boolean; remaining: number; retryAfterMs: number } {
    this.sweep();
    const now = Date.now();
    const entry = this.buckets.get(key);
    const timestamps = entry?.timestamps.filter((t) => now - t < this.windowMs) ?? [];

    if (timestamps.length >= this.maxRequests) {
      const oldest = timestamps[0] ?? now;
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(this.windowMs - (now - oldest), 1),
      };
    }

    timestamps.push(now);
    this.buckets.set(key, { timestamps });
    return {
      allowed: true,
      remaining: this.maxRequests - timestamps.length,
      retryAfterMs: 0,
    };
  }

  /** Drop expired buckets so the map cannot grow unbounded. */
  private sweep(): void {
    const now = Date.now();
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [key, entry] of this.buckets) {
      if (entry.timestamps.every((t) => now - t >= this.windowMs)) {
        this.buckets.delete(key);
      }
    }
  }
}

/**
 * Minimal HTTP API server that exposes the market intelligence platform.
 *
 * Endpoints:
 *  GET  /health           — health check (HEAD also supported, body omitted)
 *  GET  /markets          — list active market streams
 *  GET /state/:symbol/:timeframe — current MarketState for a stream
 *  GET /events           — all active events across all streams
 *  GET /strategies       — all registered strategies
 *  GET /strategies?status=… — strategies filtered by status
 *  GET /research         — stored experiments from research memory
 *  GET /datasets         — stored datasets from research memory
 *
 * Production hardening (all optional, on by default):
 *  - Per-IP sliding-window rate limiting (429 + Retry-After + X-RateLimit-*)
 *  - Security headers on every response
 *  - Strict HTTP timeouts (headers / request / keep-alive)
 *  - Configurable CORS (default: allow all, for read-only public data)
 *  - X-Request-Id correlation IDs
 *  - Structured request logging callback
 *
 * All responses are JSON. Errors return 4xx/5xx with { error: string }.
 */
export function createApiServer(options: ApiServerOptions = {}): Server {
  const port = options.port ?? 8080;
  const host = options.host ?? '0.0.0.0';
  const cors = options.cors ?? { origin: '*' };
  const rateLimiter = new RateLimiter(options.rateLimit ?? {});
  const timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
  const logger = options.logger;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const startedAt = Date.now();
    const requestId = randomUUID();
    const clientIp = clientIpOf(req);

    // --- Security + correlation headers on every response. ---
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");

    // --- CORS ---
    const corsOrigin = resolveCorsOrigin(cors, req.headers.origin);
    if (corsOrigin !== undefined) {
      res.setHeader('Access-Control-Allow-Origin', corsOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
    }

    const finish = (status: number): void => {
      if (logger) {
        logger({
          method: req.method ?? '-',
          path: req.url ?? '/',
          status,
          durationMs: Date.now() - startedAt,
          requestId,
          clientIp,
        });
      }
    };

    try {
      // --- Rate limiting (after CORS preflight so OPTIONS is never limited). ---
      if (req.method !== 'OPTIONS') {
        const verdict = rateLimiter.consume(clientIp);
        res.setHeader('X-RateLimit-Limit', String(rateLimiter.maxRequests));
        res.setHeader('X-RateLimit-Remaining', String(verdict.remaining));
        if (!verdict.allowed) {
          res.setHeader('Retry-After', Math.ceil(verdict.retryAfterMs / 1000));
          finish(429);
          sendJson(res, 429, {
            error: 'Rate limit exceeded. Retry shortly.',
            requestId,
          });
          return;
        }
      }

      if (req.method === 'OPTIONS') {
        finish(204);
        res.writeHead(204);
        res.end();
        return;
      }

      // HEAD is routed like GET (RFC 9110: identical to GET minus the body).
      // Node's http server discards body writes for HEAD responses, so route
      // handlers stay untouched — clients receive the correct headers and
      // Content-Length. Load balancers and uptime probes rely on this.
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        finish(405);
        res.setHeader('Allow', 'GET, HEAD, OPTIONS');
        sendJson(res, 405, { error: 'Method not allowed', requestId });
        return;
      }

      const url = new URL(req.url ?? '/', `http://${host}:${port}`);
      const path = url.pathname;
      const segments = path.split('/').filter(Boolean);

      // --- Routing ---
      if (path === '/health') {
        finish(200);
        sendJson(res, 200, { status: 'ok', timestamp: Date.now(), requestId });
        return;
      }

      if (path === '/markets' && options.stream) {
        const markets = options.stream.streams.map((key) => ({
          symbol: key.symbol,
          timeframe: key.timeframe,
          alive: options.stream!.isAlive(key),
        }));
        finish(200);
        sendJson(res, 200, { markets });
        return;
      }

      if (segments[0] === 'state' && segments.length === 3 && options.stream) {
        const symbol = segments[1]!;
        const timeframe = segments[2]!;
        const state = options.stream.getState({ symbol, timeframe: timeframe as never });
        if (!state) {
          finish(404);
          sendJson(res, 404, { error: `No state for ${symbol} ${timeframe}`, requestId });
          return;
        }
        finish(200);
        sendJson(res, 200, state);
        return;
      }

      if (path === '/events' && options.stream) {
        const allEvents: unknown[] = [];
        for (const key of options.stream.streams) {
          const state = options.stream.getState(key);
          if (state) {
            for (const event of state.activeEvents) {
              allEvents.push({
                event,
                symbol: key.symbol,
                timeframe: key.timeframe,
              });
            }
          }
        }
        finish(200);
        sendJson(res, 200, { events: allEvents, count: allEvents.length });
        return;
      }

      if (path === '/strategies' && options.registry) {
        const status = url.searchParams.get('status');
        const strategies = status
          ? options.registry.byStatus(status as never)
          : options.registry.list();
        finish(200);
        sendJson(res, 200, { strategies, count: strategies.length });
        return;
      }

      if (path === '/research' && options.memory) {
        finish(200);
        sendJson(res, 200, {
          experiments: options.memory.experimentCount,
          strategies: options.memory.strategyCount,
        });
        return;
      }

      if (path === '/datasets' && options.memory) {
        finish(200);
        sendJson(res, 200, { datasets: options.memory.listDatasets() });
        return;
      }

      finish(404);
      sendJson(res, 404, { error: `Not found: ${path}`, requestId });
    } catch (err) {
      finish(500);
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : 'Internal server error',
        requestId,
      });
    }
  });

  // --- Hardened timeouts (Node >= 18). ---
  server.headersTimeout = timeouts.headersTimeoutMs;
  server.requestTimeout = timeouts.requestTimeoutMs;
  server.keepAliveTimeout = timeouts.keepAliveTimeoutMs;

  return server;
}

/**
 * Start the API server. Returns a promise that resolves when listening.
 */
export function startApiServer(options: ApiServerOptions = {}): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createApiServer(options);
    const port = options.port ?? 8080;
    const host = options.host ?? '0.0.0.0';
    server.on('error', reject);
    server.listen(port, host, () => {
      resolve(server);
    });
  });
}

/**
 * Gracefully stop an API server.
 *
 * Sequence (Node 18.2+ hardened shutdown):
 *  1. `server.close()` — stop accepting new connections.
 *  2. `closeIdleConnections()` — reclaim idle keep-alive sockets.
 *  3. In-flight requests drain naturally; after `forceAfterMs` (default 10s)
 *     `closeAllConnections()` destroys any survivors.
 *
 * Resolves once the server is fully closed.
 */
export function stopApiServer(server: Server, forceAfterMs = 10_000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };

    // If nothing is listening, close() may never emit its callback.
    if (!server.listening) {
      finish();
      return;
    }

    const forceTimer = setTimeout(() => {
      server.closeAllConnections?.();
      finish();
    }, forceAfterMs);
    forceTimer.unref?.();

    server.close(() => {
      clearTimeout(forceTimer);
      finish();
    });
    server.closeIdleConnections?.();
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

/** Extract the best-effort client IP (direct socket, x-forwarded-for aware). */
function clientIpOf(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/**
 * Resolve the Access-Control-Allow-Origin value for this request.
 * Returns undefined when the origin is not allowed (no CORS headers).
 */
function resolveCorsOrigin(cors: CorsConfig, origin: string | undefined): string | undefined {
  if (cors.origin === '*') return '*';
  if (origin !== undefined && cors.origin.includes(origin)) return origin;
  return undefined;
}
