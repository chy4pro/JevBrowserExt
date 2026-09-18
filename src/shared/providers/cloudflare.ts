import { CloudflareConfig, JevRequest, JevResponse } from '../types';

export async function callCloudflare(
  config: CloudflareConfig,
  request: JevRequest
): Promise<JevResponse> {
  if (!config.accountId || !config.apiToken) {
    throw new Error('Cloudflare Account ID and API Token must be configured. Please set them in Options.');
  }

  const endpoint =
    config.endpoint ||
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId.trim()}/ai/run`;
  const model = config.model || 'typesafe/jev';

  const body = {
    model,
    input: {
      state: request.state,
      questions: request.questions,
    },
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiToken.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cloudflare AI error (HTTP ${response.status}): ${errorText}`);
  }

  const json = await response.json();

  // Cloudflare often wraps the response in { success: true, result: ... }
  if (json && typeof json === 'object' && 'result' in json && json.result) {
    const result = json.result;
    return {
      model: result.model || model,
      answers: result.answers || result,
      usage: result.usage,
    };
  }

  return json as JevResponse;
}
