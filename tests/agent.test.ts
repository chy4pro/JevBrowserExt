import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentRunner } from '../src/background/agent';
import { callJevProvider } from '../src/shared/providers';
import { generateFieldText } from '../src/shared/text-helper';
import { ActResult, ChoiceQuestion, DEFAULT_SETTINGS, PageAction, PageSnapshot } from '../src/shared/types';

vi.mock('../src/shared/providers', () => ({
  callJevProvider: vi.fn(),
  activeJevModel: () => 'test-model',
}));
vi.mock('../src/shared/text-helper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/shared/text-helper')>()),
  generateFieldText: vi.fn(),
}));

const jev = vi.mocked(callJevProvider);
const textHelper = vi.mocked(generateFieldText);

function snapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  const actions: PageAction[] = [
    { id: 'e1', node: 1, kind: 'click', role: 'button', label: 'Search' },
    { id: 'e2', node: 2, kind: 'fill', role: 'textbox', label: 'Where from?', value: '' },
    { id: 'e3', node: 2, kind: 'click', role: 'textbox', label: 'Open Where from?', value: '' },
    { id: 'wait', kind: 'wait', label: 'Wait for the page to update' },
  ];
  return {
    url: 'https://example.com/',
    title: 'Example',
    w: 1000,
    h: 800,
    text: 'Example page',
    scroll: { y: 0, height: 800 },
    actions,
    omitted_actions: 0,
    ...overrides,
  };
}

const answer = (choice: string, extra: Record<string, any> = {}) => ({
  model: 'test-model',
  answers: {
    operation: {
      choice,
      confidence: 0.9,
      probabilities: choice === 'DONE' ? { DONE: 0.9, WAIT: 0.1 } : { [choice]: 0.9, DONE: 0.1 },
    },
    ...extra,
  },
});
const clickTarget = (index: string) => ({
  click_target: { choice: index, confidence: 0.8, probabilities: { [index]: 1 } },
});

interface Page {
  snapshot: PageSnapshot;
  act: (action: PageAction, text?: string) => ActResult;
  sent: Array<{ type: string; [k: string]: any }>;
}

function installChrome(page: Page) {
  const chromeMock = {
    tabs: {
      get: vi.fn(async () => ({ id: 7, url: 'https://example.com/', status: 'complete' })),
      sendMessage: vi.fn(async (_tabId: number, msg: any) => {
        page.sent.push(msg);
        switch (msg.type) {
          case 'PING':
            return { pong: true };
          case 'CONTENT_OBSERVE':
            return { success: true, snapshot: page.snapshot };
          case 'CONTENT_ACT':
            return page.act(msg.action, msg.text);
          default:
            return { success: true };
        }
      }),
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      query: vi.fn(),
    },
    scripting: { executeScript: vi.fn() },
    runtime: { sendMessage: vi.fn(() => Promise.resolve()) },
  };
  vi.stubGlobal('chrome', chromeMock);
  return chromeMock;
}

function runner(): AgentRunner {
  const r = new AgentRunner();
  r.setSettings({ ...DEFAULT_SETTINGS, stepDelayMs: 0, maxSteps: 5 });
  return r;
}

