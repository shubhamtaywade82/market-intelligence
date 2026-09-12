import React, { useState, useEffect, useCallback } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { Select } from '@inkui-cli/select';
import { Spinner } from '@inkui-cli/spinner';
import { darkTheme } from '@inkui-cli/core';
import { runResearchCli, runLiveMarketStudy } from '@nemesis-oss/market-research';

type ViewMode = 'menu' | 'loading' | 'result' | 'error';

interface MenuOption {
  readonly label: string;
  readonly value: string;
  readonly description: string;
}

const MENU_OPTIONS: readonly MenuOption[] = [
  {
    label: '1. BTCUSDT Multi-Timeframe Matrix (15m, 1h, 4h)',
    value: 'btc-mtf',
    description: 'Empirical event edge (+2R hit rates, 95% CI, MFE) & walk-forward stability on BTC'
  },
  {
    label: '2. ETHUSDT Multi-Timeframe Matrix (15m, 1h, 4h)',
    value: 'eth-mtf',
    description: 'Empirical event edge (+2R hit rates, 95% CI, MFE) & walk-forward stability on ETH'
  },
  {
    label: '3. SOLUSDT Multi-Timeframe Matrix (15m, 1h, 4h)',
    value: 'sol-mtf',
    description: 'Empirical event edge (+2R hit rates, 95% CI, MFE) & walk-forward stability on SOL'
  },
  {
    label: '4. BTCUSDT Live Market Study (15m, 7 Days)',
    value: 'btc-live-7d',
    description: 'Live Binance 15m klines with rolling out-of-sample walk-forward validation'
  },
  {
    label: '5. ETHUSDT Live Market Study (15m, 7 Days)',
    value: 'eth-live-7d',
    description: 'Live Binance 15m klines with rolling out-of-sample walk-forward validation'
  },
  {
    label: '6. SOLUSDT Live Market Study (15m, 7 Days)',
    value: 'sol-live-7d',
    description: 'Live Binance 15m klines with rolling out-of-sample walk-forward validation'
  },
  {
    label: '7. Exit',
    value: 'exit',
    description: 'Close interactive TUI'
  }
];

async function executeAction(action: string): Promise<string> {
  switch (action) {
    case 'btc-mtf':
      return runResearchCli('BTCUSDT', { timeframes: ['15m', '1h', '4h'], format: 'terminal' });
    case 'eth-mtf':
      return runResearchCli('ETHUSDT', { timeframes: ['15m', '1h', '4h'], format: 'terminal' });
    case 'sol-mtf':
      return runResearchCli('SOLUSDT', { timeframes: ['15m', '1h', '4h'], format: 'terminal' });
    case 'btc-live-7d':
      return runLiveMarketStudy({ symbol: 'BTCUSDT', timeframe: '15m', days: 7, format: 'terminal' });
    case 'eth-live-7d':
      return runLiveMarketStudy({ symbol: 'ETHUSDT', timeframe: '15m', days: 7, format: 'terminal' });
    case 'sol-live-7d':
      return runLiveMarketStudy({ symbol: 'SOLUSDT', timeframe: '15m', days: 7, format: 'terminal' });
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

const Header: React.FC = () => (
  <Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
    <Text bold color="cyan">
      ◆ Market Intelligence Interactive Terminal
    </Text>
    <Text color="gray">
      Empirical market event research, counterfactual testing & walk-forward validation
    </Text>
  </Box>
);

interface ResultViewProps {
  readonly content: string;
}

const ResultView: React.FC<ResultViewProps> = ({ content }) => (
  <Box flexDirection="column">
    <Text>{content}</Text>
    <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
      <Text color="cyan">[r]</Text>
      <Text color="gray"> Rerun   </Text>
      <Text color="cyan">[m]</Text>
      <Text color="gray"> Main Menu   </Text>
      <Text color="cyan">[q]</Text>
      <Text color="gray"> Quit</Text>
    </Box>
  </Box>
);

export const App: React.FC = () => {
  const { exit } = useApp();
  const [mode, setMode] = useState<ViewMode>('menu');
  const [activeAction, setActiveAction] = useState<string>('');
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  const runStudy = useCallback(async (action: string) => {
    setActiveAction(action);
    setMode('loading');
    try {
      const output = await executeAction(action);
      setResult(output);
      setMode('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMode('error');
    }
  }, []);

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
      return;
    }
    if (mode === 'result' || mode === 'error') {
      if (input === 'm') setMode('menu');
      if (input === 'r' && activeAction) runStudy(activeAction);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header />
      {mode === 'menu' && (
        <Box flexDirection="column">
          <Text color="yellow" bold>
            Select a research study or live validation run:
          </Text>
          <Box marginTop={1}>
            <Select
              theme={darkTheme}
              items={MENU_OPTIONS.map(opt => ({ label: opt.label, value: opt.value }))}
              onSelect={item => {
                if (item.value === 'exit') {
                  exit();
                } else {
                  runStudy(item.value);
                }
              }}
            />
          </Box>
        </Box>
      )}
      {mode === 'loading' && (
        <Box flexDirection="column" marginY={1}>
          <Spinner type="dots" label="Fetching Binance klines and running empirical research study..." theme={darkTheme} />
          <Text color="gray">This computes causal excursion metrics (MFE/MAE/R) and walk-forward stability.</Text>
        </Box>
      )}
      {mode === 'result' && <ResultView content={result} />}
      {mode === 'error' && (
        <Box flexDirection="column" borderColor="red" borderStyle="round" padding={1}>
          <Text color="red" bold>Study Execution Failed:</Text>
          <Text color="white">{error}</Text>
          <Box marginTop={1}>
            <Text color="gray">Press [m] for menu or [q] to exit.</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};

render(<App />);
