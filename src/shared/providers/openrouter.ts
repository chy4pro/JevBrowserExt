import { JevRequest, JevResponse, OpenRouterConfig } from '../types';
import { postJson } from './http';

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
  const model = (config.model || '').trim() || 'typesafe/jev-1.13';

  const json = await postJson(
    endpoint,
    { Authorization: `Bearer ${apiKey}`, ...OPENROUTER_HEADERS },
    { model, state: request.state, questions: request.questions },
    { label: 'OpenRouter Decisions API' }
  );
  return json as JevResponse;
}
