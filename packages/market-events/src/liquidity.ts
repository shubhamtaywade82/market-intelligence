import { Decimal } from 'decimal.js';
import type {
  Candle,
  LiquidityPool,
  LiquidityPoolType,
  LiquiditySweepEvent,
  SwingPoint,
  Timeframe
} from './types.js';

export interface SweepOptions {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly equalLevelToleranceRatio?: number;
}

/**
 * Builds liquidity pools from swing points, identifying single levels, equal highs/lows, and clusters.
 */
export function buildLiquidityPools(
  swings: readonly SwingPoint[],
  toleranceRatio: number = 0.0015
): LiquidityPool[] {
  const pools: LiquidityPool[] = [];
  const highSwings = swings.filter(s => s.type === 'high');
  const lowSwings = swings.filter(s => s.type === 'low');

  // Process Buy-Side Liquidity (BSL)
  const usedHighIds = new Set<string>();
  for (let i = 0; i < highSwings.length; i++) {
    const s1 = highSwings[i]!;
    if (usedHighIds.has(s1.id)) continue;

    const cluster = [s1];
    for (let j = i + 1; j < highSwings.length; j++) {
      const s2 = highSwings[j]!;
      if (usedHighIds.has(s2.id)) continue;
      const diff = s1.price.minus(s2.price).abs();
      if (diff.dividedBy(s1.price).lte(toleranceRatio)) {
        cluster.push(s2);
        usedHighIds.add(s2.id);
      }
    }

    const poolType: LiquidityPoolType = cluster.length >= 3 ? 'cluster' : cluster.length === 2 ? 'equal_highs' : 'single_high';
    const maxPrice = cluster.reduce((max, s) => Decimal.max(max, s.price), new Decimal(0));

    pools.push({
      poolId: `pool-bsl-${s1.timestamp}-${poolType}`,
      price: maxPrice,
      targetType: 'bsl',
      poolType,
      strength: cluster.length >= 2 ? 'composite' : (s1.strength ?? 'minor'),
      formationTime: cluster[cluster.length - 1]!.timestamp,
      touchCount: cluster.length,
      source: 'swings',
      status: 'active'
    });
  }

  // Process Sell-Side Liquidity (SSL)
  const usedLowIds = new Set<string>();
  for (let i = 0; i < lowSwings.length; i++) {
    const s1 = lowSwings[i]!;
    if (usedLowIds.has(s1.id)) continue;

    const cluster = [s1];
    for (let j = i + 1; j < lowSwings.length; j++) {
      const s2 = lowSwings[j]!;
      if (usedLowIds.has(s2.id)) continue;
      const diff = s1.price.minus(s2.price).abs();
      if (diff.dividedBy(s1.price).lte(toleranceRatio)) {
        cluster.push(s2);
        usedLowIds.add(s2.id);
      }
    }

    const poolType: LiquidityPoolType = cluster.length >= 3 ? 'cluster' : cluster.length === 2 ? 'equal_lows' : 'single_low';
    const minPrice = cluster.reduce((min, s) => Decimal.min(min, s.price), new Decimal(Infinity));

    pools.push({
      poolId: `pool-ssl-${s1.timestamp}-${poolType}`,
      price: minPrice,
      targetType: 'ssl',
      poolType,
      strength: cluster.length >= 2 ? 'composite' : (s1.strength ?? 'minor'),
      formationTime: cluster[cluster.length - 1]!.timestamp,
      touchCount: cluster.length,
      source: 'swings',
      status: 'active'
    });
  }

  return pools;
}

/**
 * Detects liquidity sweeps against liquidity pools with deduplication to the deepest sweep.
 */
export function detectLiquiditySweeps(
  candles: readonly Candle[],
  swings: readonly SwingPoint[],
  options: SweepOptions
): LiquiditySweepEvent[] {
  const tolerance = options.equalLevelToleranceRatio ?? 0.0015;
  const pools = buildLiquidityPools(swings, tolerance);
  const sweeps: LiquiditySweepEvent[] = [];

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!;
    // Only evaluate pools formed prior to or at this candle
    const activePools = pools.filter(p => p.formationTime <= candle.timestamp);

    let deepestBsl: { pool: LiquidityPool; extreme: Decimal } | null = null;
    let deepestSsl: { pool: LiquidityPool; extreme: Decimal } | null = null;

    for (const pool of activePools) {
      if (pool.targetType === 'bsl') {
        if (candle.high.gt(pool.price) && candle.close.lte(pool.price)) {
          if (!deepestBsl || candle.high.minus(pool.price).gt(deepestBsl.extreme.minus(deepestBsl.pool.price))) {
            deepestBsl = { pool, extreme: candle.high };
          }
        }
      } else {
        if (candle.low.lt(pool.price) && candle.close.gte(pool.price)) {
          if (!deepestSsl || pool.price.minus(candle.low).gt(deepestSsl.pool.price.minus(deepestSsl.extreme))) {
            deepestSsl = { pool, extreme: candle.low };
          }
        }
      }
    }

    if (deepestBsl) {
      sweeps.push({
        id: `${options.symbol}-${options.timeframe}-sweep-bsl-${candle.timestamp}`,
        type: 'liquidity_sweep',
        symbol: options.symbol,
        timeframe: options.timeframe,
        detectedAt: candle.timestamp,
        originIndex: i,
        direction: 'bearish',
        sweptLevel: deepestBsl.pool.price,
        sweepExtreme: deepestBsl.extreme,
        targetType: 'bsl',
        reclaimed: true,
        poolId: deepestBsl.pool.poolId,
        poolType: deepestBsl.pool.poolType,
        penetrationTicks: deepestBsl.extreme.minus(deepestBsl.pool.price)
      });
    }

    if (deepestSsl) {
      sweeps.push({
        id: `${options.symbol}-${options.timeframe}-sweep-ssl-${candle.timestamp}`,
        type: 'liquidity_sweep',
        symbol: options.symbol,
        timeframe: options.timeframe,
        detectedAt: candle.timestamp,
        originIndex: i,
        direction: 'bullish',
        sweptLevel: deepestSsl.pool.price,
        sweepExtreme: deepestSsl.extreme,
        targetType: 'ssl',
        reclaimed: true,
        poolId: deepestSsl.pool.poolId,
        poolType: deepestSsl.pool.poolType,
        penetrationTicks: deepestSsl.pool.price.minus(deepestSsl.extreme)
      });
    }
  }

  return sweeps;
}
