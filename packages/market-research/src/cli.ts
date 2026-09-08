import { Decimal } from 'decimal.js';
import type { Candle, Timeframe } from '@nemesis-oss/market-events';
import { runUniversalStudy } from './study-runner.js';
import { buildEffectivenessMatrix, formatMatrixMarkdown } from './matrix-report.js';

function generateRealisticCandles(count: number, basePrice: number = 60000): Candle[] {
  const candles: Candle[] = [];
  let currentPrice = new Decimal(basePrice);
  const startTs = Date.now() - count * 15 * 60 * 1000;

  for (let i = 0; i < count; i++) {
    // Multi-cycle trending and pulling-back waves designed to generate structural breaks and order blocks
    const cycle = i % 40;
    let step = 0;

    if (cycle < 10) step = 15;        // initial climb
    else if (cycle < 16) step = -20;   // retracement establishing swing high
    else if (cycle < 26) step = 30;    // powerful expansion breaking the swing high (BOS + OB)
    else if (cycle < 32) step = -15;   // pullback
    else step = 10;                    // continuation

    const deltaDec = new Decimal(step * 4);
    const open = currentPrice;
    const close = open.plus(deltaDec);
    const wickHigh = step > 0 ? 25 : 10;
    const wickLow = step < 0 ? 25 : 10;
    const high = Decimal.max(open, close).plus(wickHigh);
    const low = Decimal.min(open, close).minus(wickLow);
    const volume = new Decimal(100 + Math.abs(step) * 10);

    candles.push({
      timestamp: startTs + i * 15 * 60 * 1000,
      open,
      high,
      low,
      close,
      volume
    });

    currentPrice = close;
  }

  return candles;
}

/**
 * Main execution function for running research studies across all components and timeframes.
 */
export function runResearchCli(symbol: string = 'BTCUSDT'): string {
  const timeframes: Timeframe[] = ['5m', '15m', '1h', '4h'];
  const allStudies = timeframes.flatMap(tf => {
    const candles = generateRealisticCandles(320, 65000);
    return runUniversalStudy(candles, {
      symbol,
      timeframe: tf,
      horizonCandles: 24
    });
  });

  const matrix = buildEffectivenessMatrix(symbol, allStudies);
  return formatMatrixMarkdown(matrix, timeframes);
}

const isMainModule = process.argv[1] && process.argv[1].endsWith('cli.js');
if (isMainModule) {
  const output = runResearchCli(process.argv[2] ?? 'BTCUSDT');
  process.stdout.write(`${output}\n`);
}
