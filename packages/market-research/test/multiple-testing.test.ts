import { describe, expect, it } from 'vitest';
import {
  adjustBenjaminiHochberg,
  adjustHolmBonferroni,
  HypothesisRegistry,
  type HypothesisTest
} from '../src/multiple-testing.js';

describe('Multiple Testing Correction & Hypothesis Registry', () => {
  it('controls False Discovery Rate with Benjamini-Hochberg procedure', () => {
    const tests: HypothesisTest[] = [
      { id: 'fvg-ny', description: 'FVG in NY session', pValue: 0.01 },
      { id: 'bos-asia', description: 'BOS in Asia session', pValue: 0.04 },
      { id: 'ob-london', description: 'OB in London session', pValue: 0.03 },
      { id: 'sweep-off', description: 'Sweep in off-hours', pValue: 0.20 }
    ];

    const adjusted = adjustBenjaminiHochberg(tests, 0.05);
    expect(adjusted).toHaveLength(4);

    // Sorted by p-value:
    // Rank 1: p=0.01 -> q = min(4/1*0.01, runningMin) = 0.04 <= 0.05 -> significant
    // Rank 2: p=0.03 -> raw = 4/2*0.03 = 0.06, runningMin from rank 3 is 4/3*0.04 = 0.0533
    // Rank 3: p=0.04 -> raw = 4/3*0.04 = 0.0533
    // Rank 4: p=0.20 -> raw = 0.20
    const rank1 = adjusted.find(r => r.id === 'fvg-ny')!;
    const rank2 = adjusted.find(r => r.id === 'ob-london')!;
    const rank3 = adjusted.find(r => r.id === 'bos-asia')!;
    const rank4 = adjusted.find(r => r.id === 'sweep-off')!;

    expect(rank1.adjustedPValue).toBeCloseTo(0.04, 4);
    expect(rank1.isSignificant).toBe(true);

    expect(rank2.adjustedPValue).toBeCloseTo(0.0533, 4);
    expect(rank2.isSignificant).toBe(false);

    expect(rank3.adjustedPValue).toBeCloseTo(0.0533, 4);
    expect(rank3.isSignificant).toBe(false);

    expect(rank4.adjustedPValue).toBeCloseTo(0.20, 4);
    expect(rank4.isSignificant).toBe(false);
  });

  it('strongly controls Family-Wise Error Rate with Holm-Bonferroni step-down', () => {
    const tests: HypothesisTest[] = [
      { id: 'h1', description: 'Hypothesis 1', pValue: 0.01 },
      { id: 'h2', description: 'Hypothesis 2', pValue: 0.02 },
      { id: 'h3', description: 'Hypothesis 3', pValue: 0.05 }
    ];

    const adjusted = adjustHolmBonferroni(tests, 0.05);
    expect(adjusted).toHaveLength(3);

    // Rank 1: (3 - 1 + 1) * 0.01 = 0.03 <= 0.05 -> significant
    // Rank 2: (3 - 2 + 1) * 0.02 = 0.04 <= 0.05 -> significant
    // Rank 3: (3 - 3 + 1) * 0.05 = 0.05 <= 0.05 -> significant
    expect(adjusted[0]!.adjustedPValue).toBeCloseTo(0.03, 4);
    expect(adjusted[0]!.isSignificant).toBe(true);

    expect(adjusted[1]!.adjustedPValue).toBeCloseTo(0.04, 4);
    expect(adjusted[1]!.isSignificant).toBe(true);

    expect(adjusted[2]!.adjustedPValue).toBeCloseTo(0.05, 4);
    expect(adjusted[2]!.isSignificant).toBe(true);
  });

  it('HypothesisRegistry collects and applies corrections across multiple tests', () => {
    const registry = new HypothesisRegistry();
    registry.register({ id: 't1', description: 'Test 1', pValue: 0.005 });
    registry.register({ id: 't2', description: 'Test 2', pValue: 0.08 });

    expect(registry.getAll()).toHaveLength(2);

    const fdrResults = registry.applyBenjaminiHochberg(0.05);
    expect(fdrResults).toHaveLength(2);
    expect(fdrResults[0]!.isSignificant).toBe(true);
    expect(fdrResults[1]!.isSignificant).toBe(false);

    const fwerResults = registry.applyHolmBonferroni(0.05);
    expect(fwerResults).toHaveLength(2);
  });

  it('handles empty hypotheses array safely', () => {
    expect(adjustBenjaminiHochberg([])).toHaveLength(0);
    expect(adjustHolmBonferroni([])).toHaveLength(0);
  });
});
