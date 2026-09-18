import { AppSettings, JevRequest, JevResponse } from '../types';
import { callCloudflare } from './cloudflare';
import { callOpenRouter } from './openrouter';
import { callTypeSafe } from './typesafe';

export async function callJevProvider(
  settings: AppSettings,
  request: JevRequest
): Promise<JevResponse> {
  const provider = settings.activeProvider;

  switch (provider) {
    case 'typesafe':
      return callTypeSafe(settings.typesafe, request);
    case 'openrouter':
      return callOpenRouter(settings.openrouter, request);
    case 'cloudflare':
      return callCloudflare(settings.cloudflare, request);
    default:
      throw new Error(`Unsupported Jev provider: ${provider}`);
  }
}

export { callCloudflare, callOpenRouter, callTypeSafe };
