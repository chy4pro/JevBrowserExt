import { NEXT_ACTION_RULES, TARGET_RULES } from './prompts';
import {
  JevQuestions,
  JevRequest,
  ObservedElement,
  PageAction,
  PageSnapshot,
  RecentAction,
} from './types';

export interface LoopContext {
  warning?: string;
  suppressedTargetIds?: string[];
}

export interface ActionSpaceResult {
  elements: ObservedElement[];
  targets: Record<string, Record<string, PageAction>>;
  controls: Record<string, PageAction>;
  operations: Record<string, string>;
  questions: JevQuestions;
}

const OP_BY_KIND: Record<string, string> = {
  click: 'CLICK',
  fill: 'TYPE_TEXT',
  select: 'SELECT',
};

const OP_LABELS: Record<string, string> = {
  CLICK: 'Click an element, button, menu option, autocomplete suggestion, or calendar day.',
  TYPE_TEXT:
    'Enter or replace text in an editable field. A small LLM will supply the value from the goal.',
  SELECT: 'Select an observed dropdown value.',
};

/**
 * One index per observed element; each operation has its own valid target choices.
 * Controls (scroll/wait) come from the snapshot, so a scroll that cannot move is never offered.
 */
export function buildActionSpace(
  actions: PageAction[],
  goal: string,
  loopContext?: LoopContext
): ActionSpaceResult {
  const elements: ObservedElement[] = [];
  const targets: Record<string, Record<string, PageAction>> = {};
  const controls: Record<string, PageAction> = {};
  const indices: Record<number, string> = {};

  for (const action of actions) {
    const operation = OP_BY_KIND[action.kind];
    if (!operation) {
      controls[action.id.toUpperCase()] = action;
      continue;
    }
    const node = action.node;
    if (node === undefined) continue;

    if (!(node in indices)) {
      const index = String(elements.length + 1);
      indices[node] = index;

      const element: ObservedElement = {
        index,
        label: action.label.split(' → ')[0],
        operations: [],
      };
      if (action.role) element.role = action.role;
      if (action.value) element.value = action.value;
      if (action.checked !== undefined) element.checked = action.checked;
      if (action.selected !== undefined) element.selected = action.selected;
      if (action.expanded !== undefined) element.expanded = action.expanded;
      if (action.kind === 'select') {
        element.value = action.current_value || '';
        element.options = [];
      }
      elements.push(element);
    }

    const index = indices[node];
    const group = (targets[operation] = targets[operation] || {});
    const element = elements[parseInt(index, 10) - 1];
    if (!element.operations.includes(operation)) {
      element.operations.push(operation);
    }

    let targetKey = index;
    if (action.kind === 'select') {
      element.options = element.options || [];
      targetKey = `${index}:${element.options.length + 1}`;
      element.options.push({ index: targetKey, label: action.label, value: action.value || '' });
    }
    group[targetKey] = action;
  }

  // Drop targets that repeatedly produced no change, as long as alternatives remain.
  const suppressed = new Set(loopContext?.suppressedTargetIds || []);
  if (suppressed.size > 0) {
    for (const group of Object.values(targets)) {
      const keys = Object.keys(group);
      if (keys.some((k) => !suppressed.has(group[k].id))) {
        for (const k of keys) {
          if (suppressed.has(group[k].id)) delete group[k];
        }
      }
    }
  }

  const operations: Record<string, string> = {};
  for (const key of Object.keys(targets)) operations[key] = OP_LABELS[key];
  for (const [key, value] of Object.entries(controls)) operations[key] = value.label;
  operations.DONE = 'Every requirement is visibly satisfied.';
  operations.BLOCKED = 'No supported operation can progress.';

  const instructions: Record<string, any> = { goal, rules: NEXT_ACTION_RULES };
  if (loopContext?.warning) instructions.ineffective_action_alert = loopContext.warning;

  const questions: JevQuestions = {
    operation: { type: 'choice', criteria: operations, instructions },
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
  loopContext?: LoopContext
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

export interface ValidatedChoice {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

const unit = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;

/**
 * Strictly validates a choice answer. An invalid answer is rejected rather than "repaired":
 * the model's choice must be an offered candidate and must agree with its own distribution.
 */
export function validateChoiceAnswer(
  answer: any,
  candidates: Record<string, any> | string[]
): ValidatedChoice {
  if (!answer || typeof answer !== 'object') {
    throw new Error('Missing answer object from Jev response; no action executed.');
  }
  const allowed = Array.isArray(candidates) ? candidates : Object.keys(candidates);
  const choice = answer.choice;
  if (typeof choice !== 'string' || !allowed.includes(choice)) {
    throw new Error(
      `Jev returned choice "${String(choice)}", but expected one of: [${allowed.join(', ')}]`
    );
  }

  const probabilities = answer.probabilities;
  if (!probabilities || typeof probabilities !== 'object') {
    throw new Error('Jev response is missing probabilities; no action executed.');
  }
  const entries = Object.entries(probabilities) as Array<[string, unknown]>;
  if (entries.length === 0 || !entries.every(([k, v]) => allowed.includes(k) && unit(v))) {
    throw new Error('Jev probabilities contain unknown candidates or invalid values; no action executed.');
  }
  const dist = probabilities as Record<string, number>;
  if (!(choice in dist)) {
    throw new Error(`Jev chose "${choice}" without assigning it a probability; no action executed.`);
  }
  const sum = entries.reduce((acc, [, v]) => acc + (v as number), 0);
  if (Math.abs(sum - 1) > 0.02) {
    throw new Error('Jev probabilities do not sum to 1; no action executed.');
  }
  const max = Math.max(...Object.values(dist));
  if (dist[choice] < max - 1e-6) {
    throw new Error(`Jev chose "${choice}" but a different candidate has higher probability; no action executed.`);
  }

  return {
    choice,
    confidence: unit(answer.confidence) ? answer.confidence : dist[choice],
    probabilities: dist,
  };
}
