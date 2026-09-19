import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callCloudflare } from '../src/shared/providers/cloudflare';
import { callJevProvider } from '../src/shared/providers/index';
import { callOpenRouter } from '../src/shared/providers/openrouter';
import { callTypeSafe } from '../src/shared/providers/typesafe';
import { AppSettings, DEFAULT_SETTINGS, JevRequest } from '../src/shared/types';

const dummyRequest: JevRequest = {
    model: 'jev-latest',
    state: {
      page: {
        url: 'https://example.com',
        title: 'Example Domain',
        text: 'This domain is for use in illustrative examples.',
      },
      elements: [
        { index: '1', label: 'More info link', operations: ['CLICK'] },
      ],
      recent_actions: [],
    },
    questions: {
      operation: {
        type: 'choice',
        instructions: 'Choose next operation',
        criteria: {
          CLICK: 'Click more info',
          DONE: 'Done',
        },
      },
    },
};

describe('Jev Provider Adapters', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('callTypeSafe sends request to TypeSafe official endpoint with correct Bearer header', async () => {
    const mockResponse = {
      model: 'jev-1.13.0',
      answers: {
        operation: {
          choice: 'CLICK',
          confidence: 0.96,
          probabilities: { CLICK: 0.96, DONE: 0.04 },
        },
      },
      usage: { input_tokens: 110, output_tokens: 0 },
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    const config = {
      apiKey: 'test-typesafe-key',
      model: 'jev-latest',
      endpoint: 'https://api.typesafe.ai/v1/systemone',
    };

    const res = await callTypeSafe(config, dummyRequest);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as any).mock.calls[0];

    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(options.method).toBe('POST');
    expect(options.headers['Authorization']).toBe('Bearer test-typesafe-key');
    expect(options.headers['Content-Type']).toBe('application/json');

    const sentBody = JSON.parse(options.body);
    expect(sentBody.model).toBe('jev-latest');
    expect(sentBody.state.page.url).toBe('https://example.com');
    expect(sentBody.questions.operation.type).toBe('choice');

    expect(res.answers.operation.choice).toBe('CLICK');
  });

  it('callOpenRouter sends request to OpenRouter alpha decisions endpoint', async () => {
    const mockResponse = {
      model: 'typesafe/jev-1.13',
      answers: {
        operation: {
          choice: 'CLICK',
          confidence: 0.92,
          probabilities: { CLICK: 0.92, DONE: 0.08 },
        },
      },
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    const config = {
      apiKey: 'test-openrouter-key',
      model: 'typesafe/jev-1.13',
      endpoint: 'https://openrouter.ai/api/alpha/decisions',
    };

    const res = await callOpenRouter(config, dummyRequest);

    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(options.headers['Authorization']).toBe('Bearer test-openrouter-key');
    expect(options.headers['HTTP-Referer']).toBeDefined();

    expect(res.answers.operation.choice).toBe('CLICK');
  });

  it('callOpenRouter automatically normalizes typesafe/jev-latest to typesafe/jev-1.13', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ model: 'typesafe/jev-1.13', answers: {} }),
    });

    const config = {
      apiKey: 'test-openrouter-key',
      model: 'typesafe/jev-latest',
      endpoint: 'https://openrouter.ai/api/alpha/decisions',
    };

    await callOpenRouter(config, dummyRequest);

    const [, options] = (global.fetch as any).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.model).toBe('typesafe/jev-1.13');
  });

  it('callCloudflare wraps payload into input and handles result envelope', async () => {
    const mockResponse = {
      success: true,
      result: {
        model: 'typesafe/jev',
        answers: {
          operation: {
            choice: 'CLICK',
            confidence: 0.89,
            probabilities: { CLICK: 0.89, DONE: 0.11 },
          },
        },
      },
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    const config = {
      accountId: 'cf-acc-12345',
      apiToken: 'cf-token-abcde',
      model: 'typesafe/jev',
    };

    const res = await callCloudflare(config, dummyRequest);

    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/cf-acc-12345/ai/run');
    expect(options.headers['Authorization']).toBe('Bearer cf-token-abcde');

    const body = JSON.parse(options.body);
    expect(body.model).toBe('typesafe/jev');
    expect(body.input.state.page.url).toBe('https://example.com');
    expect(body.input.questions.operation).toBeDefined();

    expect(res.answers.operation.choice).toBe('CLICK');
  });

  it('callJevProvider routes to configured activeProvider', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ model: 'typesafe/jev-1.13', answers: {} }),
    });

    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      activeProvider: 'openrouter',
      openrouter: {
        apiKey: 'sk-or-key',
        model: 'typesafe/jev-1.13',
        endpoint: 'https://openrouter.ai/api/alpha/decisions',
      },
    };

    await callJevProvider(settings, dummyRequest);

    const [url] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
  });
});

describe('postJson retry policy', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries transient statuses with backoff and then succeeds', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'slow down' })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ model: 'm', answers: {} }) });

    const pending = callTypeSafe(
      { apiKey: 'k', model: 'jev-latest', endpoint: 'https://api.typesafe.ai/v1/systemone' },
      dummyRequest
    );
    await vi.advanceTimersByTimeAsync(600);
    const res = await pending;
    expect(res.model).toBe('m');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-transient errors and reports the status', async () => {
    (global.fetch as any).mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'bad request' });
    await expect(
      callOpenRouter({ apiKey: 'k', model: '', endpoint: '' }, dummyRequest)
    ).rejects.toThrow(/HTTP 400.*bad request/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
