import { buildJevRequest, validateChoiceAnswer } from '../shared/action-space';
import { activeJevModel, callJevProvider } from '../shared/providers';
import { createFieldContext, generateFieldText } from '../shared/text-helper';
import {
  ActResult,
  AgentProgress,
  ChoiceQuestion,
  AgentStepLog,
  AppSettings,
  DEFAULT_SETTINGS,
  PageAction,
  PageSnapshot,
  RecentAction,
} from '../shared/types';

/** Semantic fingerprint of an observation: URL, scroll, visible text and the element table. */
export function computePageFingerprint(snapshot: PageSnapshot): string {
  const semantics = snapshot.actions.map(({ rect, ...a }) => a);
  return JSON.stringify([snapshot.url, Math.round(snapshot.scroll.y), snapshot.text, semantics]);
}

interface PageSummary {
  url: string;
  title: string;
  textLength: number;
  scrollY: number;
  fingerprint: string;
}

const summarize = (s: PageSnapshot): PageSummary => ({
  url: s.url,
  title: s.title,
  textLength: s.text.length,
  scrollY: s.scroll.y,
  fingerprint: computePageFingerprint(s),
});

/** Describes, in words the model can use, what an action visibly did. */
export function describeOutcome(before: PageSummary, after: PageSummary): string {
  if (after.url !== before.url) return `navigated to ${after.url}`;
  if (after.title !== before.title) return `page changed: "${after.title}"`;
  if (Math.abs(after.textLength - before.textLength) > 50) return 'page content changed (something opened, closed or loaded; same URL)';
  if (Math.abs(after.scrollY - before.scrollY) > 40) return 'scrolled';
  if (after.fingerprint !== before.fingerprint) return 'minor change on the page';
  return 'no visible change';
}

/** DONE / BLOCKED are accepted only when the independent cross-check does not contradict them. */
const GOAL_DONE_MIN = 0.5;
const STUCK_MIN = 0.5;

/**
 * Errors Chrome raises when the page navigated (or its document was replaced) while a message
 * was in flight. The action itself ran; only the reply was lost.
 */
export function isNavigationError(message: string): boolean {
  return (
    /back\/forward cache/i.test(message) ||
    /message (channel|port) (is |was )?closed/i.test(message) ||
    /Receiving end does not exist/i.test(message) ||
    /Frame was removed/i.test(message) ||
    /Extension context invalidated/i.test(message)
  );
}

const OP_BY_KIND: Record<string, string> = { click: 'CLICK', fill: 'TYPE_TEXT', select: 'SELECT', scroll: '', wait: '', key: '' };

function readNoul(answer: any): number | undefined {
  const v = answer?.noul ?? answer?.probability;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : undefined;
}

const INTERNAL_PREFIXES = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'view-source:', 'devtools://'];

const MAX_CONSECUTIVE_STALE = 4;
/** DONE/BLOCKED below this confidence is confirmed by a second look before the run ends. */
const TERMINAL_CONFIRM_THRESHOLD = 0.5;
const DEADLOCK_RUN = 3;
/** Same target executed this many times within the last REPEAT_WINDOW actions ends the run. */
const REPEAT_LIMIT = 3;
const REPEAT_WINDOW = 6;

export class AgentRunner {
  private progress: AgentProgress = {
    status: 'idle',
    goal: '',
    currentStep: 0,
    maxSteps: DEFAULT_SETTINGS.maxSteps,
    logs: [],
  };

  private settings: AppSettings = DEFAULT_SETTINGS;
  private history: RecentAction[] = [];
  private activeTabId: number | null = null;
  private runToken = 0;

  private lastFingerprint: string | null = null;
  private lastSummary: PageSummary | null = null;
  private startUrl = '';
  private visitedUrls: string[] = [];
  private consecutiveStale = 0;
  private decisionCount = 0;
  private targetFailureCount = new Map<string, number>();
  private lastTargetActionId: string | null = null;
  private lastStaleNotice: string | null = null;
  private pendingTerminal: string | null = null;
  private vetoed: 'DONE' | 'BLOCKED' | null = null;
  /** One inconsistent answer is asked again; a second one ends the run. */
  private invalidAnswerRetried = false;
  /** Text generated for a decision that turned out stale; reused only for an identical helper input. */
  private pendingText: { key: string; text: string } | null = null;

