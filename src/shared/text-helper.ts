import { TEXT_VALUE_PROMPT } from './prompts';
import { AppSettings, PageAction, RecentAction } from './types';

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
  recent_actions: RecentAction[];
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
    recent_actions: history.slice(-6),
  };
}

export async function generateFieldText(
  settings: AppSettings,
  context: FieldContext
): Promise<string> {
  const cfg = settings.textHelper;

  let apiKey = cfg.apiKey;
  let baseUrl = cfg.baseUrl || 'https://openrouter.ai/api/v1';
  let model = cfg.model || 'deepseek/deepseek-chat';

  // Fallback to OpenRouter key if user hasn't set separate text helper key
  if (!apiKey && settings.activeProvider === 'openrouter' && settings.openrouter.apiKey) {
    apiKey = settings.openrouter.apiKey;
    baseUrl = 'https://openrouter.ai/api/v1';
  }

  // Sanitize model identifiers for OpenRouter
  if (baseUrl.includes('openrouter.ai')) {
    if (model === 'deepseek-chat') {
      model = 'deepseek/deepseek-chat';
    } else if (model === 'deepseek-reasoner') {
      model = 'deepseek/deepseek-r1';
    } else if (model.includes('1.5-8b') || model.includes('2.0-flash') || !model.trim()) {
      model = 'deepseek/deepseek-chat';
    }
  }

  if (!apiKey) {
    throw new Error(
      'Text Generation Helper requires an API Key for TYPE_TEXT operations. Please configure it in Options.'
    );
  }

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const messages = [
    { role: 'system', content: TEXT_VALUE_PROMPT },
    { role: 'user', content: JSON.stringify(context) },
  ];

  const payload: Record<string, any> = {
    model,
    max_tokens: 512,
    messages,
  };

  let response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/browser-use/jev-browser-ext',
      'X-Title': 'JevBrowserExt',
    },
    body: JSON.stringify(payload),
  });

  // If error on OpenRouter, fallback to deepseek/deepseek-chat or google/gemini-3.7-flash
  if (!response.ok && baseUrl.includes('openrouter.ai') && payload.model !== 'deepseek/deepseek-chat') {
    payload.model = 'deepseek/deepseek-chat';
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/browser-use/jev-browser-ext',
        'X-Title': 'JevBrowserExt',
      },
      body: JSON.stringify(payload),
    });
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Text helper HTTP ${response.status}: ${errorText}`);
  }

  const json = await response.json();
  const rawContent = json.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error('Text helper returned empty message');
  }

  // Strip possible markdown code blocks ```json ... ```
  const cleanedContent = rawContent
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();

  try {
    const parsed = JSON.parse(cleanedContent);
    const textVal = parsed.text;
    if (textVal === null || textVal === undefined) {
      throw new Error('Text helper determined value is missing from goal context');
    }
    return String(textVal);
  } catch (err: any) {
    const match = cleanedContent.match(/"text"\s*:\s*"([^"]+)"/);
    if (match) return match[1];
    // If model answered with raw plaintext, extract the first non-empty line
    const fallbackText = cleanedContent.split('\n')[0].trim();
    if (fallbackText) return fallbackText;
    throw new Error(`Failed to parse text helper JSON: ${err.message || String(err)}`);
  }
}
