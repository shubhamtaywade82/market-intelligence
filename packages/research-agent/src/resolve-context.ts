import path from 'node:path';
import { access } from 'node:fs/promises';
import { createBinanceAdapter } from '@nemesis-oss/market-data';
import { loadDataset } from '@nemesis-oss/market-research';
import type { ResearchContext } from './context.js';
import { buildResearchContextFromExchange } from './exchange.js';
import type { ResearchCliArgs } from './cli-args.js';

async function resolveDatasetPath(raw: string): Promise<string> {
  const candidates = [
    path.resolve(raw),
    path.resolve(process.cwd(), raw),
    path.resolve(process.cwd(), '../..', raw),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error(`Dataset file not found: ${raw} (tried ${candidates.join(', ')})`);
}

export async function resolveResearchContext(args: ResearchCliArgs): Promise<ResearchContext> {
  if (args.datasetPath) {
    const filePath = await resolveDatasetPath(args.datasetPath);
    const { metadata, candles } = await loadDataset(filePath);
    return {
      symbol: metadata.symbol,
      timeframe: metadata.timeframe,
      candles,
    };
  }

  const endTime = Date.now();
  const startTime = endTime - args.days * 24 * 60 * 60 * 1000;
  const htfTimeframes = args.htfTimeframes.length > 0 ? args.htfTimeframes : undefined;

  return buildResearchContextFromExchange({
    adapter: createBinanceAdapter(),
    symbol: args.symbol,
    timeframe: args.timeframe,
    startTime,
    endTime,
    ...(htfTimeframes !== undefined ? { htfTimeframes } : {}),
  });
}
