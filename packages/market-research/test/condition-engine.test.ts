import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import type { BaseEvent } from '@nemesis-oss/market-events';
import type { BaseOutcome, ResearchObservation } from '../src/types.js';
import {
  all,
  any,
  not,
  feature,
  contextFeature,
  outcomeFeature,
  htfTrend,
  evaluateCondition
} from '../src/condition-engine.js';

function createDummyObservation(overrides: {
  trendRegime?: 'bullish' | 'bearish' | 'range';
  session?: 'asia' | 'london' | 'new_york' | 'off_hours';
  atr?: number;
  mfeAtr?: number;
  hit2R?: boolean;
  htfTrend1h?: 'bullish' | 'bearish' | 'sideways';
}): ResearchObservation {
  const event: BaseEvent = {
    id: 'ev-1',
    type: 'fvg',
    symbol: 'BTCUSDT',
    timeframe: '15m',
    detectedAt: 1000,
    originIndex: 10,
    direction: 'bullish'
  };

  const outcome: BaseOutcome = {
    eventId: 'ev-1',
    horizonCandles: 24,
    mfe: new Decimal(20),
    mae: new Decimal(5),
    mfeAtr: new Decimal(overrides.mfeAtr ?? 2.5),
    maeAtr: new Decimal(0.5),
    targetHitR: new Decimal(overrides.hit2R ? 2 : -1),
    realizedR: new Decimal(overrides.hit2R ? 2 : -1),
    firstHit: overrides.hit2R ? 'target_first' : 'stop_first',
    timeToFirstHitBars: 4,
    isAmbiguous: false,
    hit1R: overrides.hit2R ?? true,
    hit2R: overrides.hit2R ?? true,
    hit3R: false
  };

  return {
    event,
    context: {
      atr: new Decimal(overrides.atr ?? 10),
      trendRegime: overrides.trendRegime ?? 'bullish',
      volatilityRegime: 'normal',
      session: overrides.session ?? 'london',
      ...(overrides.htfTrend1h ? {
        htfContext: {
          '1h': {
            timeframe: '1h',
            causalCandleCount: 10,
            lastCompletedTimestamp: 900,
            causalAtr: new Decimal(15),
            trend: overrides.htfTrend1h,
            lastClose: new Decimal(100)
          }
        }
      } : {})
    },
    outcome,
    provenance: {
      datasetId: 'BTCUSDT-15m',
      datasetHash: 'abc',
      detectorId: 'fvg',
      detectorVersion: '1.0.0',
      detectorConfigHash: 'def',
      outcomeVersion: '1.0.0'
    }
  };
}

describe('Condition Engine & Predicate Expressions', () => {
  it('evaluates string feature equality and set inclusion', () => {
    const obs = createDummyObservation({ trendRegime: 'bullish', session: 'london' });

    expect(feature('trendRegime').eq('bullish').evaluate(obs)).toBe(true);
    expect(feature('trendRegime').eq('bearish').evaluate(obs)).toBe(false);
    expect(feature('session').in(['london', 'new_york']).evaluate(obs)).toBe(true);
    expect(feature('session').in(['asia']).evaluate(obs)).toBe(false);
  });

  it('strictly separates predictive context features from ex-post outcome features', () => {
    const obs = createDummyObservation({ atr: 12.5, mfeAtr: 3.2, trendRegime: 'bullish' });

    // Predictive context features: zero future outcome leakage
    expect(contextFeature('atr').gte(12).evaluate(obs)).toBe(true);
    expect(contextFeature('trendRegime').eq('bullish').evaluate(obs)).toBe(true);

    // Outcome features for post-stratification only
    expect(outcomeFeature('mfeAtr').gt(3.0).evaluate(obs)).toBe(true);
  });

  it('evaluates numeric feature inequalities', () => {
    const obs = createDummyObservation({ atr: 12.5, mfeAtr: 3.2 });

    expect(feature('atr').gte(12).evaluate(obs)).toBe(true);
    expect(feature('atr').lt(10).evaluate(obs)).toBe(false);
    expect(outcomeFeature('mfeAtr').gt(3.0).evaluate(obs)).toBe(true);
  });

  it('evaluates combinators (all, any, not)', () => {
    const obs = createDummyObservation({ trendRegime: 'bullish', session: 'london' });

    const condAll = all(
      feature('trendRegime').eq('bullish'),
      feature('session').eq('london')
    );
    expect(condAll.evaluate(obs)).toBe(true);

    const condAny = any(
      feature('trendRegime').eq('bearish'),
      feature('session').eq('london')
    );
    expect(condAny.evaluate(obs)).toBe(true);

    const condNot = not(feature('trendRegime').eq('bearish'));
    expect(condNot.evaluate(obs)).toBe(true);
  });

  it('evaluates higher-timeframe trend condition causally', () => {
    const obsBullish = createDummyObservation({ htfTrend1h: 'bullish' });
    const obsBearish = createDummyObservation({ htfTrend1h: 'bearish' });

    const condHtf = htfTrend('1h').eq('bullish');
    expect(condHtf.evaluate(obsBullish)).toBe(true);
    expect(condHtf.evaluate(obsBearish)).toBe(false);
  });

  it('computes conditioned hit rate and uplift with evaluateCondition', () => {
    const observations = [
      createDummyObservation({ session: 'london', hit2R: true }),
      createDummyObservation({ session: 'london', hit2R: true }),
      createDummyObservation({ session: 'asia', hit2R: false }),
      createDummyObservation({ session: 'asia', hit2R: false })
    ];

    const cond = feature('session').eq('london');
    const result = evaluateCondition(observations, cond);

    expect(result.totalObservations).toBe(4);
    expect(result.matchedObservations).toBe(2);
    expect(result.matchRate).toBe(0.5);
    expect(result.unconditionedHitRateR2).toBe(0.5); // 2 of 4 = 50%
    expect(result.conditionedHitRateR2).toBe(1.0);   // 2 of 2 = 100%
    expect(result.upliftR2).toBe(0.5);               // +50% uplift
  });

  it('enforces predictive condition scope vs outcome condition scope', () => {
    const predCond = contextFeature('atr').gte(10);
    expect(predCond.scope).toBe('predictive');

    const outCond = outcomeFeature('mfeAtr').gt(2.0);
    expect(outCond.scope).toBe('outcome');
  });
});
