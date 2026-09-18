import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFieldContext, generateFieldText } from '../src/shared/text-helper';
import { AppSettings, DEFAULT_SETTINGS, PageAction } from '../src/shared/types';

describe('Text Helper (TYPE_TEXT value generator)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('createFieldContext correctly limits page text and formats field details', () => {
    const action: PageAction = {
      id: 'e1',
      kind: 'fill',
      label: 'Where from?',
      role: 'textbox',
      value: '',
    };

    const ctx = createFieldContext(
      'Find flights from Zurich to London',
      action,
      { title: 'Google Flights', text: 'Cheap flights and airline tickets' },
      [{ action: 'CLICK departure', kind: 'click' }]
    );

    expect(ctx.goal).toBe('Find flights from Zurich to London');
    expect(ctx.field.label).toBe('Where from?');
    expect(ctx.page.title).toBe('Google Flights');
    expect(ctx.recent_actions.length).toBe(1);
  });

  it('generateFieldText parses JSON response and returns the generated text string', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ text: 'Zurich' }),
            },
          },
        ],
      }),
    });

    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      textHelper: {
        provider: 'deepseek',
        apiKey: 'test-text-key',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
      },
    };

    const ctx = {
      goal: 'Find flights from Zurich to London',
      field: { label: 'Where from?' },
      page: { title: 'Flights', text: 'Search' },
      recent_actions: [],
    };

    const text = await generateFieldText(settings, ctx);
    expect(text).toBe('Zurich');

    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(options.headers['Authorization']).toBe('Bearer test-text-key');
  });

  it('generateFieldText falls back to OpenRouter credentials if textHelper apiKey is omitted', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"text": "London"}' } }],
      }),
    });

    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      activeProvider: 'openrouter',
      openrouter: {
        apiKey: 'sk-or-shared-key',
        model: 'typesafe/jev-latest',
        endpoint: 'https://openrouter.ai/api/alpha/decisions',
      },
      textHelper: {
        provider: 'openrouter',
        apiKey: '', // empty!
        baseUrl: '',
        model: '',
      },
    };

    const ctx = {
      goal: 'Fly to London',
      field: { label: 'Where to?' },
      page: { title: 'Flights', text: 'Search' },
      recent_actions: [],
    };

    const text = await generateFieldText(settings, ctx);
    expect(text).toBe('London');

    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(options.headers['Authorization']).toBe('Bearer sk-or-shared-key');
  });
});
