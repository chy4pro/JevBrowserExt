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

const created: Array<(tab: any) => void> = [];
const removed: Array<(tabId: number) => void> = [];

function installChrome(page: Page) {
  created.length = 0;
  removed.length = 0;
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
      onCreated: { addListener: vi.fn((fn: any) => { created.push(fn); }) },
      onRemoved: { addListener: vi.fn((fn: any) => { removed.push(fn); }) },
      update: vi.fn(async () => ({})),
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
      { step: 1, action: 'CLICK Search', kind: 'click', text: undefined, outcome: 'navigated to https://example.com/results', url: 'https://example.com/results', page_changed: true },
    ]);
  });

  it('discards a stale decision, re-observes, and gives up after repeated staleness', async () => {
    // Always take the first offered click target; withheld targets change what is offered.
    jev.mockImplementation(async (_s, request) =>
      answer('CLICK', clickTarget(Object.keys((request.questions.click_target as ChoiceQuestion).criteria)[0]))
    );
    page.act = () => ({ success: false, stale: true, error: 'Page changed' });
    const r = runner();
    await r.start('Search', 7);

    expect(r.getProgress().status).toBe('error');
    expect(r.getProgress().lastError).toMatch(/kept changing/);
    expect(r.getProgress().currentStep).toBe(0);
    expect(jev).toHaveBeenCalledTimes(4);
    expect(jev.mock.calls[3][1].state.recent_actions).toEqual([]);
    expect(page.sent.filter((m) => m.type === 'CONTENT_ACT').map((m) => m.action.id)).toEqual(['e1', 'e1', 'e3', 'e3']);
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

  it('asks once more after an invalid answer, and stops with an error if it repeats', async () => {
    const invalid = { model: 'm', answers: { operation: { choice: 'CLICK', probabilities: { CLICK: 0.2, DONE: 0.8 } } } };
    jev.mockResolvedValueOnce(invalid).mockResolvedValueOnce(invalid);
    const r = runner();
    await r.start('Search', 7);

    expect(r.getProgress().status).toBe('error');
    expect(r.getProgress().lastError).toMatch(/Invalid operation choice/);
    expect(jev).toHaveBeenCalledTimes(2);
    expect(page.sent.filter((m) => m.type === 'CONTENT_ACT')).toHaveLength(0);
  });

  it('recovers when the model answers consistently on the second try', async () => {
    const invalid = { model: 'm', answers: { operation: { choice: 'CLICK', probabilities: { CLICK: 0.2, DONE: 0.8 } } } };
    jev.mockResolvedValueOnce(invalid).mockResolvedValueOnce(answer('DONE'));
    const r = runner();
    await r.start('Search', 7);
    expect(r.getProgress().status).toBe('done');
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
    jev.mockImplementation(async (_s, request) =>
      answer('CLICK', clickTarget(Object.keys((request.questions.click_target as ChoiceQuestion).criteria)[0]))
    );
    let n = 0;
    page.act = () => {
      n++;
      page.snapshot = snapshot({
        text: `page ${n}`,
        actions: [{ id: 'e1', node: 10 + n, kind: 'click', role: 'link', label: `Result ${n}` }, { id: 'wait', kind: 'wait', label: 'Wait' }],
      });
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

describe('covered targets', () => {
  beforeEach(() => {
    jev.mockReset();
    textHelper.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('tells the model about a covered target and withholds it after two misses', async () => {
    const page: Page = { snapshot: snapshot(), act: () => ({ success: false, stale: true, error: 'Target is covered by another element. Observe again.' }), sent: [] };
    installChrome(page);
    jev.mockImplementation(async (_s, request) => {
      const keys = Object.keys((request.questions.click_target as ChoiceQuestion).criteria);
      return answer('CLICK', clickTarget(keys[0]));
    });
    const r = runner();
    await r.start('Search', 7);

    const second = jev.mock.calls[1][1];
    expect((second.questions.operation.instructions as any).ineffective_action_alert).toMatch(/could not be acted on/);
    // e1 (target "1") is withheld from the third decision, so the model is offered e3 instead.
    const third = jev.mock.calls[2][1];
    expect(Object.keys((third.questions.click_target as ChoiceQuestion).criteria)).toEqual(['2']);
    expect(r.getProgress().status).toBe('error');
    expect(r.getProgress().currentStep).toBe(0);
  });
});

describe('text helper refusal', () => {
  beforeEach(() => {
    jev.mockReset();
    textHelper.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('continues with a notice instead of ending the run when the helper finds no value', async () => {
    const page: Page = { snapshot: snapshot(), act: () => ({ success: true }), sent: [] };
    installChrome(page);
    const typeText = { type_text_target: { choice: '2', confidence: 0.8, probabilities: { '2': 1 } } };
    jev.mockResolvedValueOnce(answer('TYPE_TEXT', typeText)).mockResolvedValueOnce(answer('DONE'));
    textHelper.mockRejectedValueOnce(new Error('Text helper found no value for this field in the goal; nothing typed.'));
    const r = runner();
    await r.start('Reach the Eiffel Tower article using only links', 7);

    expect(r.getProgress().status).toBe('done');
    expect(page.sent.filter((m) => m.type === 'CONTENT_ACT')).toHaveLength(0);
    expect((jev.mock.calls[1][1].questions.operation.instructions as any).ineffective_action_alert).toMatch(/No value for the field/);
  });

  it('still stops on a real helper failure such as a bad API key', async () => {
    const page: Page = { snapshot: snapshot(), act: () => ({ success: true }), sent: [] };
    installChrome(page);
    jev.mockResolvedValue(answer('TYPE_TEXT', { type_text_target: { choice: '2', confidence: 0.8, probabilities: { '2': 1 } } }));
    textHelper.mockRejectedValue(new Error('Text helper error (HTTP 401): bad key'));
    const r = runner();
    await r.start('Type something', 7);
    expect(r.getProgress().status).toBe('error');
    expect(jev).toHaveBeenCalledTimes(1);
  });
});

describe('hesitant verdicts', () => {
  beforeEach(() => {
    jev.mockReset();
    textHelper.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  const hesitant = (choice: string) => ({
    model: 'm',
    answers: { operation: { choice, confidence: 0.3, probabilities: { [choice]: 0.4, CLICK: 0.35, WAIT: 0.25 } } },
  });

  it('takes a second look before accepting a low-confidence BLOCKED, and continues if the model changes its mind', async () => {
    const page: Page = { snapshot: snapshot(), act: () => ({ success: true }), sent: [] };
    installChrome(page);
    jev.mockResolvedValueOnce(hesitant('BLOCKED')).mockResolvedValueOnce(answer('CLICK', clickTarget('1'))).mockResolvedValueOnce(answer('DONE'));
    const r = runner();
    await r.start('Search', 7);
    expect(r.getProgress().status).toBe('done');
    expect(page.sent.filter((m) => m.type === 'CONTENT_ACT')).toHaveLength(1);
    expect(jev).toHaveBeenCalledTimes(3);
  });

  it('ends the run when the low-confidence verdict repeats', async () => {
    const page: Page = { snapshot: snapshot(), act: () => ({ success: true }), sent: [] };
    installChrome(page);
    jev.mockResolvedValue(hesitant('BLOCKED'));
    const r = runner();
    await r.start('Search', 7);
    expect(r.getProgress().status).toBe('blocked');
    expect(jev).toHaveBeenCalledTimes(2);
  });
});

describe('repeated toggles', () => {
  beforeEach(() => {
    jev.mockReset();
    textHelper.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('warns after the second repeat of a page-changing toggle and blocks after the third', async () => {
    // Every click on e1 changes the page (a menu opening and closing), so no-change detection never fires.
    let flips = 0;
    const page: Page = {
      snapshot: snapshot(),
      act: () => { page.snapshot = snapshot({ text: `menu state ${++flips % 2}` }); return { success: true }; },
      sent: [],
    };
    installChrome(page);
    jev.mockImplementation(async (_s, request) => {
      const keys = Object.keys((request.questions.click_target as ChoiceQuestion).criteria);
      return answer('CLICK', clickTarget(keys[0]));
    });
    const r = runner();
    await r.start('Find flights', 7);

    const acts = page.sent.filter((m) => m.type === 'CONTENT_ACT').map((m) => m.action.id);
    expect(acts.slice(0, 2)).toEqual(['e1', 'e1']);
    expect((jev.mock.calls[2][1].questions.operation.instructions as any).ineffective_action_alert).toMatch(/executed 2 times/);
    // After the warning e1 is withheld, so the model gets e3 and no longer repeats e1.
    expect(Object.keys((jev.mock.calls[2][1].questions.click_target as ChoiceQuestion).criteria)).toEqual(['2']);
  });

  it('blocks when the same control keeps being chosen despite the warning', async () => {
    let flips = 0;
    const page: Page = {
      snapshot: snapshot({ actions: [{ id: 'e1', node: 1, kind: 'click', role: 'button', label: 'Google apps' }, { id: 'wait', kind: 'wait', label: 'Wait' }] }),
      act: () => { page.snapshot = snapshot({ text: `apps ${++flips % 2}`, actions: [{ id: 'e1', node: 1, kind: 'click', role: 'button', label: 'Google apps' }, { id: 'wait', kind: 'wait', label: 'Wait' }] }); return { success: true }; },
      sent: [],
    };
    installChrome(page);
    jev.mockResolvedValue(answer('CLICK', clickTarget('1')));
    const r = runner();
    await r.start('Find flights', 7);
    expect(r.getProgress().status).toBe('blocked');
    expect(r.getProgress().lastError).toMatch(/repeated 3 times/);
    expect(page.sent.filter((m) => m.type === 'CONTENT_ACT')).toHaveLength(3);
  });
});

describe('cross-checks and outcomes', () => {
  beforeEach(() => {
    jev.mockReset();
    textHelper.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  const withChecks = (base: any, goalDone: number, stuck: number) => ({
    ...base,
    answers: { ...base.answers, goal_done: { type: 'noul', noul: goalDone }, stuck: { type: 'noul', noul: stuck } },
  });

  it('vetoes DONE when the goal check disagrees, withholds DONE once, and tells the model why', async () => {
    const page: Page = { snapshot: snapshot(), act: () => ({ success: true }), sent: [] };
    installChrome(page);
    jev
      .mockResolvedValueOnce(withChecks(answer('DONE'), 0.1, 0.05))
      .mockResolvedValueOnce(withChecks({ model: 'm', answers: { operation: { choice: 'CLICK', confidence: 0.9, probabilities: { CLICK: 0.9, WAIT: 0.1 } }, ...clickTarget('1') } }, 0.2, 0.05))
      .mockResolvedValueOnce(withChecks(answer('DONE'), 0.9, 0.05));
    const r = runner();
    await r.start('Search and open results', 7);

    const second = jev.mock.calls[1][1];
    expect(Object.keys((second.questions.operation as ChoiceQuestion).criteria)).not.toContain('DONE');
    expect((second.questions.operation.instructions as any).ineffective_action_alert).toMatch(/not achieved yet \(probability 0.10\)/);
    expect(Object.keys((jev.mock.calls[2][1].questions.operation as ChoiceQuestion).criteria)).toContain('DONE');
    expect(r.getProgress().status).toBe('done');
    expect(r.getProgress().logs.map((l) => l.operation)).toEqual(['DONE', 'CLICK', 'DONE (vetoed)']);
  });

  it('describes outcomes in words and sends run progress in the state', async () => {
    const page: Page = { snapshot: snapshot(), act: () => ({ success: true }), sent: [] };
    installChrome(page);
    let n = 0;
    page.act = () => {
      n++;
      page.snapshot = n === 1 ? snapshot({ text: snapshot().text + ' menu opened with many more words than before it was' }) : snapshot({ url: 'https://example.com/results', title: 'Results' });
      return { success: true };
    };
    jev.mockResolvedValueOnce(answer('CLICK', clickTarget('1'))).mockResolvedValueOnce(answer('CLICK', clickTarget('1'))).mockResolvedValueOnce(answer('DONE'));
    const r = runner();
    await r.start('Search', 7);

    const third = jev.mock.calls[2][1].state;
    expect(third.recent_actions.map((a: any) => a.outcome)).toEqual([
      'page content changed (something opened, closed or loaded; same URL)',
      'navigated to https://example.com/results',
    ]);
    expect(third.run).toEqual({ start_url: 'https://example.com/', steps_taken: 2, visited_urls: ['https://example.com/', 'https://example.com/results'] });
  });
});

describe('navigation started by an action', () => {
  beforeEach(() => {
    jev.mockReset();
    textHelper.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('waits for the tab to finish loading before observing again', async () => {
    const page: Page = { snapshot: snapshot(), act: () => ({ success: true }), sent: [] };
    const chromeMock = installChrome(page);
    let loading = false;
    let listener: ((tabId: number, info: { status?: string }) => void) | null = null;
    chromeMock.tabs.get.mockImplementation(async () => ({ id: 7, url: 'https://example.com/', status: loading ? 'loading' : 'complete' }));
    chromeMock.tabs.onUpdated.addListener.mockImplementation((fn: any) => {
      listener = fn;
      // The page finishes loading shortly after the agent starts waiting.
      setTimeout(() => { loading = false; page.snapshot = snapshot({ url: 'https://example.com/sorted', text: 'sorted results' }); fn(7, { status: 'complete' }); }, 30);
    });
    page.act = () => { loading = true; return { success: true }; };
    jev.mockResolvedValueOnce(answer('CLICK', clickTarget('1'))).mockResolvedValueOnce(answer('DONE'));
    const r = runner();
    await r.start('Sort by rating', 7);

    expect(listener).not.toBeNull();
    expect(jev.mock.calls[1][1].state.page.url).toBe('https://example.com/sorted');
    expect(jev.mock.calls[1][1].state.recent_actions[0].outcome).toBe('navigated to https://example.com/sorted');
  });
});

describe('links that open a new tab', () => {
  beforeEach(() => {
    jev.mockReset();
    textHelper.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('follows a tab opened by the click, observes there, and returns when it closes', async () => {
    const page: Page = { snapshot: snapshot(), act: () => ({ success: true }), sent: [] };
    const chromeMock = installChrome(page);
    const observedTabs: number[] = [];
    chromeMock.tabs.sendMessage.mockImplementation(async (tabId: number, msg: any) => {
      page.sent.push(msg);
      if (msg.type === 'CONTENT_OBSERVE') {
        observedTabs.push(tabId);
        return { success: true, snapshot: tabId === 8 ? snapshot({ url: 'https://example.com/docs', title: 'Docs' }) : page.snapshot };
      }
      if (msg.type === 'CONTENT_ACT') {
        // The click opens a new tab; Chrome reports it with the opener id.
        created.forEach((fn) => fn({ id: 8, openerTabId: 7 }));
        return { success: true };
      }
      return { pong: true };
    });
    jev.mockResolvedValueOnce(answer('CLICK', clickTarget('1'))).mockResolvedValueOnce(answer('DONE'));
    const r = runner();
    await r.start('Open the documentation', 7);

    expect(observedTabs).toEqual([7, 8]);
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(8, { active: true });
    const second = jev.mock.calls[1][1].state;
    expect(second.page.url).toBe('https://example.com/docs');
    expect(second.recent_actions[0].outcome).toBe('opened a new tab and switched to it: https://example.com/docs');
    expect(r.getProgress().status).toBe('done');
  });

  it('ignores tabs opened by other tabs or outside a run', async () => {
    const page: Page = { snapshot: snapshot(), act: () => ({ success: true }), sent: [] };
    const chromeMock = installChrome(page);
    const observedTabs: number[] = [];
    chromeMock.tabs.sendMessage.mockImplementation(async (tabId: number, msg: any) => {
      page.sent.push(msg);
      if (msg.type === 'CONTENT_OBSERVE') { observedTabs.push(tabId); return { success: true, snapshot: page.snapshot }; }
      if (msg.type === 'CONTENT_ACT') { created.forEach((fn) => fn({ id: 9, openerTabId: 99 })); return { success: true }; }
      return { pong: true };
    });
    jev.mockResolvedValueOnce(answer('CLICK', clickTarget('1'))).mockResolvedValueOnce(answer('DONE'));
    const r = runner();
    await r.start('Stay here', 7);
    expect(observedTabs).toEqual([7, 7]);
    expect(chromeMock.tabs.update).not.toHaveBeenCalled();
  });
});
