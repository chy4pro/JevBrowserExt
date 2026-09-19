import { describe, expect, it } from 'vitest';
import { buildActionSpace, buildJevRequest, validateChoiceAnswer } from '../src/shared/action-space';
import { PageAction, PageSnapshot } from '../src/shared/types';

const sampleActions: PageAction[] = [
  { id: 'e1', node: 101, kind: 'click', role: 'button', label: 'Search Flights', section: 'Flights' },
  { id: 'e2', node: 102, kind: 'fill', role: 'textbox', label: 'Departure City', value: '' },
  { id: 'e3', node: 102, kind: 'click', role: 'textbox', label: 'Open Departure City', value: '' },
  {
    id: 'e4',
    node: 103,
    kind: 'select',
    role: 'combobox',
    label: 'Trip Type → One way',
    value: 'one_way',
    current_value: 'Round Trip',
  },
  {
    id: 'e5',
    node: 103,
    kind: 'select',
    role: 'combobox',
    label: 'Trip Type → Multi-city',
    value: 'multi',
    current_value: 'Round Trip',
  },
  { id: 'scroll_down', kind: 'scroll', label: 'Scroll down', delta: 560 },
  { id: 'wait', kind: 'wait', label: 'Wait for the page to update' },
];

describe('buildActionSpace', () => {
  it('gives one index per node and one target head per operation', () => {
    const space = buildActionSpace(sampleActions, 'Fly from Zurich to London');

    expect(space.elements.map((e) => e.index)).toEqual(['1', '2', '3']);
    expect(space.elements[0].section).toBe('Flights');
    expect((space.questions.click_target.criteria as any)['1'].section).toBe('Flights');
    expect(space.elements[1].operations).toEqual(['TYPE_TEXT', 'CLICK']);
    expect(Object.keys(space.targets.CLICK)).toEqual(['1', '2']);
    expect(Object.keys(space.targets.TYPE_TEXT)).toEqual(['2']);
    expect(space.questions.operation.type).toBe('choice');
    expect(space.questions.click_target).toBeDefined();
    expect(space.questions.type_text_target).toBeDefined();
    expect(space.questions.select_target).toBeDefined();
  });

  it('labels a dropdown by its field name and lists its options with code-owned indices', () => {
    const space = buildActionSpace(sampleActions, 'goal');
    const select = space.elements[2];
    expect(select.label).toBe('Trip Type');
    expect(select.value).toBe('Round Trip');
    expect(select.options).toEqual([
      { index: '3:1', label: 'Trip Type → One way', value: 'one_way' },
      { index: '3:2', label: 'Trip Type → Multi-city', value: 'multi' },
    ]);
    expect(space.targets.SELECT['3:2'].value).toBe('multi');
  });

  it('derives scroll/wait controls from the snapshot instead of always offering them', () => {
    const space = buildActionSpace(sampleActions, 'goal');
    expect(Object.keys(space.operations)).toEqual([
      'CLICK',
      'TYPE_TEXT',
      'SELECT',
      'SCROLL_DOWN',
      'WAIT',
      'DONE',
      'BLOCKED',
    ]);
    expect(space.operations.SCROLL_UP).toBeUndefined();
    expect(space.controls.SCROLL_DOWN.delta).toBe(560);
  });

  it('drops suppressed targets only while alternatives remain', () => {
    const withAlternative = buildActionSpace(sampleActions, 'goal', { suppressedTargetIds: ['e1'] });
    expect(Object.keys(withAlternative.targets.CLICK)).toEqual(['2']);

    const onlyOne = buildActionSpace(sampleActions, 'goal', { suppressedTargetIds: ['e2'] });
    expect(Object.keys(onlyOne.targets.TYPE_TEXT)).toEqual(['2']);
  });

  it('surfaces the ineffective-action warning in both question kinds', () => {
    const space = buildActionSpace(sampleActions, 'goal', { warning: 'No change last time' });
    expect((space.questions.operation.instructions as any).ineffective_action_alert).toBe('No change last time');
    expect((space.questions.click_target.instructions as any).notice).toBe('No change last time');
  });
});

