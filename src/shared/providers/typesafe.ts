import { JevRequest, JevResponse, TypeSafeConfig } from '../types';

export async function callTypeSafe(
  config: TypeSafeConfig,
  request: JevRequest
): Promise<JevResponse> {
  if (!config.apiKey) {
    throw new Error('TypeSafe API Key is not configured. Please set it in Options.');
  }

  const endpoint = config.endpoint || 'https://api.typesafe.ai/v1/systemone';
  const model = config.model || 'jev-latest';

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
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`TypeSafe API error (HTTP ${response.status}): ${errorText}`);
  }

  const json = await response.json();
  return json as JevResponse;
}
