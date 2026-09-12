import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createResearchAgent, type ResearchAgentOptions } from './agent.js';
import {
  formatResearchCliHelp,
  parseResearchAgentCliArgs,
  type ResearchCliArgs,
} from './cli-args.js';
import { checkOllamaReady } from './ollama-preflight.js';
import { resolveResearchContext } from './resolve-context.js';

function agentOptionsFromCli(args: ResearchCliArgs): ResearchAgentOptions {
  return {
    ...(args.ollamaBaseUrl !== undefined ? { ollamaBaseUrl: args.ollamaBaseUrl } : {}),
    ...(args.model !== undefined ? { model: args.model } : {}),
  };
}

export async function runResearchAgentCli(args: ResearchCliArgs): Promise<string> {
  if (!args.skipPreflight) {
    const preflight = await checkOllamaReady({
      baseUrl: args.ollamaBaseUrl,
      model: args.model,
    });
    if (args.checkOnly) {
      return [
        `Ollama OK: ${preflight.baseUrl}`,
        `Model: ${preflight.model} (${preflight.modelAvailable ? 'available' : 'missing — run ollama pull'})`,
        `Tags: ${preflight.availableModels.slice(0, 8).join(', ')}${preflight.availableModels.length > 8 ? '…' : ''}`,
      ].join('\n');
    }
    if (!preflight.modelAvailable) {
      throw new Error(
        `Model "${preflight.model}" not found in Ollama. Available: ${preflight.availableModels.join(', ') || '(none)'}`,
      );
    }
  } else if (args.checkOnly) {
    return 'Skipped Ollama check (--skip-ollama-check).';
  }

  const context = await resolveResearchContext(args);
  const agent = createResearchAgent(context, agentOptionsFromCli(args));
  const outcome = await agent.research(args.question);

  const header = [
    `# Research Agent Report`,
    ``,
    `- Status: **${outcome.status}**`,
    `- Dataset: ${outcome.dataset.symbol} ${outcome.dataset.timeframe} (${outcome.dataset.candleCount} candles)`,
    `- Tool intents: ${outcome.intentsDispatched}`,
    `- Wall time: ${(outcome.totalWallTimeMs / 1000).toFixed(1)}s`,
    `- Tokens in/out: ${outcome.totalTokensIn}/${outcome.totalTokensOut}`,
    ``,
    `---`,
    ``,
  ].join('\n');

  return `${header}${outcome.report}\n`;
}

const isMainModule = (): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === path.resolve(entry);
};

if (isMainModule()) {
  const rawArgs = process.argv.slice(2).filter(a => a !== '--');
  if (rawArgs.includes('-h') || rawArgs.includes('--help')) {
    process.stdout.write(`${formatResearchCliHelp()}\n`);
  } else {
    try {
      const parsed = parseResearchAgentCliArgs(rawArgs);
      const output = await runResearchAgentCli(parsed);
      process.stdout.write(`${output}\n`);
      process.exit(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`research-agent: ${message}\n`);
      process.exitCode = 1;
    }
  }
}
