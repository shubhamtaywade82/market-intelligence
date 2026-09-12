import type { EvidenceStatus, ResearchResult } from './types.js';
import type { StabilitySummary } from './walk-forward.js';

export type AgentRunStatus = 'ACHIEVED' | 'PARTIAL' | 'CEDED' | 'FAILED';

/**
 * Read-only deterministic gate payload for execution layers (crypto-agent kernel).
 * Numbers come only from {@link ResearchResult}; agent prose is never used for gating.
 */
export interface FvgEvidenceTradingSignal {
  readonly kind: 'fvg_evidence';
  readonly readOnly: true;
  readonly symbol: string;
  readonly timeframe: string;
  readonly klineMarket: 'spot' | 'usdm_futures';
  readonly evidenceStatus: EvidenceStatus;
  readonly mayConsiderSetup: boolean;
  readonly reachRate2R: number;
  readonly matchedControlRate2R: number;
  readonly upliftVsControls: number;
  readonly pValueEstimate: number;
  readonly isFdrSignificant: boolean;
  readonly sampleSize: number;
  readonly walkForwardStable: boolean | null;
  readonly agentRunStatus: AgentRunStatus | null;
  readonly agentReportExcerpt: string | null;
}

export function findResearchResultByEventType(
  results: readonly ResearchResult[],
  eventType: string
): ResearchResult | undefined {
  return results.find(r => r.sample.eventType === eventType);
}

export function isWalkForwardStableForComponent(
  stability: readonly StabilitySummary[],
  component: string
): boolean | null {
  const row = stability.find(s => s.component.toLowerCase() === component.toLowerCase());
  if (!row) return null;
  return row.isStable;
}

const BLOCKED: ReadonlySet<EvidenceStatus> = new Set([
  'confounded',
  'insufficient_sample',
  'descriptive_only',
]);

const ALLOWED: ReadonlySet<EvidenceStatus> = new Set([
  'robust',
  'exploratory',
  'oos_supported',
  'train_supported',
]);

export function computeMayConsiderSetup(
  result: ResearchResult,
  options: {
    walkForwardStable?: boolean | null;
    requireWalkForwardStable?: boolean;
    requireFdr?: boolean;
  } = {}
): boolean {
  const status = result.evidenceStatus ?? 'descriptive_only';
  if (BLOCKED.has(status)) return false;
  if (!ALLOWED.has(status)) return false;
  if (result.effect.uplift <= 0) return false;
  if (options.requireFdr && !result.dependence.isFdrSignificant) return false;
  if (options.requireWalkForwardStable && options.walkForwardStable === false) return false;
  return true;
}

export function buildFvgEvidenceSignal(
  fvg: ResearchResult,
  options: {
    klineMarket?: 'spot' | 'usdm_futures';
    walkForwardStable?: boolean | null;
    requireWalkForwardStable?: boolean;
    agentRunStatus?: AgentRunStatus | null;
    agentReport?: string | null;
  } = {}
): FvgEvidenceTradingSignal {
  const wfStable = options.walkForwardStable ?? null;
  return {
    kind: 'fvg_evidence',
    readOnly: true,
    symbol: fvg.population.symbol,
    timeframe: fvg.population.timeframe,
    klineMarket: options.klineMarket ?? 'usdm_futures',
    evidenceStatus: fvg.evidenceStatus ?? 'descriptive_only',
    mayConsiderSetup: computeMayConsiderSetup(fvg, {
      walkForwardStable: wfStable,
      requireWalkForwardStable: options.requireWalkForwardStable ?? false,
    }),
    reachRate2R: fvg.descriptive.reachRates.r2,
    matchedControlRate2R: fvg.controls.matchedHitRateR2,
    upliftVsControls: fvg.effect.uplift,
    pValueEstimate: fvg.dependence.pValueEstimate,
    isFdrSignificant: fvg.dependence.isFdrSignificant ?? false,
    sampleSize: fvg.sample.sampleSize,
    walkForwardStable: wfStable,
    agentRunStatus: options.agentRunStatus ?? null,
    agentReportExcerpt: options.agentReport
      ? options.agentReport.slice(0, 500)
      : null,
  };
}
