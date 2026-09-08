import { describe, expect, it } from 'vitest';
import { buildEffectivenessMatrix, formatMatrixMarkdown } from '../src/matrix-report.js';
import type { ComponentStudyResult } from '../src/types.js';

describe('Effectiveness Matrix Reporting', () => {
  it('aggregates multi-timeframe study results and formats markdown report', () => {
    const mockStudies: ComponentStudyResult[] = [
      {
        symbol: 'BTCUSDT',
        timeframe: '5m',
        eventType: 'fvg',
        sampleSize: 1200,
        retestProbability: 0.81,
        fill25Rate: 0.72,
        fill50Rate: 0.55,
        fullFillRate: 0.38,
        medianMfeAtr: 1.45,
        medianMaeAtr: 0.75,
        hitRates: { r1: 0.61, r2: 0.47, r3: 0.28 }
      },
      {
        symbol: 'BTCUSDT',
        timeframe: '15m',
        eventType: 'fvg',
        sampleSize: 650,
        retestProbability: 0.84,
        fill25Rate: 0.78,
        fill50Rate: 0.62,
        fullFillRate: 0.41,
        medianMfeAtr: 1.82,
        medianMaeAtr: 0.58,
        hitRates: { r1: 0.68, r2: 0.54, r3: 0.36 }
      }
    ];

    const matrix = buildEffectivenessMatrix('BTCUSDT', mockStudies);
    expect(matrix.rows).toHaveLength(1);
    expect(matrix.rows[0]!.component).toBe('fvg');

    const markdown = formatMatrixMarkdown(matrix, ['5m', '15m']);
    expect(markdown).toContain('# Effectiveness Matrix: BTCUSDT');
    expect(markdown).toContain('47.0% (1.45 ATR, n=1200)');
    expect(markdown).toContain('54.0% (1.82 ATR, n=650)');
  });
});
