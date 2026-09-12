import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { downloadPaginatedKlines } from '../src/data/paginated-downloader.js';
import { saveDataset, loadDataset } from '../src/data/dataset-store.js';
import type { KlineDataSource } from '../src/data/types.js';

describe('Historical Data Pipeline', () => {
  it('downloads klines across multiple pages and sanitizes them', async () => {
    // Mock data source with 3 klines total returned across 2 pages
    const mockSource: KlineDataSource = {
      async fetchKlines(_symbol, _interval, options) {
        if (options.startTime === 1000) {
          return [
            { openTime: 1000, open: '100', high: '105', low: '95', close: '102', volume: '10', closeTime: 1999 },
            { openTime: 2000, open: '102', high: '110', low: '101', close: '108', volume: '15', closeTime: 2999 }
          ];
        }
        if (options.startTime === 3000) {
          return [
            { openTime: 3000, open: '108', high: '115', low: '107', close: '114', volume: '20', closeTime: 3999 }
          ];
        }
        return [];
      }
    };

    const candles = await downloadPaginatedKlines(mockSource, {
      symbol: 'BTCUSDT',
      timeframe: '15m',
      startTime: 1000,
      endTime: 5000,
      batchLimit: 2
    });

    expect(candles).toHaveLength(3);
    expect(candles[0]!.open.toNumber()).toBe(100);
    expect(candles[2]!.close.toNumber()).toBe(114);
  });

  it('persists and reloads immutable dataset to/from disk', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dataset-test-'));
    const mockSource: KlineDataSource = {
      async fetchKlines() {
        return [
          { openTime: 1000, open: '50000', high: '50500', low: '49500', close: '50200', volume: '100', closeTime: 1999 }
        ];
      }
    };

    const candles = await downloadPaginatedKlines(mockSource, {
      symbol: 'BTCUSDT',
      timeframe: '1h',
      startTime: 1000,
      endTime: 2000,
      batchLimit: 10
    });

    const savedPath = await saveDataset(tmpDir, 'BTCUSDT', '1h', candles);
    expect(savedPath).toContain('BTCUSDT-1h.json');

    const loaded = await loadDataset(savedPath);
    expect(loaded.metadata.symbol).toBe('BTCUSDT');
    expect(loaded.metadata.count).toBe(1);
    expect(loaded.candles[0]!.open.toNumber()).toBe(50000);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
