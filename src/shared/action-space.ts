import { NEXT_ACTION_RULES, TARGET_RULES } from './prompts';
import {
  ElementRect,
  JevQuestions,
  JevRequest,
  ObservedElement,
  PageAction,
  PageSnapshot,
  RecentAction,
} from './types';

export interface ActionSpaceResult {
  elements: ObservedElement[];
  targets: Record<string, Record<string, PageAction>>;
  controls: Record<string, PageAction>;
  operations: Record<string, string>;
  questions: JevQuestions;
}

export function buildActionSpace(
  actions: PageAction[],
  goal: string,
  loopContext?: { warning?: string; suppressedTargetIds?: string[] }
): ActionSpaceResult {
  const elements: ObservedElement[] = [];
  const targets: Record<string, Record<string, PageAction>> = {};
  const controls: Record<string, PageAction> = {
    SCROLL_DOWN: { id: 'scroll_down', kind: 'scroll', delta: 500, label: 'Scroll page down' },
    SCROLL_UP: { id: 'scroll_up', kind: 'scroll', delta: -500, label: 'Scroll page up' },
    WAIT: { id: 'wait', kind: 'wait', label: 'Wait for page/loading indicator to settle' },
  };

  const indices: Record<number, string> = {};
  const opMap: Record<string, string> = {
    click: 'CLICK',
    fill: 'TYPE_TEXT',
    select: 'SELECT',
  };

  const suppressedSet = new Set(loopContext?.suppressedTargetIds || []);

  for (const action of actions) {
    const node = action.node;
    if (node === undefined) continue;

    const kind = action.kind;
    if (!opMap[kind]) continue;

    if (!(node in indices)) {
      const index = String(elements.length + 1);
      indices[node] = index;

      const element: ObservedElement = {
        index,
        label: action.label,
        role: action.role,
        operations: [],
      };

      if (action.value) element.value = action.value;
      if (action.checked !== undefined) element.checked = action.checked;
      if (action.selected !== undefined) element.selected = action.selected;
      if (action.expanded !== undefined) element.expanded = action.expanded;

      if (kind === 'select') {
        element.value = action.current_value || '';
        element.options = [];
      }

      elements.push(element);
    }

    const index = indices[node];
    const operation = opMap[kind];
    const group = (targets[operation] = targets[operation] || {});
    const element = elements[parseInt(index, 10) - 1];

    if (!element.operations.includes(operation)) {
      element.operations.push(operation);
    }

    let targetKey = index;
    if (kind === 'select') {
      targetKey = `${index}:${(element.options?.length || 0) + 1}`;
      element.options = element.options || [];
      element.options.push({
        index: targetKey,
        label: action.label,
        value: action.value || '',
      });
    }

    group[targetKey] = action;
  }

  // Filter out suppressed targets if there are alternative targets available in that operation
  if (suppressedSet.size > 0) {
    for (const [op, group] of Object.entries(targets)) {
      const keys = Object.keys(group);
      const remaining = keys.filter((k) => !suppressedSet.has(group[k].id));
      if (remaining.length > 0) {
        for (const k of keys) {
          if (suppressedSet.has(group[k].id)) {
            delete group[k];
          }
        }
      }
    }
  }

  const opLabels: Record<string, string> = {
    CLICK: 'Click an element, button, menu option, autocomplete suggestion, or calendar day.',
    TYPE_TEXT:
      'Enter or replace text in an editable field. A small LLM will supply the value from the goal.',
    SELECT: 'Select an observed dropdown value.',
  };

  const operations: Record<string, string> = {};
  for (const key of Object.keys(targets)) {
    operations[key] = opLabels[key];
  }
  for (const [key, value] of Object.entries(controls)) {
    operations[key] = value.label;
  }
  operations['DONE'] = 'Every requirement is visibly satisfied.';
  operations['BLOCKED'] = 'No supported operation can progress.';

  const instructionsObj: Record<string, any> = {
    goal,
    rules: NEXT_ACTION_RULES,
  };
  if (loopContext?.warning) {
    instructionsObj.ineffective_action_alert = loopContext.warning;
  }

  const questions: JevQuestions = {
    operation: {
      type: 'choice',
      criteria: operations,
      instructions: instructionsObj,
    },
  };

  for (const [operation, candidates] of Object.entries(targets)) {
    const criteria: Record<string, any> = {};
    for (const [idx, a] of Object.entries(candidates)) {
      criteria[idx] = {
        element: `[${idx}] ${a.label}`,
        current_value: a.current_value || a.value || '',
        ...(a.role ? { role: a.role } : {}),
        ...(a.checked ? { checked: a.checked } : {}),
        ...(a.selected ? { selected: a.selected } : {}),
        ...(a.expanded ? { expanded: a.expanded } : {}),
      };
    }

    questions[`${operation.toLowerCase()}_target`] = {
      type: 'choice',
      criteria,
      instructions: {
        goal,
        operation,
        rules: [NEXT_ACTION_RULES, TARGET_RULES],
        ...(loopContext?.warning ? { notice: loopContext.warning } : {}),
      },
    };
  }

  return { elements, targets, controls, operations, questions };
}

export function buildJevRequest(
  model: string,
  snapshot: PageSnapshot,
  goal: string,
  history: RecentAction[],
  loopContext?: { warning?: string; suppressedTargetIds?: string[] }
): { request: JevRequest; actionSpace: ActionSpaceResult } {
  const actionSpace = buildActionSpace(snapshot.actions, goal, loopContext);

  const request: JevRequest = {
    model,
    state: {
      page: {
        url: snapshot.url,
        title: snapshot.title,
        text: snapshot.text.slice(0, 6000),
      },
      elements: actionSpace.elements,
      recent_actions: history.slice(-10).map((h) => ({
        action: h.action,
        kind: h.kind,
        text: h.text,
        page_changed: h.page_changed ?? false,
      })),
    },
    questions: actionSpace.questions,
  };

  return { request, actionSpace };
}

export function validateChoiceAnswer(
  answer: any,
  candidates: Record<string, any> | string[]
): { choice: string; confidence: number; probabilities: Record<string, number> } {
  if (!answer) {
    throw new Error('Missing answer object from Jev response');
  }

  const allowed = Array.isArray(candidates) ? candidates : Object.keys(candidates);
  const probabilities = answer.probabilities || {};

  let choice = answer.choice;
  if (!choice || !allowed.includes(choice)) {
    // Try to find candidate in allowed list with highest probability
    let bestKey: string | null = null;
    let bestProb = -1;
    for (const key of allowed) {
      if (typeof probabilities[key] === 'number' && probabilities[key] > bestProb) {
        bestProb = probabilities[key];
        bestKey = key;
      }
    }
    if (bestKey !== null && bestProb > 0) {
      choice = bestKey;
    } else {
      const available = allowed.join(', ');
      throw new Error(`Jev returned choice "${choice}", but expected one of: [${available}]`);
    }
  }

  return {
    choice,
    confidence:
      typeof answer.confidence === 'number'
        ? answer.confidence
        : typeof probabilities[choice] === 'number'
        ? probabilities[choice]
        : 1.0,
    probabilities: answer.probabilities || { [choice]: 1.0 },
  };
}
