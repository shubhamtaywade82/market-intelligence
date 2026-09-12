import React, { useState, useCallback } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { Select } from '@inkui-cli/select';
import { Spinner } from '@inkui-cli/spinner';
import { darkTheme } from '@inkui-cli/core';
import { runResearchCli, runLiveMarketStudy } from '@nemesis-oss/market-research';
import { runResearchAgentCli } from '@nemesis-oss/market-research-agent';
import {
  runAlphaLeaderboard,
  runConfluenceAnalysis,
  runNegativeEvidenceAnalysis
} from './evidence-analysis.js';

type ViewMode = 'symbol' | 'action' | 'loading' | 'result' | 'error';

interface OptionItem {
  readonly label: string;
  readonly value: string;
}

const SYMBOL_OPTIONS: readonly OptionItem[] = [
  { label: 'BTCUSDT (Bitcoin)', value: 'BTCUSDT' },
  { label: 'ETHUSDT (Ethereum)', value: 'ETHUSDT' },
  { label: 'SOLUSDT (Solana)', value: 'SOLUSDT' },
  { label: 'BNBUSDT (Binance Coin)', value: 'BNBUSDT' },
  { label: 'DOGEUSDT (Dogecoin)', value: 'DOGEUSDT' },
  { label: 'Exit', value: 'exit' }
];

const getActionOptions = (symbol: string): readonly OptionItem[] => [
  { label: `1. Universal Effectiveness Matrix (${symbol} 15m, 1h, 4h)`, value: 'mtf-matrix' },
  { label: `2. Component Alpha Leaderboard (All 8 Components ranked)`, value: 'leaderboard' },
  { label: `3. Multi-Component Confluence & Synergy (Pairwise Uplifts)`, value: 'confluence' },
  { label: `4. Negative Evidence & Conflict Impact (HTF Trend vs 15m)`, value: 'negative-evidence' },
  { label: `5. Autonomous Research Agent: Full Strategy Synthesis (LLM)`, value: 'agent-synthesis' },
  { label: `6. Live Rolling Walk-Forward Study (7-Day Out-of-Sample)`, value: 'live-study' },
  { label: '7. Back to Symbol Selection', value: 'change-symbol' },
  { label: '8. Exit', value: 'exit' }
];

async function executeAgentAction(symbol: string): Promise<string> {
  const synthesisPrompt = `Evaluate all causal market events (FVG, Order Block, Liquidity Sweep, BOS, CHOCH, Displacement, VSA) on ${symbol} 15m. Identify which components provide statistically significant +2R edge over matched controls with FDR correction. Then analyze key pairwise confluences (e.g. FVG + Liquidity Sweep, Order Block + BOS) and negative evidence (HTF trend conflict). Conclude with a clear synthesis: what can we use for positive results, and what should be filtered out?`;
  return runResearchAgentCli({
    question: synthesisPrompt,
    symbol,
    timeframe: '15m',
    days: 7,
    htfTimeframes: ['1h'],
    checkOnly: false,
    skipPreflight: false,
    klineMarket: 'spot'
  });
}