describe('AgentRunner', () => {
  let page: Page;

  beforeEach(() => {
    jev.mockReset();
    textHelper.mockReset();
    page = { snapshot: snapshot(), act: () => ({ success: true }), sent: [] };
    installChrome(page);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('finishes with DONE without executing anything', async () => {
    jev.mockResolvedValueOnce(answer('DONE'));
    const r = runner();
    await r.start('Do nothing', 7);

    const progress = r.getProgress();
    expect(progress.status).toBe('done');
    expect(progress.currentStep).toBe(0);
    expect(progress.logs[0].operation).toBe('DONE');
    expect(page.sent.filter((m) => m.type === 'CONTENT_ACT')).toHaveLength(0);
  });

  it('executes the chosen target, records it, and reports page_changed on the next decision', async () => {
    jev.mockResolvedValueOnce(answer('CLICK', clickTarget('1'))).mockResolvedValueOnce(answer('DONE'));
    page.act = () => {
      page.snapshot = snapshot({ text: 'Results loaded', url: 'https://example.com/results' });
      return { success: true };
    };
    const r = runner();
    await r.start('Search', 7);

    const acts = page.sent.filter((m) => m.type === 'CONTENT_ACT');
    expect(acts).toHaveLength(1);
    expect(acts[0].action.id).toBe('e1');
    expect(r.getProgress().status).toBe('done');
    expect(r.getProgress().currentStep).toBe(1);
    expect(jev.mock.calls[1][1].state.recent_actions).toEqual([
      { action: 'CLICK Search', kind: 'click', text: undefined, page_changed: true },
    ]);
  });

  it('discards a stale decision, re-observes, and gives up after repeated staleness', async () => {
    jev.mockResolvedValue(answer('CLICK', clickTarget('1')));
    page.act = () => ({ success: false, stale: true, error: 'Page changed' });
    const r = runner();
    await r.start('Search', 7);

    expect(r.getProgress().status).toBe('error');
    expect(r.getProgress().lastError).toMatch(/kept changing/);
    expect(r.getProgress().currentStep).toBe(0);
    expect(jev).toHaveBeenCalledTimes(3);
    expect(jev.mock.calls[2][1].state.recent_actions).toEqual([]);
  });

  it('blocks after three consecutive non-wait actions that change nothing', async () => {
    // Always click the first offered target; suppression removes a target after two ineffective uses.
    jev.mockImplementation(async (_settings, request) =>
      answer('CLICK', clickTarget(Object.keys((request.questions.click_target as ChoiceQuestion).criteria)[0]))
    );
    const r = runner();
    await r.start('Search', 7);

    expect(r.getProgress().status).toBe('blocked');
    expect(r.getProgress().lastError).toMatch(/no change/);
    const acts = page.sent.filter((m) => m.type === 'CONTENT_ACT');
    expect(acts.map((m) => m.action.id)).toEqual(['e1', 'e1', 'e3']); // e1 suppressed after two misses
    const secondRequest = jev.mock.calls[1][1];
    expect((secondRequest.questions.operation.instructions as any).ineffective_action_alert).toMatch(/NO visible change/);
  });

  it('asks the text helper once and reuses its value when the first attempt was stale', async () => {
    const typeText = {
      type_text_target: { choice: '2', confidence: 0.8, probabilities: { '2': 1 } },
    };
    jev.mockResolvedValueOnce(answer('TYPE_TEXT', typeText))
      .mockResolvedValueOnce(answer('TYPE_TEXT', typeText))
      .mockResolvedValueOnce(answer('DONE'));
    textHelper.mockResolvedValue('Zurich');
    let attempts = 0;
    page.act = (_action, text) => {
      attempts++;
      if (attempts === 1) return { success: false, stale: true };
      page.snapshot = snapshot({ text: `typed ${text}` });
      return { success: true };
    };
    const r = runner();
    await r.start('Fly from Zurich', 7);

    expect(textHelper).toHaveBeenCalledTimes(1);
    expect(textHelper.mock.calls[0][1].field.label).toBe('Where from?');
    const acts = page.sent.filter((m) => m.type === 'CONTENT_ACT');
    expect(acts.map((m) => m.text)).toEqual(['Zurich', 'Zurich']);
    expect(r.getProgress().logs[1]).toMatchObject({ operation: 'TYPE_TEXT', targetValue: 'Zurich' });
  });

  it('stops with an error, executing nothing, when the model answer is invalid', async () => {
    jev.mockResolvedValueOnce({
      model: 'm',
      answers: { operation: { choice: 'CLICK', probabilities: { CLICK: 0.2, DONE: 0.8 } } },
    });
    const r = runner();
    await r.start('Search', 7);

    expect(r.getProgress().status).toBe('error');
    expect(r.getProgress().lastError).toMatch(/Invalid operation choice/);
    expect(page.sent.filter((m) => m.type === 'CONTENT_ACT')).toHaveLength(0);
  });

  it('single-steps: pauses after one action, continues on the same goal, restarts on a new goal', async () => {
    jev.mockResolvedValue(answer('CLICK', clickTarget('1')));
    page.act = () => {
      page.snapshot = snapshot({ text: `step ${Date.now()}${Math.random()}` });
      return { success: true };
    };
    const r = runner();
    await r.step('Goal A', 7);
    expect(r.getProgress()).toMatchObject({ status: 'paused', goal: 'Goal A', currentStep: 1 });

    await r.step('Goal A', 7);
    expect(r.getProgress()).toMatchObject({ status: 'paused', currentStep: 2 });
    expect(jev.mock.calls[1][1].state.recent_actions).toHaveLength(1);

    await r.step('Goal B', 7);
    expect(r.getProgress()).toMatchObject({ status: 'paused', goal: 'Goal B', currentStep: 1 });
    expect(jev.mock.calls[2][1].state.recent_actions).toEqual([]);

    r.stop();
    expect(r.getProgress().status).toBe('idle');
  });

  it('stops at the step budget', async () => {
    jev.mockResolvedValue(answer('CLICK', clickTarget('1')));
    page.act = () => {
      page.snapshot = snapshot({ text: `step ${Math.random()}` });
      return { success: true };
    };
    const r = runner();
    await r.start('Loop forever', 7);
    expect(r.getProgress().status).toBe('blocked');
    expect(r.getProgress().currentStep).toBe(5);
  });

  it('refuses internal browser pages', async () => {
    const chromeMock = installChrome(page);
    chromeMock.tabs.get.mockResolvedValue({ id: 7, url: 'chrome://extensions', status: 'complete' } as any);
    const r = runner();
    await r.start('Anything', 7);
    expect(r.getProgress().status).toBe('error');
    expect(r.getProgress().lastError).toMatch(/internal browser page/);
    expect(jev).not.toHaveBeenCalled();
  });
});

describe('isNavigationError', () => {
  it('recognises every wording Chrome uses when the page navigated mid-message', async () => {
    const { isNavigationError } = await import('../src/background/agent');
    for (const m of [
      'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received',
      'The message port closed before a response was received.',
      'Could not establish connection. Receiving end does not exist.',
      'The page keeping the extension port is moved into back/forward cache, so the message channel is closed.',
      'Frame was removed.',
      'Extension context invalidated.',
    ]) expect(isNavigationError(m), m).toBe(true);
    expect(isNavigationError('Target element is not a <select> element')).toBe(false);
  });
});
