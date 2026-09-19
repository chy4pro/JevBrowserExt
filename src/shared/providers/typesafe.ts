import { JevRequest, JevResponse, TypeSafeConfig } from '../types';
import { postJson } from './http';

export async function callTypeSafe(
  config: TypeSafeConfig,
  request: JevRequest
): Promise<JevResponse> {
  const apiKey = (config.apiKey || '').trim();
  if (!apiKey) {
    throw new Error('TypeSafe API Key is not configured. Please set it in Options.');
  }

  const endpoint = config.endpoint || 'https://api.typesafe.ai/v1/systemone';
  const model = (config.model || '').trim() || 'jev-latest';

  const json = await postJson(
    endpoint,
    { Authorization: `Bearer ${apiKey}` },
    { model, state: request.state, questions: request.questions },
    { label: 'TypeSafe API' }
  );
  return json as JevResponse;
}
