import type { Timeframe } from '@nemesis-oss/market-events';

const VALID_TIMEFRAMES = new Set<Timeframe>([
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '1w', '1M',
]);

export const DEFAULT_RESEARCH_QUESTION =
  'Does bullish FVG continuation on this dataset provide a statistically significant +2R edge over matched controls after FDR correction, and does walk-forward validation show stable out-of-sample performance?';

export interface ResearchCliArgs {
  readonly question: string;
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly days: number;
  readonly datasetPath?: string | undefined;
  readonly htfTimeframes: readonly Timeframe[];
  readonly ollamaBaseUrl?: string | undefined;
  readonly model?: string | undefined;
  readonly skipPreflight: boolean;
  readonly checkOnly: boolean;
}

function readFlagValue(args: readonly string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  if (!value || value.startsWith('-')) return undefined;
  return value;
}

function parseTimeframes(raw: string | undefined): Timeframe[] {
  if (!raw) return [];
  const parts = raw.split(',').map(p => p.trim()).filter(Boolean);
  const invalid = parts.filter(p => !VALID_TIMEFRAMES.has(p as Timeframe));
  if (invalid.length > 0) {
    throw new Error(`Invalid HTF timeframe(s): ${invalid.join(', ')}`);
  }
  return parts as Timeframe[];
}

function collectQuestionText(args: readonly string[]): string | undefined {
  const qFlag = readFlagValue(args, '--question');
  if (qFlag) return qFlag;

  const flagsWithValues = new Set([
    '--symbol', '--timeframe', '--days', '--dataset', '--htf', '--ollama', '--model', '--question',
  ]);
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith('-')) {
      if (flagsWithValues.has(arg)) i++;
      continue;
    }
    positional.push(arg);
  }
  return positional.length > 0 ? positional.join(' ') : undefined;
}

export function parseResearchAgentCliArgs(args: readonly string[]): ResearchCliArgs {
  const tfRaw = readFlagValue(args, '--timeframe') ?? '15m';
  if (!VALID_TIMEFRAMES.has(tfRaw as Timeframe)) {
    throw new Error(`Invalid --timeframe: ${tfRaw}`);
  }

  const daysRaw = readFlagValue(args, '--days') ?? '14';
  const days = Number.parseInt(daysRaw, 10);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`Invalid --days: ${daysRaw}`);
  }

  return {
    question: collectQuestionText(args) ?? DEFAULT_RESEARCH_QUESTION,
    symbol: readFlagValue(args, '--symbol') ?? 'BTCUSDT',
    timeframe: tfRaw as Timeframe,
    days,
    datasetPath: readFlagValue(args, '--dataset'),
    htfTimeframes: parseTimeframes(readFlagValue(args, '--htf')),
    ollamaBaseUrl: readFlagValue(args, '--ollama'),
    model: readFlagValue(args, '--model'),
    skipPreflight: args.includes('--skip-ollama-check'),
    checkOnly: args.includes('--check-ollama'),
  };
}

export function formatResearchCliHelp(): string {
  return `Usage: research-agent [question] [options]

Options:
  --question TEXT       Research objective (default: built-in FVG edge question)
  --symbol SYMBOL       Trading pair (default: BTCUSDT)
  --timeframe TF        Primary timeframe (default: 15m)
  --days N              History window when fetching from exchange (default: 14)
  --dataset PATH        Load candles from market-research JSON cache instead of fetching
  --htf 1h,4h           Optional higher timeframes for HTF context tools
  --ollama URL          Ollama base URL (default: OLLAMA_BASE_URL or localhost:11434)
  --model NAME          Ollama model tag (default: RESEARCH_AGENT_MODEL or openbmb/minicpm5-2b)
  --check-ollama        Verify Ollama + model, then exit
  --skip-ollama-check   Run without preflight (not recommended)
  -h, --help            Show this help
`;
}