describe('buildJevRequest', () => {
  it('formats the full state with page text and recent actions', () => {
    const snapshot: PageSnapshot = {
      url: 'https://www.google.com/travel/flights',
      title: 'Google Flights',
      w: 1200,
      h: 800,
      text: 'Find cheap flights from Zurich to anywhere',
      scroll: { y: 0, height: 1600 },
      actions: sampleActions,
      omitted_actions: 0,
    };

    const { request, actionSpace } = buildJevRequest('jev-latest', snapshot, 'Search flights', [
      { action: 'CLICK button', kind: 'click' },
    ]);

    expect(request.model).toBe('jev-latest');
    expect(request.state.page.title).toBe('Google Flights');
    expect(request.state.elements.length).toBe(actionSpace.elements.length);
    expect(request.state.task).toBe('Search flights');
    expect(request.state.recent_actions).toEqual([
      { step: undefined, action: 'CLICK button', kind: 'click', text: undefined, outcome: 'pending', url: undefined, page_changed: false },
    ]);
    expect(request.questions.operation).toBeDefined();
    expect(request.questions.goal_done.type).toBe('noul');
    expect(request.questions.stuck.type).toBe('noul');
    expect((request.questions.operation.instructions as any).rules).toMatch(/`recent_actions`/);
  });
});

describe('validateChoiceAnswer', () => {
  const allowed = ['CLICK', 'TYPE_TEXT', 'DONE'];

  it('accepts a consistent answer', () => {
    const res = validateChoiceAnswer(
      { choice: 'CLICK', confidence: 0.95, probabilities: { CLICK: 0.95, TYPE_TEXT: 0.05 } },
      allowed
    );
    expect(res).toEqual({ choice: 'CLICK', confidence: 0.95, probabilities: { CLICK: 0.95, TYPE_TEXT: 0.05 } });
  });

  it('uses the chosen probability when confidence is missing', () => {
    const res = validateChoiceAnswer({ choice: 'DONE', probabilities: { DONE: 0.7, CLICK: 0.3 } }, allowed);
    expect(res.confidence).toBe(0.7);
  });

  it('rejects a choice outside the offered candidates instead of repairing it', () => {
    expect(() =>
      validateChoiceAnswer({ choice: 'UNKNOWN_OP', probabilities: { CLICK: 0.88, TYPE_TEXT: 0.12 } }, allowed)
    ).toThrow(/expected one of/);
  });

  it('rejects a missing answer, unknown probability keys, bad sums, and choice/argmax disagreement', () => {
    expect(() => validateChoiceAnswer(undefined, allowed)).toThrow();
    expect(() =>
      validateChoiceAnswer({ choice: 'CLICK', probabilities: { CLICK: 0.5, OTHER: 0.5 } }, allowed)
    ).toThrow(/unknown candidates/);
    expect(() =>
      validateChoiceAnswer({ choice: 'CLICK', probabilities: { CLICK: 0.5, DONE: 0.1 } }, allowed)
    ).toThrow(/sum to 1/);
    expect(() =>
      validateChoiceAnswer({ choice: 'CLICK', probabilities: { CLICK: 0.2, DONE: 0.8 } }, allowed)
    ).toThrow(/higher probability \(DONE=0.8, CLICK=0.2\)/);
    // Two-decimal rounding by the provider is not a contradiction.
    expect(validateChoiceAnswer({ choice: 'CLICK', probabilities: { CLICK: 0.49, DONE: 0.5, TYPE_TEXT: 0.01 } }, allowed).choice).toBe('CLICK');
    expect(() =>
      validateChoiceAnswer({ choice: 'CLICK', probabilities: { CLICK: 'high' } }, allowed)
    ).toThrow();
  });
});

describe('mergeSettings migration', () => {
  it('rewrites model ids stored by older versions that OpenRouter rejects', async () => {
    const { mergeSettings } = await import('../src/shared/types');
    const s = mergeSettings({
      openrouter: { apiKey: 'k', model: 'typesafe/jev-latest', endpoint: '' },
      textHelper: { provider: 'openrouter', apiKey: '', baseUrl: 'https://openrouter.ai/api/v1', model: 'deepseek-chat' },
    } as any);
    expect(s.openrouter.model).toBe('typesafe/jev-1.13');
    expect(s.openrouter.endpoint).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(s.openrouter.apiKey).toBe('k');
    expect(s.textHelper.model).toBe('deepseek/deepseek-chat');
  });

  it('keeps a bare DeepSeek id when the helper talks to DeepSeek directly, and fills empty fields', async () => {
    const { mergeSettings } = await import('../src/shared/types');
    const s = mergeSettings({
      openrouter: { apiKey: '', model: '  ', endpoint: '' },
      textHelper: { provider: 'deepseek', apiKey: 'd', baseUrl: '', model: 'deepseek-chat' },
    } as any);
    expect(s.openrouter.model).toBe('typesafe/jev-1.13');
    expect(s.textHelper.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(s.textHelper.model).toBe('deepseek-chat');
    expect(s.maxSteps).toBe(30);
  });

  it('leaves a custom model id alone', async () => {
    const { mergeSettings } = await import('../src/shared/types');
    expect(mergeSettings({ openrouter: { apiKey: '', model: 'typesafe/jev-2.0', endpoint: 'x' } } as any).openrouter.model).toBe('typesafe/jev-2.0');
  });
});
