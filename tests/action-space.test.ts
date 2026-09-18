import { describe, expect, it } from 'vitest';
import {
  buildActionSpace,
  buildJevRequest,
  validateChoiceAnswer,
} from '../src/shared/action-space';
import { PageAction, PageSnapshot } from '../src/shared/types';

describe('Action Space and Question Formulation', () => {
  const sampleActions: PageAction[] = [
    {
      id: 'e1',
      node: 101,
      kind: 'click',
      role: 'button',
      label: 'Search Flights',
    },
    {
      id: 'e2',
      node: 102,
      kind: 'fill',
      role: 'textbox',
      label: 'Departure City',
      value: '',
    },
    {
      id: 'e3',
      node: 103,
      kind: 'select',
      role: 'combobox',
      label: 'Trip Type',
      value: 'one_way',
      current_value: 'Round Trip',
    },
    {
      id: 'scroll_down',
      kind: 'scroll',
      label: 'Scroll down',
      delta: 560,
    },
    {
      id: 'wait',
      kind: 'wait',
      label: 'Wait for page update',
    },
  ];

  it('correctly categorizes operations and creates candidate target questions', () => {
    const actionSpace = buildActionSpace(sampleActions, 'Fly from Zurich to London');

    // Check elements
    expect(actionSpace.elements.length).toBe(3);
    expect(actionSpace.elements[0].label).toBe('Search Flights');
    expect(actionSpace.elements[1].label).toBe('Departure City');

    // Check targets heads
    expect(actionSpace.targets['CLICK']).toBeDefined();
    expect(actionSpace.targets['TYPE_TEXT']).toBeDefined();
    expect(actionSpace.targets['SELECT']).toBeDefined();

    // Check operations in question
    expect(actionSpace.operations['CLICK']).toBeDefined();
    expect(actionSpace.operations['TYPE_TEXT']).toBeDefined();
    expect(actionSpace.operations['SELECT']).toBeDefined();
    expect(actionSpace.operations['SCROLL_DOWN']).toBeDefined();
    expect(actionSpace.operations['WAIT']).toBeDefined();
    expect(actionSpace.operations['DONE']).toBeDefined();
    expect(actionSpace.operations['BLOCKED']).toBeDefined();

    // Check questions payload
    expect(actionSpace.questions.operation.type).toBe('choice');
    expect(actionSpace.questions.click_target.type).toBe('choice');
    expect(actionSpace.questions.type_text_target.type).toBe('choice');
    expect(actionSpace.questions.select_target.type).toBe('choice');
  });

  it('buildJevRequest formats the full state with page text and recent actions', () => {
    const snapshot: PageSnapshot = {
      url: 'https://www.google.com/travel/flights',
      title: 'Google Flights',
      w: 1200,
      h: 800,
      text: 'Find cheap flights from Zurich to anywhere',
      scroll: { y: 0, height: 1600 },
      actions: sampleActions,
      marker: [],
      page_key: [],
      guards: {},
      omitted_actions: 0,
    };

    const { request, actionSpace } = buildJevRequest(
      'jev-latest',
      snapshot,
      'Search flights',
      [{ action: 'CLICK button', kind: 'click' }]
    );

    expect(request.model).toBe('jev-latest');
    expect(request.state.page.title).toBe('Google Flights');
    expect(request.state.elements.length).toBe(actionSpace.elements.length);
    expect(request.state.recent_actions.length).toBe(1);
    expect(request.questions.operation).toBeDefined();
  });

  describe('validateChoiceAnswer', () => {
    const allowed = ['CLICK', 'TYPE_TEXT', 'DONE'];

    it('returns answer when choice is valid', () => {
      const res = validateChoiceAnswer(
        { choice: 'CLICK', confidence: 0.95, probabilities: { CLICK: 0.95, TYPE_TEXT: 0.05 } },
        allowed
      );
      expect(res.choice).toBe('CLICK');
      expect(res.confidence).toBe(0.95);
    });

    it('falls back to highest probability candidate if choice is invalid or missing', () => {
      const res = validateChoiceAnswer(
        { choice: 'UNKNOWN_OP', probabilities: { CLICK: 0.88, TYPE_TEXT: 0.12 } },
        allowed
      );
      expect(res.choice).toBe('CLICK');
      expect(res.confidence).toBe(0.88);
    });

    it('throws error if no candidate matches', () => {
      expect(() =>
        validateChoiceAnswer(
          { choice: 'INVALID', probabilities: { OTHER: 1.0 } },
          allowed
        )
      ).toThrow();
    });
  });
});
