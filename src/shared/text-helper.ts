import { TEXT_VALUE_PROMPT } from './prompts';
import { OPENROUTER_HEADERS } from './providers/openrouter';
import { postJson } from './providers/http';
import { AppSettings, PageAction, RecentAction, TEXT_HELPER_PRESETS } from './types';

export interface FieldContext {
  goal: string;
  field: {
    label?: string;
    role?: string;
    value?: string;
  };
  page: {
    title: string;
    text: string;
  };
  recent_actions: Array<Pick<RecentAction, 'action' | 'text'>>;
}

export function createFieldContext(
  goal: string,
  action: PageAction,
  page: { title: string; text: string },
  history: RecentAction[]
): FieldContext {
  return {
    goal,
    field: {
      label: action.label,
      role: action.role,
      value: action.value,
    },
    page: {
      title: page.title,
      text: page.text.slice(0, 6000),
    },
    recent_actions: history.slice(-6).map((h) => ({ action: h.action, text: h.text })),
  };
}

const MAX_TEXT_LENGTH = 2000;

export interface HelperKeyStatus {
  provider: string;
  baseUrl: string;
  model: string;
  /** Where the key comes from, or null when none is available. */
  source: 'helper' | 'openrouter' | null;
  message: string;
}

/** Explains which key the text helper will use for the current settings, before any request is made. */
export function describeHelperKey(settings: AppSettings): HelperKeyStatus {
  const cfg = settings.textHelper;
  const preset = TEXT_HELPER_PRESETS[cfg.provider] || TEXT_HELPER_PRESETS.openrouter;
  const baseUrl = ((cfg.baseUrl || '').trim() || preset.baseUrl).replace(/\/+$/, '');
  const model = (cfg.model || '').trim() || preset.model;
  const own = (cfg.apiKey || '').trim();
  const openrouterKey = (settings.openrouter.apiKey || '').trim();
  const viaOpenRouter = baseUrl.includes('openrouter.ai');
  if (own) return { provider: cfg.provider, baseUrl, model, source: 'helper', message: `Text helper uses its own key for ${model} at ${baseUrl}.` };
  if (viaOpenRouter && openrouterKey) return { provider: cfg.provider, baseUrl, model, source: 'openrouter', message: `Text helper reuses the OpenRouter key for ${model}.` };
  const hint = viaOpenRouter
    ? 'Enter an OpenRouter key in the Jev provider section or in the Text helper section.'
    : `The text helper is set to "${cfg.provider}" (${baseUrl}); the OpenRouter key is only shared for OpenRouter. Enter a key for that provider, or switch the helper provider back to OpenRouter (Reset to defaults does this).`;
  return { provider: cfg.provider, baseUrl, model, source: null, message: `No API key for the text helper. ${hint}` };
}

/**
 * Asks the small text model for exactly one field value. Any malformed or empty answer
 * is rejected so nothing is ever typed that the model did not explicitly return.
 */
export async function generateFieldText(
  settings: AppSettings,
  context: FieldContext
): Promise<string> {
  const cfg = settings.textHelper;
  const status = describeHelperKey(settings);
  const { baseUrl, model } = status;

  // Share the OpenRouter key only when the helper actually talks to OpenRouter.
  const apiKey =
    status.source === 'helper'
      ? (cfg.apiKey || '').trim()
      : status.source === 'openrouter'
      ? (settings.openrouter.apiKey || '').trim()
      : '';
  if (!apiKey) {
    throw new Error(`TYPE_TEXT cannot run: ${status.message} No text is guessed by the executor.`);
  }

  const isOpenRouter = baseUrl.includes('openrouter.ai');
  const isDeepSeek = baseUrl.includes('api.deepseek.com');

  const payload: Record<string, any> = {
    model,
    max_tokens: 1024,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: TEXT_VALUE_PROMPT },
      { role: 'user', content: JSON.stringify(context) },
    ],
    ...(isDeepSeek ? { thinking: { type: 'disabled' } } : {}),
  };

  const json = await postJson(
    `${baseUrl}/chat/completions`,
    { Authorization: `Bearer ${apiKey}`, ...(isOpenRouter ? OPENROUTER_HEADERS : {}) },
    payload,
    { label: 'Text helper' }
  );

  const rawContent = json?.choices?.[0]?.message?.content;
  if (typeof rawContent !== 'string' || !rawContent.trim()) {
    throw new Error('Text helper returned an empty message; nothing typed.');
  }

  return parseFieldText(rawContent);
}

export function parseFieldText(rawContent: string): string {
  // Tolerate ```json fences, but nothing else: the body must be the JSON object itself.
  const cleaned = rawContent.replace(/```(?:json)?/gi, '').trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Text helper did not return a JSON object; nothing typed.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('text' in parsed)) {
    throw new Error('Text helper JSON is missing the "text" key; nothing typed.');
  }
  const value = parsed.text;
  if (value === null) {
    throw new Error('Text helper found no value for this field in the goal; nothing typed.');
  }
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_TEXT_LENGTH) {
    throw new Error('Text helper returned an invalid field value; nothing typed.');
  }
  return value;
}
