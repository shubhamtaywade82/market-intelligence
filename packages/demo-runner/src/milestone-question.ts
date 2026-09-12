/**
 * Milestone Question Demo — Deterministic Path (no Ollama required)
 *
 * This script demonstrates the full market-intelligence pipeline by
 * answering the milestone question:
 *
 *   "Does bullish FVG continuation on SOLUSDT 15m provide
 *    statistically significant 2R edge?"
 *
 * It uses the deterministic tool surface directly (no LLM), which is
 * the same surface the LLM-driven agent would use. This proves the
 * pipeline works end-to-end before spinning up Ollama.
 *
 * Run: npx tsx src/demos/milestone-question.ts
 */
import { Decimal } from 'decimal.js';
import type { Candle } from '@nemesis-oss/market-events';
import { createResearchAgent } from '@nemesis-oss/market-research-agent';
import { classifyRegime } from '@nemesis-oss/regime-engine';
import { computeEvidenceBalance } from '@nemesis-oss/negative-evidence-system';

const FIFTEEN_MIN = 15 * 60_000;

function makeCandles(count: number, startTs = 1_700_000_000_000): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    const drift =
      Math.sin(i / 13) * 0.8 +
      Math.sin(i / 47) * 0.4 +
      Math.sin(i / 137) * 1.2;
    const open = price;
    const close = price + drift + (i % 7 === 0 ? -2.5 : 0);
    const high = Math.max(open, close) + Math.abs(Math.sin(i / 3)) * 1.2 + (i % 11 === 0 ? 0.8 : 0);
    const low = Math.min(open, close) - Math.abs(Math.cos(i / 3)) * 1.2 - (i % 17 === 0 ? 0.8 : 0);
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

