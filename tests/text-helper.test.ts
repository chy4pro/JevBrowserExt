import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFieldContext, generateFieldText, parseFieldText } from '../src/shared/text-helper';
import { AppSettings, DEFAULT_SETTINGS, PageAction } from '../src/shared/types';

const okResponse = (content: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }] }),
});

describe('Text Helper (TYPE_TEXT value generator)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('createFieldContext limits page text and keeps only action/text from history', () => {
    const action: PageAction = { id: 'e1', kind: 'fill', label: 'Where from?', role: 'textbox', value: '' };
    const ctx = createFieldContext(
      'Find flights from Zurich to London',
      action,
      { title: 'Google Flights', text: 'x'.repeat(7000) },
      [{ action: 'CLICK departure', kind: 'click', page_changed: true }]
    );

    expect(ctx.goal).toBe('Find flights from Zurich to London');
    expect(ctx.field).toEqual({ label: 'Where from?', role: 'textbox', value: '' });
    expect(ctx.page.text.length).toBe(6000);
    expect(ctx.recent_actions).toEqual([{ action: 'CLICK departure', text: undefined }]);
  });

  it('sends a JSON-mode chat request and returns the text value (DeepSeek direct)', async () => {
    (global.fetch as any).mockResolvedValueOnce(okResponse(JSON.stringify({ text: 'Zurich' })));

    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      textHelper: {
        provider: 'deepseek',
        apiKey: 'test-text-key',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
      },
    };

    const text = await generateFieldText(settings, {
      goal: 'Find flights from Zurich to London',
      field: { label: 'Where from?' },
      page: { title: 'Flights', text: 'Search' },
      recent_actions: [],
    });
    expect(text).toBe('Zurich');

    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(options.headers['Authorization']).toBe('Bearer test-text-key');
    const body = JSON.parse(options.body);
    expect(body.model).toBe('deepseek-chat'); // never rewritten
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.thinking).toEqual({ type: 'disabled' });
  });

  it('falls back to provider presets and the OpenRouter key when the helper config is empty', async () => {
    (global.fetch as any).mockResolvedValueOnce(okResponse('{"text": "London"}'));

    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      activeProvider: 'openrouter',
      openrouter: { apiKey: 'sk-or-shared-key', model: 'typesafe/jev-1.13', endpoint: '' },
      textHelper: { provider: 'openrouter', apiKey: '', baseUrl: '', model: '' },
    };

    const text = await generateFieldText(settings, {
      goal: 'Fly to London',
      field: { label: 'Where to?' },
      page: { title: 'Flights', text: 'Search' },
      recent_actions: [],
    });
    expect(text).toBe('London');

    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(options.headers['Authorization']).toBe('Bearer sk-or-shared-key');
    expect(JSON.parse(options.body).model).toBe('deepseek/deepseek-chat');
  });

  it('does not share the OpenRouter key with a non-OpenRouter helper', async () => {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      openrouter: { ...DEFAULT_SETTINGS.openrouter, apiKey: 'sk-or-shared-key' },
      textHelper: { provider: 'openai', apiKey: '', baseUrl: '', model: '' },
    };
    await expect(
      generateFieldText(settings, { goal: 'g', field: {}, page: { title: '', text: '' }, recent_actions: [] })
    ).rejects.toThrow(/API key/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refuses to type when the model reports a missing value', async () => {
    (global.fetch as any).mockResolvedValueOnce(okResponse('{"text": null}'));
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      textHelper: { provider: 'deepseek', apiKey: 'k', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    };
    await expect(
      generateFieldText(settings, { goal: 'g', field: {}, page: { title: '', text: '' }, recent_actions: [] })
    ).rejects.toThrow(/no value/);
  });

  it('surfaces provider errors instead of silently switching models', async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'bad key' });
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      textHelper: { provider: 'openrouter', apiKey: 'k', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemini-x' },
    };
    await expect(
      generateFieldText(settings, { goal: 'g', field: {}, page: { title: '', text: '' }, recent_actions: [] })
    ).rejects.toThrow(/HTTP 401/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  describe('parseFieldText', () => {
    it('accepts a fenced JSON object', () => {
      expect(parseFieldText('```json\n{"text": "Zurich"}\n```')).toBe('Zurich');
    });

    it('rejects plain text, extra keys, empty strings, and oversized values', () => {
      expect(() => parseFieldText('Zurich')).toThrow(/JSON/);
      expect(() => parseFieldText('{"value": "Zurich"}')).toThrow(/"text"/);
      expect(() => parseFieldText('{"text": "   "}')).toThrow(/invalid/);
      expect(() => parseFieldText(`{"text": "${'a'.repeat(2001)}"}`)).toThrow(/invalid/);
      expect(() => parseFieldText('{"text": 42}')).toThrow(/invalid/);
    });
  });
});
