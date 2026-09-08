import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import { runUniversalStudy } from './study-runner.js';
import type { ComponentStudyResult } from './types.js';

export interface WalkForwardWindow {
  readonly windowIndex: number;
  readonly trainStartTime: number;
  readonly trainEndTime: number;
  readonly testStartTime: number;
  readonly testEndTime: number;
  readonly trainResults: readonly ComponentStudyResult[];
  readonly testResults: readonly ComponentStudyResult[];
}

export interface WalkForwardOptions {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly trainCandlesCount: number;
  readonly testCandlesCount: number;
  readonly stepCandlesCount: number;
  readonly horizonCandles?: number;
}

export interface StabilitySummary {
  readonly component: string;
  readonly windowsCount: number;
  readonly meanTrainHitRateR2: number;
  readonly meanTestHitRateR2: number;
  readonly hitRateDegradation: number; // train - test
  readonly isStable: boolean;
}

/**
 * Runs walk-forward out-of-sample validation to detect overfitting and strategy decay.
 */
export function runWalkForwardValidation(
  candles: readonly Candle[],
  options: WalkForwardOptions
): { readonly windows: readonly WalkForwardWindow[]; readonly stability: readonly StabilitySummary[] } {
  const { trainCandlesCount, testCandlesCount, stepCandlesCount, symbol, timeframe, horizonCandles } = options;
  const windows: WalkForwardWindow[] = [];

  let startIdx = 0;
  let windowIdx = 0;

  const studyOpts = horizonCandles !== undefined
    ? { symbol, timeframe, horizonCandles }
    : { symbol, timeframe };

  while (startIdx + trainCandlesCount + testCandlesCount <= candles.length) {
    const trainSlice = candles.slice(startIdx, startIdx + trainCandlesCount);
    const testSlice = candles.slice(startIdx + trainCandlesCount, startIdx + trainCandlesCount + testCandlesCount);

    const trainResults = runUniversalStudy(trainSlice, studyOpts);
    const testResults = runUniversalStudy(testSlice, studyOpts);

    windows.push({
      windowIndex: windowIdx,
      trainStartTime: trainSlice[0]!.timestamp,
      trainEndTime: trainSlice[trainSlice.length - 1]!.timestamp,
      testStartTime: testSlice[0]!.timestamp,
      testEndTime: testSlice[testSlice.length - 1]!.timestamp,
      trainResults,
      testResults
    });

    startIdx += stepCandlesCount;
    windowIdx++;
  }

  // Compute stability summary across components
  const components = ['fvg', 'bos', 'order_block', 'liquidity_sweep'];
  const stability: StabilitySummary[] = components.map(comp => {
    let sumTrain = 0;
    let sumTest = 0;
    let count = 0;

    for (const w of windows) {
      const tr = w.trainResults.find(r => r.eventType === comp);
      const te = w.testResults.find(r => r.eventType === comp);
      if (tr && te && tr.sampleSize > 0 && te.sampleSize > 0) {
        sumTrain += tr.hitRates.r2;
        sumTest += te.hitRates.r2;
        count++;
      }
    }

    const meanTrain = count > 0 ? sumTrain / count : 0;
    const meanTest = count > 0 ? sumTest / count : 0;
    const degradation = meanTrain - meanTest;

    return {
      component: comp,
      windowsCount: count,
      meanTrainHitRateR2: meanTrain,
      meanTestHitRateR2: meanTest,
      hitRateDegradation: degradation,
      // Considered stable if degradation is < 15 percentage points
      isStable: count > 0 && degradation < 0.15
    };
  });

  return { windows, stability };
}

/**
 * Formats WalkForward stability summary as a clean markdown table.
 */
export function formatStabilityMarkdown(stability: readonly StabilitySummary[]): string {
  const header = '| Component | Windows | Train Hit Rate (+2R) | Test Hit Rate (+2R) | Degradation | Status |';
  const sep = '| :--- | :---: | :---: | :---: | :---: | :---: |';
  const rows = stability.map(s => {
    const train = (s.meanTrainHitRateR2 * 100).toFixed(1);
    const test = (s.meanTestHitRateR2 * 100).toFixed(1);
    const deg = (s.hitRateDegradation * 100).toFixed(1);
    const status = s.isStable ? 'STABLE' : 'DEGRADED';
    return `| ${s.component.toUpperCase()} | ${s.windowsCount} | ${train}% | ${test}% | ${deg}pp | ${status} |`;
  });

  return [
    '## Walk-Forward Stability (Out-of-Sample)',
    header,
    sep,
    ...rows
  ].join('\n');
}