async function executeAction(action: string, symbol: string): Promise<string> {
  switch (action) {
    case 'mtf-matrix':
      return runResearchCli(symbol, { timeframes: ['15m', '1h', '4h'], format: 'terminal' });
    case 'leaderboard':
      return runAlphaLeaderboard(symbol, '15m');
    case 'confluence':
      return runConfluenceAnalysis(symbol, '15m');
    case 'negative-evidence':
      return runNegativeEvidenceAnalysis(symbol, '15m');
    case 'live-study':
      return runLiveMarketStudy({ symbol, timeframe: '15m', days: 7, format: 'terminal' });
    case 'agent-synthesis':
      return executeAgentAction(symbol);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

const Header: React.FC<{ symbol?: string | undefined }> = ({ symbol }) => (
  <Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
    <Text bold color="cyan">
      ◆ Market Intelligence Interactive Terminal
    </Text>
    <Text color="gray">
      Universal evidence discovery, multi-component confluence & autonomous agent
    </Text>
    {symbol && (
      <Box marginTop={1}>
        <Text color="yellow">Selected Asset: </Text>
        <Text bold color="white">{symbol}</Text>
      </Box>
    )}
  </Box>
);

const ResultView: React.FC<{ content: string }> = ({ content }) => (
  <Box flexDirection="column">
    <Text>{content}</Text>
    <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
      <Text color="cyan">[r]</Text>
      <Text color="gray"> Rerun   </Text>
      <Text color="cyan">[m]</Text>
      <Text color="gray"> Actions   </Text>
      <Text color="cyan">[s]</Text>
      <Text color="gray"> Change Symbol   </Text>
      <Text color="cyan">[q]</Text>
      <Text color="gray"> Quit</Text>
    </Box>
  </Box>
);

const SymbolSelection: React.FC<{
  onSelect: (sym: string) => void;
  onExit: () => void;
}> = ({ onSelect, onExit }) => (
  <Box flexDirection="column">
    <Text color="yellow" bold>Select crypto asset for empirical research:</Text>
    <Box marginTop={1}>
      <Select
        theme={darkTheme}
        items={SYMBOL_OPTIONS.map(opt => ({ label: opt.label, value: opt.value }))}
        onSelect={item => (item.value === 'exit' ? onExit() : onSelect(item.value))}
      />
    </Box>
  </Box>
);

const ActionSelection: React.FC<{
  symbol: string;
  onSelect: (act: string) => void;
  onBack: () => void;
  onExit: () => void;
}> = ({ symbol, onSelect, onBack, onExit }) => (
  <Box flexDirection="column">
    <Text color="yellow" bold>Select research action for {symbol}:</Text>
    <Box marginTop={1}>
      <Select
        theme={darkTheme}
        items={getActionOptions(symbol).map(opt => ({ label: opt.label, value: opt.value }))}
        onSelect={item => {
          if (item.value === 'exit') onExit();
          else if (item.value === 'change-symbol') onBack();
          else onSelect(item.value);
        }}
      />
    </Box>
  </Box>
);

const LoadingStatus: React.FC<{ action: string; symbol: string }> = ({ action, symbol }) => {
  const isAgent = action.startsWith('agent');
  return (
    <Box flexDirection="column" marginY={1}>
      <Spinner
        type="dots"
        label={
          isAgent
            ? `Research Agent evaluating components & confluences on ${symbol}...`
            : `Computing empirical causal studies and metrics on ${symbol}...`
        }
        theme={darkTheme}
      />
      <Text color="gray">
        {isAgent
          ? 'ReAct cycle with No-Tools Guarantee (enforces empirical verification).'
          : 'Computes MFE/MAE/R excursion metrics, matched baseline uplift, and interactions.'}
      </Text>
    </Box>
  );
};

const ErrorStatus: React.FC<{ error: string }> = ({ error }) => (
  <Box flexDirection="column" borderColor="red" borderStyle="round" padding={1}>
    <Text color="red" bold>Study Execution Failed:</Text>
    <Text color="white">{error}</Text>
    <Box marginTop={1}>
      <Text color="gray">Press [m] for actions, [s] for symbols, or [q] to exit.</Text>
    </Box>
  </Box>
);

export const App: React.FC = () => {
  const { exit } = useApp();
  const [mode, setMode] = useState<ViewMode>('symbol');
  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTCUSDT');
  const [activeAction, setActiveAction] = useState<string>('');
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const runStudy = useCallback(async (action: string, symbol: string) => {
    setActiveAction(action);
    setMode('loading');
    try {
      setResult(await executeAction(action, symbol));
      setMode('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMode('error');
    }
  }, []);

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) exit();
    if (mode === 'result' || mode === 'error') {
      if (input === 'm') setMode('action');
      if (input === 's') setMode('symbol');
      if (input === 'r' && activeAction) runStudy(activeAction, selectedSymbol);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header symbol={mode !== 'symbol' ? selectedSymbol : undefined} />
      {mode === 'symbol' && <SymbolSelection onSelect={sym => { setSelectedSymbol(sym); setMode('action'); }} onExit={exit} />}
      {mode === 'action' && <ActionSelection symbol={selectedSymbol} onSelect={act => runStudy(act, selectedSymbol)} onBack={() => setMode('symbol')} onExit={exit} />}
      {mode === 'loading' && <LoadingStatus action={activeAction} symbol={selectedSymbol} />}
      {mode === 'result' && <ResultView content={result} />}
      {mode === 'error' && <ErrorStatus error={error} />}
    </Box>
  );
};

render(<App />);
