import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import type { Candle, FvgEvent, OrderBlockEvent, StructureBreakEvent, LiquiditySweepEvent } from '@nemesis-oss/market-events';
import {
  evaluateFvgOutcome,
  evaluateOrderBlockOutcome,
  evaluateStructureOutcome,
  evaluateLiquiditySweepOutcome,
  evaluateGenericOutcome
} from '../src/outcome-evaluators.js';
import { generateMatchedControls } from '../src/matched-controls.js';
import {
  calculateClusterEffectiveSampleSize,
  calculateBootstrapMedianCi,
  compareAgainstBaseline,
  calculateClusterBootstrapComparison
} from '../src/statistical-significance.js';

function makeCandle(ts: number, open: number, high: number, low: number, close: number): Candle {
  return {
    timestamp: ts,
    open: new Decimal(open),
    high: new Decimal(high),
    low: new Decimal(low),
    close: new Decimal(close),
    volume: new Decimal(100)
  };
}

describe('Typed Outcome Evaluators & Competing Risk', () => {
  it('evaluates FVG with real fill depths, invalidation, and reaction', () => {
    const fvg: FvgEvent = {
      id: 'fvg-1',
      type: 'fvg',
      symbol: 'BTCUSDT',
      timeframe: '15m',
      detectedAt: 1000,
      originIndex: 0,
      direction: 'bullish',
      top: new Decimal(100),
      bottom: new Decimal(80),
      consequentEncroachment: new Decimal(90),
      size: new Decimal(20)
    };

    const candles: Candle[] = [
      makeCandle(1000, 75, 80, 70, 78), // origin (0)
      makeCandle(2000, 95, 96, 88, 92), // dips into FVG: pen = 100 - 88 = 12 / 20 = 60% fill
      makeCandle(3000, 92, 150, 90, 145) // expansion to 150 (+50 points from top 100 => 2.5R)
    ];

    const outcome = evaluateFvgOutcome(fvg, candles, new Decimal(10), {
      horizonCandles: 2,
      targetR: 2.0,
      stopAtrMultiplier: 1.0,
      ambiguityPolicy: 'pessimistic'
    });

    expect(outcome.firstTouchBars).toBe(1);
    expect(outcome.fill25).toBe(true);
    expect(outcome.fill50).toBe(true);
    expect(outcome.fill75).toBe(false);
    expect(outcome.isInvalidated).toBe(false);
    expect(outcome.hit2R).toBe(true);
  });

  it('evaluates OrderBlock penetration and breaker block conversion', () => {
    const ob: OrderBlockEvent = {
      id: 'ob-1',
      type: 'order_block',
      symbol: 'BTCUSDT',
      timeframe: '15m',
      detectedAt: 1000,
      originIndex: 0,
      direction: 'bullish',
      top: new Decimal(100),
      bottom: new Decimal(90),
      size: new Decimal(10),
      originCandleIndex: 0
    };

    const candles: Candle[] = [
      makeCandle(1000, 95, 100, 90, 98),
      makeCandle(2000, 98, 99, 85, 86) // closes below bottom 90 -> breaker conversion!
    ];

    const outcome = evaluateOrderBlockOutcome(ob, candles, new Decimal(5));
    expect(outcome.isMitigated).toBe(true);
    expect(outcome.isBreaker).toBe(true);
    expect(outcome.maxPenetrationRatio.toNumber()).toBe(1.5); // (100 - 85) / 10 = 1.5
  });

  it('evaluates competing risk and resolves same-candle collision under pessimistic policy', () => {
    const ev = {
      id: 'gen-1',
      type: 'test',
      symbol: 'BTC',
      timeframe: '15m' as const,
      detectedAt: 1000,
      originIndex: 0,
      direction: 'bullish' as const
    };

    // Entry at close = 100. Target = 100 + 2*10 = 120. Stop = 100 - 1*10 = 90.
    const candlesPessimistic: Candle[] = [
      makeCandle(1000, 98, 101, 97, 100),
      makeCandle(2000, 100, 125, 85, 110) // Single bar breaches both high 125 >= 120 AND low 85 <= 90
    ];

    const outPessimistic = evaluateGenericOutcome(ev, candlesPessimistic, new Decimal(10), {
      horizonCandles: 2,
      targetR: 2.0,
      stopAtrMultiplier: 1.0,
      ambiguityPolicy: 'pessimistic'
    });

    expect(outPessimistic.isAmbiguous).toBe(true);
    expect(outPessimistic.firstHit).toBe('stop_first');

    const outOptimistic = evaluateGenericOutcome(ev, candlesPessimistic, new Decimal(10), {
      horizonCandles: 2,
      targetR: 2.0,
      stopAtrMultiplier: 1.0,
      ambiguityPolicy: 'optimistic'
    });

    expect(outOptimistic.firstHit).toBe('target_first');
  });

  it('ensures stop breach on earlier bar prevents subsequent target_first and freezes MFE', () => {
    const ev = {
      id: 'barrier-1',
      type: 'test',
      symbol: 'BTC',
      timeframe: '15m' as const,
      detectedAt: 1000,
      originIndex: 0,
      direction: 'bullish' as const
    };

    // Entry at close = 100. Target = 120 (2R). Stop = 90 (1R).
    const candles: Candle[] = [
      makeCandle(1000, 98, 101, 97, 100), // origin (entry = 100)
      makeCandle(2000, 99, 102, 85, 88),  // bar 1: low = 85 breaches stop 90!
      makeCandle(3000, 89, 135, 88, 130)  // bar 2: high = 135 reaches target 120, BUT trade was stopped on bar 1!
    ];

    const outcome = evaluateGenericOutcome(ev, candles, new Decimal(10), {
      horizonCandles: 3,
      targetR: 2.0,
      stopAtrMultiplier: 1.0,
      ambiguityPolicy: 'pessimistic'
    });

    expect(outcome.firstHit).toBe('stop_first');
    expect(outcome.timeToFirstHitBars).toBe(1);
    expect(outcome.hit2R).toBe(false); // Did NOT reach target before stopping out!
    expect(outcome.targetHitR.toNumber()).toBe(-1);
    expect(outcome.mfe.toNumber()).toBe(2); // Only favorable excursion before/at stop bar (102 - 100)
  });

  it('halts zone penetration measurement once FVG is invalidated', () => {
    const fvg: FvgEvent = {
      id: 'fvg-inval',
      type: 'fvg',
      symbol: 'BTCUSDT',
      timeframe: '15m',
      detectedAt: 1000,
      originIndex: 0,
      direction: 'bullish',
      top: new Decimal(100),
      bottom: new Decimal(90),
      consequentEncroachment: new Decimal(95),
      size: new Decimal(10)
    };

    const candles: Candle[] = [
      makeCandle(1000, 90, 95, 88, 92),
      makeCandle(2000, 96, 97, 85, 87), // dips to 85 (pen = 15 / 10 = 1.5) and closes at 87 (< 90 => INVALIDATED)
      makeCandle(3000, 86, 88, 60, 65)  // further plunge to 60, but penetration measurement MUST NOT grow after invalidation
    ];

    const outcome = evaluateFvgOutcome(fvg, candles, new Decimal(10));
    expect(outcome.isInvalidated).toBe(true);
    expect(outcome.fullFill).toBe(true);
    expect(outcome.timeToFirstHitBars).toBe(1);
    expect(outcome.firstHit).toBe('stop_first');
  });
});