async function main() {
  console.log('═'.repeat(72));
  console.log('  Milestone Question Demo');
  console.log('  "Does bullish FVG continuation on SOLUSDT 15m provide');
  console.log('   statistically significant 2R edge?"');
  console.log('═'.repeat(72));
  console.log();

  const candles = makeCandles(300);
  console.log(`Dataset: 300 synthetic SOLUSDT 15m candles`);
  console.log(`  First: ${new Date(candles[0]!.timestamp).toISOString()}`);
  console.log(`  Last:  ${new Date(candles[candles.length - 1]!.timestamp).toISOString()}`);
  console.log();

  const agent = createResearchAgent({
    symbol: 'SOLUSDT',
    timeframe: '15m',
    candles,
  });

  // Step 1: Dataset Summary
  console.log('── Step 1: Dataset Summary ──────────────────────────────────────');
  const summary = await agent.invokeTool('dataset_summary', {});
  const summaryOut = summary.output as {
    symbol: string;
    timeframe: string;
    candleCount: number;
    detectorCounts: Record<string, number>;
  };
  console.log(`  Symbol: ${summaryOut.symbol}`);
  console.log(`  Timeframe: ${summaryOut.timeframe}`);
  console.log(`  Candle count: ${summaryOut.candleCount}`);
  console.log(`  Event counts:`);
  for (const [type, count] of Object.entries(summaryOut.detectorCounts)) {
    console.log(`    ${type}: ${count}`);
  }
  console.log();

  // Step 2: Detect FVG events
  console.log('── Step 2: Detect FVG Events ────────────────────────────────────');
  const fvgDetection = await agent.invokeTool('detect_events', { eventType: 'fvg' });
  const fvgOut = fvgDetection.output as { count: number; events: Array<{ direction: string }> };
  const bullishCount = fvgOut.events.filter((e) => e.direction === 'bullish').length;
  const bearishCount = fvgOut.events.filter((e) => e.direction === 'bearish').length;
  console.log(`  Total FVGs: ${fvgOut.count}`);
  console.log(`  Bullish: ${bullishCount}`);
  console.log(`  Bearish: ${bearishCount}`);
  console.log();

  // Step 3: Empirical study
  console.log('── Step 3: Empirical Study (2R reach rate) ──────────────────────');
  const study = await agent.invokeTool('run_event_study', {
    eventType: 'fvg',
    horizonCandles: 24,
  });
  const studyOut = study.output as {
    result: {
      sampleSize: number;
      reachRates: { r1: number; r2: number; r3: number };
      baselineComparisonR2?: {
        baselineProbability: number;
        uplift: number;
        isStatisticallySignificant: boolean;
        pValueEstimate: number;
        adjustedPValue?: number;
        isFdrSignificant?: boolean;
      };
      confidenceIntervalR2?: { lower: number; upper: number };
    } | null;
  };
  if (studyOut.result) {
    const r = studyOut.result;
    console.log(`  Sample size: ${r.sampleSize}`);
    console.log(`  Reach rates: 1R=${(r.reachRates.r1 * 100).toFixed(1)}%  2R=${(r.reachRates.r2 * 100).toFixed(1)}%  3R=${(r.reachRates.r3 * 100).toFixed(1)}%`);
    if (r.baselineComparisonR2) {
      const bc = r.baselineComparisonR2;
      console.log(`  Baseline (matched controls): ${(bc.baselineProbability * 100).toFixed(1)}%`);
      console.log(`  Uplift: ${(bc.uplift * 100).toFixed(1)}pp`);
      console.log(`  p-value: ${bc.pValueEstimate.toFixed(4)}`);
      console.log(`  FDR adjusted p-value: ${bc.adjustedPValue?.toFixed(4) ?? 'N/A'}`);
      console.log(`  Statistically significant (p<0.05): ${bc.isStatisticallySignificant}`);
      console.log(`  FDR significant: ${bc.isFdrSignificant ?? false}`);
    }
    if (r.confidenceIntervalR2) {
      const ci = r.confidenceIntervalR2;
      console.log(`  95% CI for 2R: [${(ci.lower * 100).toFixed(1)}%, ${(ci.upper * 100).toFixed(1)}%]`);
    }
  }
  console.log();

  // Step 4: Negative evidence
  console.log('── Step 4: Negative Evidence Impact ────────────────────────────');
  const negEvidence = await agent.invokeTool('evaluate_negative_evidence', {
    eventType: 'fvg',
    htf: '1h',
  });
  const negOut = negEvidence.output as {
    impact: {
      sampleSize: number;
      alignedCount: number;
      conflictedCount: number;
      alignedHitRateR2: number;
      conflictedHitRateR2: number;
      conflictPenalty: number;
      earlyFailureRate: number;
      netEvidenceScore: number;
    };
  };
  const imp = negOut.impact;
  console.log(`  Aligned events: ${imp.alignedCount}  (hit rate: ${(imp.alignedHitRateR2 * 100).toFixed(1)}%)`);
  console.log(`  Conflicted events: ${imp.conflictedCount}  (hit rate: ${(imp.conflictedHitRateR2 * 100).toFixed(1)}%)`);
  console.log(`  Conflict penalty: ${(imp.conflictPenalty * 100).toFixed(1)}pp`);
  console.log(`  Early failure rate: ${(imp.earlyFailureRate * 100).toFixed(1)}%`);
  console.log(`  Net evidence score: ${imp.netEvidenceScore.toFixed(2)}`);
  console.log();

  // Step 5: Walk-forward OOS
  console.log('── Step 5: Walk-Forward OOS Validation ─────────────────────────');
  const walkForward = await agent.invokeTool('run_walk_forward', {
    trainCandlesCount: 200,
    testCandlesCount: 100,
    stepCandlesCount: 100,
    horizonCandles: 24,
  });
  const wfOut = walkForward.output as {
    windowCount: number;
    stability: Array<{
      component: string;
      windowsCount: number;
      meanTrainHitRateR2: number;
      meanTestHitRateR2: number;
      hitRateDegradation: number;
      isStable: boolean;
    }>;
  };
  console.log(`  Windows: ${wfOut.windowCount}`);
  const fvgStability = wfOut.stability.find((s) => s.component === 'fvg');
  if (fvgStability) {
    console.log(`  FVG stability:`);
    console.log(`    Train hit rate (2R): ${(fvgStability.meanTrainHitRateR2 * 100).toFixed(1)}%`);
    console.log(`    Test hit rate (2R): ${(fvgStability.meanTestHitRateR2 * 100).toFixed(1)}%`);
    console.log(`    Degradation: ${(fvgStability.hitRateDegradation * 100).toFixed(1)}pp`);
    console.log(`    Status: ${fvgStability.isStable ? 'STABLE' : 'DEGRADED'}`);
  }
  console.log();

  // Step 6: Regime
  console.log('── Step 6: Regime Classification ───────────────────────────────');
  const regime = classifyRegime(candles, candles.length - 1, 'SOLUSDT', '15m');
  console.log(`  Trend: ${regime.trend}`);
  console.log(`  Volatility: ${regime.volatility}`);
  console.log(`  Liquidity: ${regime.liquidity}`);
  console.log(`  Momentum: ${regime.momentum}`);
  console.log(`  Derivatives: ${regime.derivatives}`);
  console.log(`  Session: ${regime.session}`);
  console.log(`  Summary: ${regime.summary}`);
  console.log();

  // Step 7: Evidence balance
  console.log('── Step 7: Evidence Balance ─────────────────────────────────────');
  const balance = computeEvidenceBalance({
    candles,
    symbol: 'SOLUSDT',
    timeframe: '15m',
    eventType: 'fvg',
    htf: '1h',
  });
  console.log(`  Positive evidence items: ${balance.positiveEvidence.length}`);
  for (const item of balance.positiveEvidence) {
    console.log(`    + ${item.label}: ${item.description}`);
  }
  console.log(`  Negative evidence items: ${balance.negativeEvidence.length}`);
  for (const item of balance.negativeEvidence) {
    console.log(`    - ${item.label}: ${item.description}`);
  }
  console.log(`  Net score: ${balance.netScore.toFixed(3)}`);
  console.log(`  Recommendation: ${balance.recommendation.toUpperCase()}`);
  console.log();

  // Verdict
  console.log('═'.repeat(72));
  console.log('  VERDICT');
  console.log('═'.repeat(72));
  const fvgResult = studyOut.result;
  if (fvgResult?.baselineComparisonR2) {
    const bc = fvgResult.baselineComparisonR2;
    if (bc.isFdrSignificant && bc.uplift > 0) {
      console.log('  [PASS] FVG continuation shows a statistically significant edge');
      console.log('     that survives multiple-testing correction.');
    } else if (bc.isStatisticallySignificant && bc.uplift > 0) {
      console.log('  [CAUTION] FVG continuation shows a nominally significant edge');
      console.log('     but does not survive FDR correction.');
    } else {
      console.log('  [FAIL] FVG continuation does NOT show a statistically');
      console.log('     significant edge over matched controls.');
    }
    console.log();
    console.log(`  Uplift: ${(bc.uplift * 100).toFixed(1)}pp over baseline`);
    console.log(`  p-value: ${bc.pValueEstimate.toFixed(4)} (adjusted: ${bc.adjustedPValue?.toFixed(4) ?? 'N/A'})`);
    if (fvgStability) {
      console.log(`  OOS degradation: ${(fvgStability.hitRateDegradation * 100).toFixed(1)}pp`);
    }
    console.log(`  Evidence balance: ${balance.recommendation} (net=${balance.netScore.toFixed(3)})`);
  }
  console.log('═'.repeat(72));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
