import { buildJevRequest, validateChoiceAnswer } from '../shared/action-space';
import { activeJevModel, callJevProvider } from '../shared/providers';
import { createFieldContext, generateFieldText } from '../shared/text-helper';
import {
  ActResult,
  AgentProgress,
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

/** Errors from a tab that navigated away while a message was in flight. */
function isNavigationError(message: string): boolean {
  return (
    message.includes('back/forward cache') ||
    message.includes('message channel is closed') ||
    message.includes('message port closed') ||
    message.includes('Receiving end does not exist') ||
    message.includes('Frame was removed')
  );
}

const INTERNAL_PREFIXES = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'view-source:', 'devtools://'];

const MAX_CONSECUTIVE_STALE = 3;
const DEADLOCK_RUN = 3;

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
  private consecutiveStale = 0;
  private decisionCount = 0;
  private targetFailureCount = new Map<string, number>();
  private lastTargetActionId: string | null = null;
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
    this.consecutiveStale = 0;
    this.decisionCount = 0;
    this.targetFailureCount.clear();
    this.lastTargetActionId = null;
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

  /** Makes sure a single content script instance is listening in the tab. */
  private async ensureContentScriptReady(tabId: number): Promise<void> {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || '';
    if (INTERNAL_PREFIXES.some((p) => url.startsWith(p))) {
      throw new Error(
        `Cannot run on internal browser page (${url}). Open a regular web page and try again.`
      );
    }
    if (tab.status === 'loading') {
      await this.waitForTabToLoad(tabId);
    }
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    } catch {
      // The content script guards against double registration, so injecting is safe.
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await new Promise((resolve) => setTimeout(resolve, 100));
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

    // 2. Resolve page_changed for the previous action and detect deadlocks
    const fingerprint = computePageFingerprint(snapshot);
    const last = this.history[this.history.length - 1];
    if (last && last.page_changed === undefined && this.lastFingerprint !== null) {
      last.page_changed = fingerprint !== this.lastFingerprint;
      if (!last.page_changed && this.lastTargetActionId && last.kind !== 'wait') {
        const count = (this.targetFailureCount.get(this.lastTargetActionId) || 0) + 1;
        this.targetFailureCount.set(this.lastTargetActionId, count);
      } else if (last.page_changed) {
        this.targetFailureCount.clear();
      }
    }
    this.lastFingerprint = fingerprint;

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

    // 3. Loop feedback for the model
    let warning: string | undefined;
    if (last && last.page_changed === false && last.kind !== 'wait') {
      warning = `ATTENTION: Previous action "${last.action}" resulted in NO visible change on the page. Do NOT repeat the exact same action. Try an alternative target, scroll, or submit button.`;
    }
    const suppressedTargetIds = Array.from(this.targetFailureCount.entries())
      .filter(([, count]) => count >= 2)
      .map(([id]) => id);

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
      { warning, suppressedTargetIds }
    );

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
      this.finish('error', `Invalid operation choice: ${err?.message || String(err)}`);
      return false;
    }
    const operation = operationAnswer.choice;
    const provider = this.settings.activeProvider;

    if (operation === 'DONE' || operation === 'BLOCKED') {
      this.addLog({
        step: this.progress.currentStep,
        timestamp: Date.now(),
        operation,
        confidence: operationAnswer.confidence,
        latencyMs,
        provider,
        probabilities: operationAnswer.probabilities,
      });
      this.finish(operation === 'DONE' ? 'done' : 'blocked');
      this.sendStatus({ text: operation === 'DONE' ? 'Done' : 'Blocked', latencyMs });
      return false;
    }

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
        this.finish('error', `Invalid target choice: ${err?.message || String(err)}`);
        return false;
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
          this.finish('error', `Text helper failed: ${err?.message || String(err)}`);
          return false;
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
        this.broadcastUpdate();
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
    this.pendingText = null;
    this.lastTargetActionId = targetAction.id;
    this.history.push({
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
    });
    this.broadcastUpdate();

    if (navigated) {
      await this.waitForTabToLoad(tabId);
    }
    return true;
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