  public setSettings(settings: AppSettings): void {
    this.settings = settings;
    if (this.progress.status !== 'running') {
      this.progress.maxSteps = settings.maxSteps || DEFAULT_SETTINGS.maxSteps;
    }
  }

  public getProgress(): AgentProgress {
    return this.progress;
  }

  private reset(goal: string, tabId: number): void {
    this.runToken++;
    this.activeTabId = tabId;
    this.history = [];
    this.lastFingerprint = null;
    this.lastSummary = null;
    this.startUrl = '';
    this.visitedUrls = [];
    this.consecutiveStale = 0;
    this.decisionCount = 0;
    this.targetFailureCount.clear();
    this.lastTargetActionId = null;
    this.lastStaleNotice = null;
    this.pendingTerminal = null;
    this.vetoed = null;
    this.invalidAnswerRetried = false;
    this.pendingText = null;
    this.progress = {
      status: 'running',
      goal,
      currentStep: 0,
      maxSteps: this.settings.maxSteps || DEFAULT_SETTINGS.maxSteps,
      logs: [],
    };
  }

  public async start(goal: string, tabId: number): Promise<void> {
    if (this.progress.status === 'running') return;
    this.reset(goal, tabId);
    this.broadcastUpdate();
    await this.loop(this.runToken);
  }

  /** Executes exactly one step. A new goal, or a finished run, starts over; a paused run continues. */
  public async step(goal: string, tabId: number): Promise<void> {
    if (this.progress.status === 'running') return;
    const continuing = this.progress.status === 'paused' && goal === this.progress.goal && tabId === this.activeTabId;
    if (!continuing) {
      this.reset(goal, tabId);
    } else {
      this.runToken++;
      this.progress.status = 'running';
    }
    const token = this.runToken;

    if (this.progress.currentStep >= this.progress.maxSteps) {
      this.finish('blocked', `Reached the ${this.progress.maxSteps}-step budget.`);
      return;
    }

    this.broadcastUpdate();
    const cont = await this.executeOneStep(token);
    if (token === this.runToken && this.progress.status === 'running') {
      this.progress.status = cont ? 'paused' : 'idle';
    }
    this.broadcastUpdate();
  }

  public stop(): void {
    this.runToken++;
    if (this.progress.status === 'running' || this.progress.status === 'paused') {
      this.progress.status = 'idle';
    }
    this.broadcastUpdate();
    this.sendStatus({ clear: true });
  }

