import { AppSettings, JevRequest, JevResponse } from '../types';
import { callCloudflare } from './cloudflare';
import { callOpenRouter, normalizeOpenRouterModel } from './openrouter';
import { callTypeSafe } from './typesafe';

export function activeJevModel(settings: AppSettings): string {
  switch (settings.activeProvider) {
    case 'typesafe':
      return settings.typesafe.model || 'jev-latest';
    case 'openrouter':
      return normalizeOpenRouterModel(settings.openrouter.model);
    case 'cloudflare':
      return settings.cloudflare.model || 'typesafe/jev';
    default:
      return '';
  }
}

export async function callJevProvider(
  settings: AppSettings,
  request: JevRequest
): Promise<JevResponse> {
  switch (settings.activeProvider) {
    case 'typesafe':
      return callTypeSafe(settings.typesafe, request);
    case 'openrouter':
      return callOpenRouter(settings.openrouter, request);
    case 'cloudflare':
      return callCloudflare(settings.cloudflare, request);
    default:
      throw new Error(`Unsupported Jev provider: ${String(settings.activeProvider)}`);
  }
}

export { callCloudflare, callOpenRouter, callTypeSafe, normalizeOpenRouterModel };
export { postJson } from './http';
