import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';

import { createApiServer, stopApiServer, RateLimiter } from '../src/server.js';
import { createStrategyRegistry } from '@nemesis-oss/strategy-registry';
import { createResearchMemory } from '@nemesis-oss/research-memory';

async function fetchJson(server: Server, path: string): Promise<{ status: number; body: unknown }> {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Server not listening or unix socket');
  }
  const port = address.port;
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const body = await res.json();
  return { status: res.status, body };
}

async function fetchRaw(server: Server, path: string, init?: RequestInit): Promise<Response> {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Server not listening or unix socket');
  }
  const port = address.port;
  return fetch(`http://127.0.0.1:${port}${path}`, init);
}

async function listen(server: Server): Promise<Server> {
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
  return server;
}

describe('market-intelligence-api / server', () => {
  let servers: Server[] = [];

  afterEach(async () => {
    for (const s of servers) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
    servers = [];
  });

  it('responds to /health', async () => {
    const server = createApiServer({ port: 0 });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve()),
    );

    const { status, body } = await fetchJson(server, '/health');
    expect(status).toBe(200);
    expect((body as { status: string }).status).toBe('ok');
  });

  it('responds to /strategies', async () => {
    const registry = createStrategyRegistry();
    const server = createApiServer({ port: 0, registry });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve()),
    );

    const { status, body } = await fetchJson(server, '/strategies');
    expect(status).toBe(200);
    expect((body as { strategies: unknown[] }).strategies).toEqual([]);
    expect((body as { count: number }).count).toBe(0);
  });

  it('responds to /research', async () => {
    const memory = createResearchMemory();
    const server = createApiServer({ port: 0, memory });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve()),
    );

    const { status, body } = await fetchJson(server, '/research');
    expect(status).toBe(200);
    expect((body as { experiments: number }).experiments).toBe(0);
  });

  it('returns 404 for unknown paths', async () => {
    const server = createApiServer({ port: 0 });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve()),
    );

    const { status } = await fetchJson(server, '/unknown');
    expect(status).toBe(404);
  });

  it('returns 405 with Allow header for non-GET/HEAD methods', async () => {
    const server = createApiServer({ port: 0 });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve()),
    );

    const address = server.address();
    const port = (address as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/health`, { method: 'POST' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
  });

  it('answers HEAD like GET: 200, same headers, no body', async () => {
    const server = await listen(createApiServer({ port: 0 }));
    servers.push(server);

    const getRes = await fetchRaw(server, '/health');
    const getBody = await getRes.text();
    const headRes = await fetchRaw(server, '/health', { method: 'HEAD' });
    const headBody = await headRes.text();

    expect(headRes.status).toBe(200);
    expect(headBody).toBe('');
    // Content-Length reflects the GET representation (RFC 9110 §9.3.2).
    expect(headRes.headers.get('content-length')).toBe(
      getRes.headers.get('content-length'),
    );
    expect(headRes.headers.get('content-length')).toBe(String(getBody.length));
    // Hardening + correlation headers still present on HEAD responses.
    expect(headRes.headers.get('x-content-type-options')).toBe('nosniff');
    expect(headRes.headers.get('x-ratelimit-limit')).toBeTruthy();
    expect(headRes.headers.get('x-request-id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('sets security and correlation headers on every response', async () => {
    const server = await listen(createApiServer({ port: 0 }));
    servers.push(server);

    const res = await fetchRaw(server, '/health');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('strict-transport-security')).toContain('max-age');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('x-request-id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('returns 429 with Retry-After once the rate limit is exceeded', async () => {
    const server = await listen(
      createApiServer({ port: 0, rateLimit: { maxRequests: 3, windowMs: 60_000 } }),
    );
    servers.push(server);

    for (let i = 0; i < 3; i++) {
      const { status } = await fetchJson(server, '/health');
      expect(status).toBe(200);
    }
    const limited = await fetchRaw(server, '/health');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(limited.headers.get('x-ratelimit-remaining')).toBe('0');
    const body = (await limited.json()) as { error: string; requestId: string };
    expect(body.error).toContain('Rate limit');
    expect(body.requestId).toBeTruthy();
  });

  it('echoes a matching configured CORS origin and omits it for others', async () => {
    const server = await listen(
      createApiServer({ port: 0, cors: { origin: ['https://app.example.com'] } }),
    );
    servers.push(server);

    const allowed = await fetchRaw(server, '/health', {
      headers: { Origin: 'https://app.example.com' },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.example.com');

    const denied = await fetchRaw(server, '/health', {
      headers: { Origin: 'https://evil.example.net' },
    });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
    expect(denied.status).toBe(200); // still served, just without CORS headers
  });

  it('answers CORS preflights with 204 and never rate-limits OPTIONS', async () => {
    const server = await listen(
      createApiServer({ port: 0, rateLimit: { maxRequests: 1, windowMs: 60_000 } }),
    );
    servers.push(server);

    // Exhaust the rate limit with a GET first.
    await fetchJson(server, '/health');
    // OPTIONS must still succeed even when limited.
    for (let i = 0; i < 3; i++) {
      const res = await fetchRaw(server, '/health', { method: 'OPTIONS' });
      expect(res.status).toBe(204);
    }
  });

  it('invokes the request logger with structured records', async () => {
    const records: Array<{ method: string; path: string; status: number }> = [];
    const server = await listen(
      createApiServer({
        port: 0,
        logger: (r) => records.push({ method: r.method, path: r.path, status: r.status }),
      }),
    );
    servers.push(server);

    await fetchJson(server, '/health');
    await fetchJson(server, '/nope');

    expect(records.length).toBe(2);
    expect(records[0]).toMatchObject({ method: 'GET', path: '/health', status: 200 });
    expect(records[1]).toMatchObject({ method: 'GET', path: '/nope', status: 404 });
  });

  it('stopApiServer resolves and closes the listening server', async () => {
    const server = await listen(createApiServer({ port: 0 }));
    // Not tracked in servers[] — we close it explicitly.
    expect(server.listening).toBe(true);
    await stopApiServer(server, 1000);
    expect(server.listening).toBe(false);
  });

  it('stopApiServer resolves immediately for a non-listening server', async () => {
    const server = createApiServer({ port: 0 });
    await expect(stopApiServer(server, 100)).resolves.toBeUndefined();
  });
});

describe('market-intelligence-api / RateLimiter', () => {
  it('allows up to max requests per window then blocks', () => {
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 1_000 });

    expect(limiter.consume('a').allowed).toBe(true);
    expect(limiter.consume('a').allowed).toBe(true);
    const blocked = limiter.consume('a');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(1_000);
  });

  it('tracks clients independently', () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1_000 });

    expect(limiter.consume('a').allowed).toBe(true);
    expect(limiter.consume('b').allowed).toBe(true);
    expect(limiter.consume('a').allowed).toBe(false);
    expect(limiter.consume('b').allowed).toBe(false);
  });

  it('reports remaining allowance', () => {
    const limiter = new RateLimiter({ maxRequests: 3, windowMs: 1_000 });

    expect(limiter.consume('a').remaining).toBe(2);
    expect(limiter.consume('a').remaining).toBe(1);
    expect(limiter.consume('a').remaining).toBe(0);
    expect(limiter.consume('a').allowed).toBe(false);
  });

  it('recovers after the window slides', async () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 20 });

    expect(limiter.consume('a').allowed).toBe(true);
    expect(limiter.consume('a').allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(limiter.consume('a').allowed).toBe(true);
  });
});
