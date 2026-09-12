export interface OllamaPreflightOptions {
  readonly baseUrl?: string | undefined;
  readonly model?: string | undefined;
}

export interface OllamaPreflightResult {
  readonly baseUrl: string;
  readonly model: string;
  readonly modelAvailable: boolean;
  readonly availableModels: readonly string[];
}

/**
 * Verify Ollama is reachable and report whether the requested model tag exists locally.
 */
export async function checkOllamaReady(
  options: OllamaPreflightOptions = {},
): Promise<OllamaPreflightResult> {
  const baseUrl = (options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434').replace(/\/$/, '');
  const model = options.model ?? process.env.RESEARCH_AGENT_MODEL ?? 'openbmb/minicpm5-2b';

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Ollama not reachable at ${baseUrl}: ${msg}`);
  }

  if (!response.ok) {
    throw new Error(`Ollama tags API returned ${response.status} at ${baseUrl}`);
  }

  const body = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
  const availableModels = (body.models ?? [])
    .map(m => m.name ?? m.model ?? '')
    .filter(Boolean);

  const modelAvailable =
    availableModels.includes(model) ||
    availableModels.some(tag => tag.startsWith(`${model}:`) || tag === model);

  return { baseUrl, model, modelAvailable, availableModels };
}