  private async loop(token: number): Promise<void> {
    while (token === this.runToken && this.progress.status === 'running') {
      if (this.progress.currentStep >= this.progress.maxSteps) {
        this.finish('blocked', `Reached the ${this.progress.maxSteps}-step budget without DONE.`);
        break;
      }
      const cont = await this.executeOneStep(token);
      if (!cont) break;
      if (this.settings.stepDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.settings.stepDelayMs));
      }
    }
  }

  /** Resolves when the tab finishes loading, or after a timeout. */
  private async waitForTabToLoad(tabId: number, timeoutMs = 8000): Promise<void> {
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      };
      const listener = (updatedTabId: number, changeInfo: chrome.tabs.OnUpdatedInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') finish();
      };
      chrome.tabs.onUpdated.addListener(listener);
      chrome.tabs
        .get(tabId)
        .then((tab) => {
          if (tab.status === 'complete') finish();
        })
        .catch(() => finish());
      setTimeout(finish, timeoutMs);
    });
    // Let the new document run its first frames before observing.
    await new Promise((r) => setTimeout(r, 150));
  }

  private lastPingError = '';

  private async ping(tabId: number): Promise<boolean> {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      return !!res?.pong;
    } catch (err: any) {
      this.lastPingError = err?.message || String(err);
      return false;
    }
  }

  /** Makes sure a single content script instance is listening in the tab. */
  private async ensureContentScriptReady(tabId: number): Promise<void> {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || '';
    if (INTERNAL_PREFIXES.some((p) => url.startsWith(p))) {
      throw new Error(
        `Cannot run on internal browser page (${url}). Open a regular web page and try again.`
      );
    }
    // Inject as soon as a document exists instead of waiting for the load event: the script
    // guards against double registration, so a later manifest injection is harmless.
    let injectError = '';
    for (let attempt = 0; attempt < 6; attempt++) {
      if (await this.ping(tabId)) return;
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      } catch (err: any) {
        injectError = err?.message || String(err);
      }
      const current = attempt >= 3 ? await chrome.tabs.get(tabId).catch(() => null) : null;
      if (current?.status === 'loading') await this.waitForTabToLoad(tabId, 2000);
      else await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
    if (!(await this.ping(tabId))) {
      throw new Error(
        `Content script did not respond after injection (${this.lastPingError || 'no reply'}${injectError ? `; inject: ${injectError}` : ''}). Reload the page and try again.`
      );
    }
  }

  /**
   * One observe → decide → act cycle. Returns false when the run has ended.
   * A stale decision is discarded and the page is observed again without recording a step.
   */
  private async executeOneStep(token: number): Promise<boolean> {
    const tabId = this.activeTabId;
    if (tabId === null) {
      this.finish('error', 'No active tab identified');
      return false;
    }

    // 1. Observe
    let snapshot: PageSnapshot;
    try {
      await this.ensureContentScriptReady(tabId);
      const response = await chrome.tabs.sendMessage(tabId, { type: 'CONTENT_OBSERVE' });
      if (!response?.success || !response.snapshot) {
        throw new Error(response?.error || 'Failed to capture page DOM snapshot');
      }
      snapshot = response.snapshot;
    } catch (err: any) {
      this.finish('error', `Observe failed: ${err?.message || String(err)}`);
      return false;
    }
    if (token !== this.runToken) return false;

    // 2. Resolve what the previous action did and detect deadlocks
    const summary = summarize(snapshot);
    const fingerprint = summary.fingerprint;
    if (!this.startUrl) this.startUrl = snapshot.url;
    if (this.visitedUrls[this.visitedUrls.length - 1] !== snapshot.url) this.visitedUrls.push(snapshot.url);
    const last = this.history[this.history.length - 1];
    if (last && last.page_changed === undefined && this.lastSummary) {
      last.outcome = describeOutcome(this.lastSummary, summary);
      last.url = snapshot.url;
      last.page_changed = fingerprint !== this.lastFingerprint;
      if (!last.page_changed && this.lastTargetActionId && last.kind !== 'wait') {
        const count = (this.targetFailureCount.get(this.lastTargetActionId) || 0) + 1;
        this.targetFailureCount.set(this.lastTargetActionId, count);
      } else if (last.page_changed) {
        this.targetFailureCount.clear();
      }
    }
    this.lastFingerprint = fingerprint;
    this.lastSummary = summary;

    const recent = this.history.slice(-DEADLOCK_RUN);
    if (
      recent.length === DEADLOCK_RUN &&
      recent.every((h) => h.page_changed === false && h.kind !== 'wait')
    ) {
      this.finish(
        'blocked',
        `${DEADLOCK_RUN} consecutive actions produced no change on the page. Inspect the page or adjust the goal.`
      );
      return false;
    }

    // 3. Loop feedback for the model. Toggling the same control (a menu that opens and closes)
    //    changes the page every time, so repeats are tracked separately from "no change".
    let warning: string | undefined;
    const repeatedAction = last?.action && last.kind !== 'wait' ? last.action : null;
    const repeated = repeatedAction ? this.repeatCount(repeatedAction) : 0;
    if (repeated >= REPEAT_LIMIT) {
      this.finish('blocked', `The same action "${repeatedAction}" was repeated ${repeated} times without reaching the goal.`);
      return false;
    }
    const suppressedTargetIds = Array.from(this.targetFailureCount.entries())
      .filter(([, count]) => count >= 2)
      .map(([id]) => id);
    if (last && last.page_changed === false && last.kind !== 'wait') {
      warning = `ATTENTION: Previous action "${last.action}" resulted in NO visible change on the page. Do NOT repeat the exact same action. Try an alternative target, scroll, or submit button.`;
    } else if (repeated >= 2 && repeatedAction) {
      warning = `ATTENTION: "${repeatedAction}" has now been executed ${repeated} times and did not advance the goal. Do NOT choose it again; use a different control that moves toward the goal.`;
      // Ids are per snapshot; withhold whatever on this page carries the same operation and label.
      for (const a of snapshot.actions) {
        if (a.node !== undefined && `${OP_BY_KIND[a.kind] || ''} ${a.label}` === repeatedAction) suppressedTargetIds.push(a.id);
      }
    } else if (this.lastStaleNotice) {
      warning = this.lastStaleNotice;
    }
    this.lastStaleNotice = null;

    // 4. Decide
    if (this.decisionCount >= this.progress.maxSteps * 2) {
      this.finish('blocked', 'Reached the model-call budget for this run.');
      return false;
    }
    const { request, actionSpace } = buildJevRequest(
      activeJevModel(this.settings),
      snapshot,
      this.progress.goal,
      this.history,
      { warning, suppressedTargetIds },
      { start_url: this.startUrl, steps_taken: this.history.length, visited_urls: this.visitedUrls.slice(-6) }
    );
    if (this.vetoed) {
      // The previous verdict was contradicted by its cross-check; withhold it this time.
      delete actionSpace.operations[this.vetoed];
      delete (request.questions.operation as ChoiceQuestion).criteria[this.vetoed];
      this.vetoed = null;
    }

    const started = Date.now();
    let jevResponse;
    try {
      this.decisionCount++;
      jevResponse = await callJevProvider(this.settings, request);
    } catch (err: any) {
      this.finish('error', `Jev decision failed: ${err?.message || String(err)}`);
      return false;
    }
    const latencyMs = Date.now() - started;
    if (token !== this.runToken) return false;

    let operationAnswer;
    try {
      operationAnswer = validateChoiceAnswer(jevResponse.answers?.operation, actionSpace.operations);
    } catch (err: any) {
      return this.rejectAnswer(`Invalid operation choice: ${err?.message || String(err)}`);
    }
    const operation = operationAnswer.choice;
    const provider = this.settings.activeProvider;
    const goalDone = readNoul(jevResponse.answers?.goal_done);
    const stuck = readNoul(jevResponse.answers?.stuck);

    if (operation === 'DONE' && goalDone !== undefined && goalDone < GOAL_DONE_MIN) {
      this.vetoed = 'DONE';
      this.lastStaleNotice = `ATTENTION: DONE was proposed, but the independent goal check says the task is not achieved yet (probability ${goalDone.toFixed(2)}). Something in the task is still missing; act on it.`;
      this.addLog({ step: this.progress.currentStep, timestamp: Date.now(), operation: 'DONE (vetoed)', confidence: operationAnswer.confidence, latencyMs, provider, probabilities: operationAnswer.probabilities, goalDone, stuck });
      this.broadcastUpdate();
      return true;
    }
    if (operation === 'BLOCKED' && stuck !== undefined && stuck < STUCK_MIN && this.history.length < REPEAT_WINDOW) {
      this.vetoed = 'BLOCKED';
      this.lastStaleNotice = `ATTENTION: BLOCKED was proposed, but the independent progress check does not see a dead end (stuck probability ${stuck.toFixed(2)}). Choose a control that moves toward the task.`;
      this.addLog({ step: this.progress.currentStep, timestamp: Date.now(), operation: 'BLOCKED (vetoed)', confidence: operationAnswer.confidence, latencyMs, provider, probabilities: operationAnswer.probabilities, goalDone, stuck });
      this.broadcastUpdate();
      return true;
    }

    if (operation === 'DONE' || operation === 'BLOCKED') {
      if (operationAnswer.confidence < TERMINAL_CONFIRM_THRESHOLD && this.pendingTerminal !== operation) {
        // A hesitant verdict gets one more look after the page settles; only a repeat ends the run.
        this.pendingTerminal = operation;
        this.sendStatus({ text: `${operation}? confirming`, latencyMs });
        await new Promise((r) => setTimeout(r, 600));
        return true;
      }
      this.addLog({
        step: this.progress.currentStep,
        timestamp: Date.now(),
        operation,
        confidence: operationAnswer.confidence,
        latencyMs,
        provider,
        probabilities: operationAnswer.probabilities,
        goalDone,
        stuck,
      });
      this.finish(operation === 'DONE' ? 'done' : 'blocked');
      this.sendStatus({ text: operation === 'DONE' ? 'Done' : 'Blocked', latencyMs });
      return false;
    }

    this.pendingTerminal = null;

    // 5. Resolve the target from the selected operation's head only
    let targetAction: PageAction | undefined;
    let targetConfidence = operationAnswer.confidence;
    if (operation in actionSpace.targets) {
      try {
        const targetAnswer = validateChoiceAnswer(
          jevResponse.answers?.[`${operation.toLowerCase()}_target`],
          actionSpace.targets[operation]
        );
        targetAction = actionSpace.targets[operation][targetAnswer.choice];
        targetConfidence = targetAnswer.confidence;
      } catch (err: any) {
        return this.rejectAnswer(`Invalid target choice: ${err?.message || String(err)}`);
      }
    } else if (operation in actionSpace.controls) {
      targetAction = actionSpace.controls[operation];
    }
    if (!targetAction) {
      this.finish('error', `Could not find target action for operation: ${operation}`);
      return false;
    }

    // 6. TYPE_TEXT: the helper supplies the value; reuse it only for an identical input after a stale retry
    let generatedText: string | undefined;
    if (operation === 'TYPE_TEXT') {
      const context = createFieldContext(
        this.progress.goal,
        targetAction,
        { title: snapshot.title, text: snapshot.text },
        this.history
      );
      const key = JSON.stringify(context);
      if (this.pendingText && this.pendingText.key === key) {
        generatedText = this.pendingText.text;
      } else {
        try {
          generatedText = await generateFieldText(this.settings, context);
        } catch (err: any) {
          const message = err?.message || String(err);
          if (!/nothing typed/i.test(message)) {
            this.finish('error', `Text helper failed: ${message}`);
            return false;
          }
          // The helper could not derive a value from the goal: the field is not the way
          // forward. Tell the model and withhold the field after two attempts.
          this.consecutiveStale++;
          if (this.consecutiveStale >= MAX_CONSECUTIVE_STALE) {
            this.finish('error', `Text helper failed: ${message}`);
            return false;
          }
          this.targetFailureCount.set(targetAction.id, (this.targetFailureCount.get(targetAction.id) || 0) + 1);
          this.lastStaleNotice = `ATTENTION: No value for the field "${targetAction.label}" can be derived from the goal, so TYPE_TEXT there is not possible. Use links, buttons or other controls instead.`;
          this.broadcastUpdate();
          return true;
        }
        this.pendingText = { key, text: generatedText };
      }
      if (token !== this.runToken) return false;
    }

    // 7. Act (never retried)
    this.sendStatus({ text: `${operation} ${targetAction.label}`.slice(0, 120), latencyMs });
    let navigated = false;
    try {
      const actResponse: ActResult | undefined = await chrome.tabs.sendMessage(tabId, {
        type: 'CONTENT_ACT',
        action: targetAction,
        text: generatedText,
      });
      if (actResponse?.stale) {
        this.consecutiveStale++;
        if (this.consecutiveStale >= MAX_CONSECUTIVE_STALE) {
          this.finish('error', `Page kept changing before actions could run: ${actResponse.error || 'stale'}`);
          return false;
        }
        // A covered or vanished target counts as a miss: the model is told, and after two
        // misses the target is withheld while alternatives exist.
        this.targetFailureCount.set(targetAction.id, (this.targetFailureCount.get(targetAction.id) || 0) + 1);
        this.lastStaleNotice = `ATTENTION: The target "${targetAction.label}" could not be acted on (${actResponse.error || 'page changed'}). If an overlay or dialog is open, act inside it or close it; otherwise choose a different target.`;
        this.broadcastUpdate();
        // A covered or vanished target usually means the page is still loading or animating
        // (an in-page sort or filter that swaps the list); give it more time before looking again.
        await new Promise((r) => setTimeout(r, 500 * this.consecutiveStale));
        return true; // observe again; nothing was executed
      }
      if (!actResponse?.success) {
        throw new Error(actResponse?.error || 'Content action returned failure');
      }
    } catch (err: any) {
      const message = err?.message || String(err);
      if (!isNavigationError(message)) {
        this.finish('error', `Act execution failed: ${message}`);
        return false;
      }
      // The action ran and the page navigated before it could reply; the action still counts.
      navigated = true;
    }

    // 8. Record execution before observing again
    this.consecutiveStale = 0;
    this.invalidAnswerRetried = false;
    this.pendingText = null;
    this.lastTargetActionId = targetAction.id;
    this.history.push({
      step: this.progress.currentStep + 1,
      action: `${operation} ${targetAction.label}`,
      kind: targetAction.kind,
      text: generatedText,
      page_changed: undefined,
    });
    this.progress.currentStep++;
    this.addLog({
      step: this.progress.currentStep,
      timestamp: Date.now(),
      operation,
      targetId: targetAction.id,
      targetLabel: targetAction.label,
      targetValue: generatedText,
      confidence: targetConfidence,
      latencyMs,
      provider,
      probabilities: operationAnswer.probabilities,
      goalDone,
      stuck,
    });
    this.broadcastUpdate();

    // A click, select or Enter may have started a navigation that only shows up as the tab
    // loading; observing the old document now would hand the model a page that is about to
    // disappear.
    if (navigated) {
      await this.waitForTabToLoad(tabId);
    } else {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (tab?.status === 'loading') await this.waitForTabToLoad(tabId);
    }
    return true;
  }

  /** An inconsistent model answer is not executed. The first one is simply asked again. */
  private rejectAnswer(message: string): boolean {
    if (!this.invalidAnswerRetried) {
      this.invalidAnswerRetried = true;
      this.lastStaleNotice = null;
      this.broadcastUpdate();
      return true;
    }
    this.finish('error', message);
    return false;
  }

  /** How often the same operation + label was executed within the recent window (counting the last action). */
  private repeatCount(action: string): number {
    return this.history.slice(-REPEAT_WINDOW).filter((h) => h.action === action && h.kind !== 'wait').length;
  }

  private addLog(log: AgentStepLog): void {
    this.progress.logs.unshift(log);
    if (this.progress.logs.length > 50) this.progress.logs.pop();
  }

  private finish(status: 'done' | 'blocked' | 'error', message?: string): void {
    this.progress.status = status;
    if (message) {
      this.progress.lastError = message;
    } else {
      delete this.progress.lastError;
    }
    this.broadcastUpdate();
    if (status !== 'done') this.sendStatus({ text: message || status });
  }

  private broadcastUpdate(): void {
    try {
      chrome.runtime
        .sendMessage({ type: 'PROGRESS_UPDATE', progress: this.progress })
        .catch(() => {
          // Popup might be closed
        });
    } catch {
      // No receiver available
    }
  }

  private sendStatus(payload: { text?: string; latencyMs?: number; clear?: boolean }): void {
    if (this.activeTabId === null) return;
    try {
      chrome.tabs.sendMessage(this.activeTabId, { type: 'CONTENT_STATUS', ...payload }).catch(() => {
        // Tab may be navigating
      });
    } catch {
      // Tab gone
    }
  }
}
