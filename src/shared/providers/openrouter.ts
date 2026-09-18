import { JevRequest, JevResponse, OpenRouterConfig } from '../types';

export async function callOpenRouter(
  config: OpenRouterConfig,
  request: JevRequest
): Promise<JevResponse> {
  if (!config.apiKey) {
    throw new Error('OpenRouter API Key is not configured. Please set it in Options.');
  }

  const endpoint = config.endpoint || 'https://openrouter.ai/api/alpha/decisions';
  let model = config.model || 'typesafe/jev-1.13';
  // Automatically correct obsolete/non-existent model slug from previous cache
  if (model === 'typesafe/jev-latest' || !model.trim()) {
    model = 'typesafe/jev-1.13';
  }

  const body = {
    model,
    state: request.state,
    questions: request.questions,
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey.trim()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/browser-use/jev-browser-ext',
      'X-Title': 'JevBrowserExt',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter Decisions API error (HTTP ${response.status}): ${errorText}`);
  }

  const json = await response.json();
  return json as JevResponse;
}
