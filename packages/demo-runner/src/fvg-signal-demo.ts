/**
 * Demo: build read-only FVG trading signal from cached USDⓈ-M dataset + optional agent run.
 *
 *   pnpm --filter @nemesis-oss/demo-runner fvg-signal
 */
import { loadDataset } from '@nemesis-oss/market-research';
import {
  buildFvgEvidenceSignal,
  findResearchResultByEventType,
  isWalkForwardStableForComponent,
  runObservationStudy,
  runWalkForwardValidation,
  toResearchResult,
} from '@nemesis-oss/market-research';
import path from 'node:path';

const datasetRel = process.env.FVG_SIGNAL_DATASET
  ?? 'packages/market-research/.datasets/BTCUSDT-15m-usdm.json';

async function main(): Promise<void> {
  const datasetPath = path.resolve(process.cwd(), '../market-research', datasetRel.replace(/^packages\/market-research\//, ''));
  const { metadata, candles } = await loadDataset(datasetPath);
  const study = runObservationStudy(candles, {
    symbol: metadata.symbol,
    timeframe: metadata.timeframe,
    horizonCandles: 24,
  });
  const fvgRow = study.results.find(r => r.eventType === 'fvg');
  if (!fvgRow) {
    console.error('No FVG component in study');
    process.exit(1);
  }
  const provenance = {
    datasetId: `${metadata.symbol}-${metadata.timeframe}`,
    datasetHash: 'demo',
    detectorId: 'fvg',
    detectorVersion: '1.0.0',
    detectorConfigHash: 'demo',
    outcomeConfigHash: 'demo',
    outcomeVersion: '1.0.0',
  };
  const fvgResult = toResearchResult(
    fvgRow,
    candles.length,
    provenance,
    study.matchRatios.get('fvg')
  );
  const wf = runWalkForwardValidation(candles, {
    symbol: metadata.symbol,
    timeframe: metadata.timeframe,
    trainCandlesCount: Math.floor(candles.length * 0.6),
    testCandlesCount: Math.floor(candles.length * 0.2),
    stepCandlesCount: Math.floor(candles.length * 0.2),
    horizonCandles: 24,
    warmupBars: 50,
  });
  const wfStable = isWalkForwardStableForComponent(wf.stability, 'fvg');
  const signal = buildFvgEvidenceSignal(fvgResult, {
    klineMarket: 'usdm_futures',
    walkForwardStable: wfStable,
    agentRunStatus: null,
  });
  console.log(JSON.stringify(signal, null, 2));
  void findResearchResultByEventType;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