describe('Direction-Aware Matched Controls', () => {
  it('generates symmetric direction-matched control observations with matched ATR', () => {
    const candles: Candle[] = [];
    let p = new Decimal(100);
    for (let i = 0; i < 40; i++) {
      candles.push(makeCandle(1000 + i * 60000, p.toNumber(), p.plus(2).toNumber(), p.minus(2).toNumber(), p.toNumber()));
      p = p.plus(1);
    }

    const bullEvent: FvgEvent = {
      id: 'bull-1',
      type: 'fvg',
      symbol: 'BTC',
      timeframe: '15m',
      detectedAt: 1000,
      originIndex: 10,
      direction: 'bullish',
      top: new Decimal(110),
      bottom: new Decimal(105),
      consequentEncroachment: new Decimal(107.5),
      size: new Decimal(5)
    };

    const controls = generateMatchedControls([bullEvent], candles);
    expect(controls).toHaveLength(1);
    expect(controls[0]!.direction).toBe('bullish'); // Symmetric direction!
    expect(controls[0]!.controlOriginIndex).not.toBe(10); // Non-event candle
    expect(controls.matchRatio).toBe(1.0);
  });

  it('enforces 1:1 matching without replacement and supports stratified regime matching', () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 30; i++) {
      candles.push(makeCandle(1000 + i * 60000, 100, 102, 98, 100));
    }

    const ev1: BaseEvent = { id: 'e1', type: 'fvg', symbol: 'BTC', timeframe: '15m', detectedAt: 1000, originIndex: 10, direction: 'bullish' };
    const ev2: BaseEvent = { id: 'e2', type: 'fvg', symbol: 'BTC', timeframe: '15m', detectedAt: 2000, originIndex: 12, direction: 'bullish' };

    const controls = generateMatchedControls([ev1, ev2], candles, undefined, { matchTrendRegime: true });
    expect(controls).toHaveLength(2);
    expect(controls[0]!.controlOriginIndex).not.toBe(controls[1]!.controlOriginIndex);
  });
});

