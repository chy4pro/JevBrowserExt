import { JevRequest, JevResponse, OBSOLETE_OPENROUTER_JEV_MODELS, OpenRouterConfig } from '../types';
import { postJson } from './http';

export const DEFAULT_OPENROUTER_MODEL = 'typesafe/jev-1.13';

/**
 * Maps model ids stored by older installs onto the id OpenRouter accepts today. Unknown ids
 * are passed through unchanged so a newer model can be configured without a code change.
 */
export function normalizeOpenRouterModel(rawModel?: string): string {
  const m = (rawModel || '').trim();
  if (!m) return DEFAULT_OPENROUTER_MODEL;
  return OBSOLETE_OPENROUTER_JEV_MODELS[m] || m;
}

export const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://github.com/chy4pro/JevBrowserExt',
  'X-Title': 'JevBrowserExt',
};

export async function callOpenRouter(
  config: OpenRouterConfig,
  request: JevRequest
): Promise<JevResponse> {
  const apiKey = (config.apiKey || '').trim();
  if (!apiKey) {
    throw new Error('OpenRouter API Key is not configured. Please set it in Options.');
  }

  const endpoint = config.endpoint || 'https://openrouter.ai/api/alpha/decisions';
  const model = normalizeOpenRouterModel(config.model);

  let json;
  try {
    json = await postJson(
      endpoint,
      { Authorization: `Bearer ${apiKey}`, ...OPENROUTER_HEADERS },
      { model, state: request.state, questions: request.questions },
      { label: 'OpenRouter Decisions API' }
    );
  } catch (err: any) {
    const message = err?.message || String(err);
    if (/does not exist|not found|invalid model/i.test(message)) {
      throw new Error(
        `${message} — the configured OpenRouter model id "${model}" is not available. Open Options and set it to "${DEFAULT_OPENROUTER_MODEL}" (or use Reset to defaults).`
      );
    }
    throw err;
  }
  return json as JevResponse;
}