describe('Cluster-Aware Statistical Inference', () => {
  it('computes effective sample size via design effect for clustered episodes', () => {
    const clusterSizes = Array(20).fill(5);
    const { effectiveN, designEffect } = calculateClusterEffectiveSampleSize(clusterSizes, 0.25);
    expect(designEffect).toBe(2.0);
    expect(effectiveN).toBe(50);
  });

  it('computes bootstrap confidence interval for continuous median MFE/ATR', () => {
    const mfeValues = [1.2, 1.5, 1.8, 2.0, 2.1, 2.3, 2.5, 3.0, 3.2, 3.5];
    const ci = calculateBootstrapMedianCi(mfeValues, 200);

    expect(ci.pointEstimate).toBeGreaterThan(1.5);
    expect(ci.lower).toBeLessThanOrEqual(ci.pointEstimate);
    expect(ci.upper).toBeGreaterThanOrEqual(ci.pointEstimate);
  });

  it('computes relative uplift and odds ratio against matched baseline', () => {
    const stats = compareAgainstBaseline(60, 100, 40, 100, Array(20).fill(5));

    expect(stats.eventProbability).toBe(0.6);
    expect(stats.baselineProbability).toBe(0.4);
    expect(stats.uplift).toBeCloseTo(0.2);
    expect(stats.relativeUplift).toBeCloseTo(0.5);
    expect(stats.oddsRatio).toBeGreaterThan(1.5);
    expect(stats.effectiveSampleSize).toBeLessThan(100);
  });

  it('computes empirical cluster bootstrap confidence interval and p-value across episodes', () => {
    const evClusters = [
      { hits: 7, trials: 10 }, { hits: 9, trials: 10 }, { hits: 8, trials: 10 },
      { hits: 6, trials: 10 }, { hits: 9, trials: 10 }, { hits: 7, trials: 10 }
    ];
    const ctrlClusters = [
      { hits: 2, trials: 10 }, { hits: 4, trials: 10 }, { hits: 3, trials: 10 },
      { hits: 1, trials: 10 }, { hits: 4, trials: 10 }, { hits: 2, trials: 10 }
    ];

    const boot = calculateClusterBootstrapComparison(evClusters, ctrlClusters, 200);
    expect(boot.pValue).toBeLessThan(0.05);
    expect(boot.confidenceInterval.lower).toBeGreaterThan(0.2);
    expect(boot.confidenceInterval.upper).toBeGreaterThan(boot.confidenceInterval.lower);
  });

  it('separates market excursion behavior from trade execution and resolves path collisions', () => {
    const ev: BaseEvent = {
      id: 'collision-ev',
      type: 'test',
      symbol: 'BTCUSDT',
      timeframe: '15m',
      detectedAt: 1000,
      originIndex: 0,
      direction: 'bullish'
    };
    // Candle 0: close 100
    // Candle 1: high 115 (>= target 110 at +2R), low 90 (<= stop 95 at -1R) -> collision!
    const candles: Candle[] = [
      makeCandle(1000, 100, 102, 98, 100),
      makeCandle(2000, 100, 115, 90, 105)
    ];

    const pessOutcome = evaluateGenericOutcome(ev, candles, new Decimal(5), {
      horizonCandles: 5,
      targetR: 2.0,
      stopAtrMultiplier: 1.0,
      ambiguityPolicy: 'pessimistic'
    });
    expect(pessOutcome.collision).toBe(true);
    expect(pessOutcome.isAmbiguous).toBe(true);
    expect(pessOutcome.pathResolution).toBe('ohlc_pessimistic');
    expect(pessOutcome.stopFirst).toBe(true);
    expect(pessOutcome.targetFirst).toBe(false);
    expect(pessOutcome.targetHitR.toNumber()).toBe(-1); // -1R (stop multiplier)

    const optOutcome = evaluateGenericOutcome(ev, candles, new Decimal(5), {
      horizonCandles: 5,
      targetR: 2.0,
      stopAtrMultiplier: 1.0,
      ambiguityPolicy: 'optimistic'
    });
    expect(optOutcome.collision).toBe(true);
    expect(optOutcome.pathResolution).toBe('ohlc_optimistic');
    expect(optOutcome.targetFirst).toBe(true);
    expect(optOutcome.stopFirst).toBe(false);
    expect(optOutcome.targetHitR.toNumber()).toBe(2);

    const ambigOutcome = evaluateGenericOutcome(ev, candles, new Decimal(5), {
      horizonCandles: 5,
      targetR: 2.0,
      stopAtrMultiplier: 1.0,
      ambiguityPolicy: 'ambiguous'
    });
    expect(ambigOutcome.pathResolution).toBe('ambiguous');
    expect(ambigOutcome.firstHit).toBe('simultaneous_collision');

    // Check excursion behavior metrics
    expect(pessOutcome.mfe.toNumber()).toBe(15);
    expect(pessOutcome.mae.toNumber()).toBe(10);
    expect(pessOutcome.mfeR.toNumber()).toBe(3); // 15 / 5 = 3R
    expect(pessOutcome.maeR.toNumber()).toBe(2); // 10 / 5 = 2R
    expect(pessOutcome.targetHit1R).toBe(true);
    expect(pessOutcome.targetHit2R).toBe(true);
    expect(pessOutcome.targetHit3R).toBe(true);
    expect(pessOutcome.stopHit).toBe(true);
    expect(pessOutcome.timeToTarget).toBe(1);
    expect(pessOutcome.timeToStop).toBe(1);
  });
});
