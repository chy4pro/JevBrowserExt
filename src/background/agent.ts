import { buildJevRequest, validateChoiceAnswer } from '../shared/action-space';
import { callJevProvider } from '../shared/providers';
import { createFieldContext, generateFieldText } from '../shared/text-helper';
import {
  AgentProgress,
  AgentStepLog,
  AppSettings,
  DEFAULT_SETTINGS,
  PageAction,
  PageSnapshot,
  RecentAction,
} from '../shared/types';

function computePageFingerprint(snapshot: PageSnapshot): string {
  const inputValues = snapshot.actions
    .filter((a) => a.kind === 'fill' || a.value)
    .map((a) => `${a.id}:${a.value || ''}`)
    .join('|');
  return `${snapshot.url}##${Math.round(snapshot.scroll.y)}##${snapshot.actions.length}##${inputValues}##${snapshot.text.slice(0, 500)}`;
}

export class AgentRunner {
  private progress: AgentProgress = {
    status: 'idle',
    goal: '',
    currentStep: 0,
    maxSteps: 30,
    logs: [],
  };

  private isAborted = false;
  private isSingleStep = false;
  private settings: AppSettings = DEFAULT_SETTINGS;
  private history: RecentAction[] = [];
  private activeTabId: number | null = null;

  // Adaptive Loop & Deadlock Prevention
  private lastFingerprint: string | null = null;
  private consecutiveNoChangeCount = 0;
  private targetFailureCount = new Map<string, number>();
  private lastTargetActionId: string | null = null;

  public setSettings(settings: AppSettings): void {
    this.settings = settings;
    if (this.settings.openrouter?.model === 'typesafe/jev-latest') {
      this.settings.openrouter.model = 'typesafe/jev-1.13';
    }
    this.progress.maxSteps = settings.maxSteps || 30;
  }

  public getProgress(): AgentProgress {
    return this.progress;
  }

  public async start(goal: string, tabId: number): Promise<void> {
    if (this.progress.status === 'running') {
      return;
    }

    this.isAborted = false;
    this.isSingleStep = false;
    this.activeTabId = tabId;
    this.history = [];
    this.lastFingerprint = null;
    this.consecutiveNoChangeCount = 0;
    this.targetFailureCount.clear();
    this.lastTargetActionId = null;

    this.progress = {
      status: 'running',
      goal,
      currentStep: 0,
      maxSteps: this.settings.maxSteps || 30,
      logs: [],
    };

    this.broadcastUpdate();
    await this.loop();
  }

  public async step(goal: string, tabId: number): Promise<void> {
    this.isAborted = false;
    this.isSingleStep = true;
    this.activeTabId = tabId;
    this.progress.status = 'running';
    this.progress.goal = goal;
    this.broadcastUpdate();

    await this.executeOneStep();

    if (this.progress.status === 'running') {
      this.progress.status = 'paused';
    }
    this.broadcastUpdate();
  }

  public stop(): void {
    this.isAborted = true;
    this.progress.status = 'idle';
    this.broadcastUpdate();
  }

  private async loop(): Promise<void> {
    while (!this.isAborted && this.progress.status === 'running') {
      if (this.progress.currentStep >= this.progress.maxSteps) {
        this.progress.status = 'done';
        this.broadcastUpdate();
        break;
      }

      const continueLoop = await this.executeOneStep();
      if (!continueLoop) break;

      if (this.settings.stepDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.settings.stepDelayMs));
      }
    }
  }

  /**
   * Waits for a tab to finish loading after a navigation event.
   */
  private async waitForTabToLoad(tabId: number, timeoutMs = 8000): Promise<void> {
    await new Promise<void>((resolve) => {
      let isDone = false;

      const finish = () => {
        if (!isDone) {
          isDone = true;
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };

      const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          finish();
        }
      };

      chrome.tabs.onUpdated.addListener(listener);

      // Check current tab state right away
      chrome.tabs.get(tabId).then((tab) => {
        if (tab.status === 'complete') {
          setTimeout(finish, 400);
        }
      }).catch(() => finish());

      setTimeout(finish, timeoutMs);
    });

    // Small delay after page load for DOM stabilization
    await new Promise((r) => setTimeout(r, 400));
  }

  /**
   * Ensures the content script is running in the tab, injecting it dynamically if needed.
   */
  private async ensureContentScriptReady(tabId: number): Promise<void> {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || '';

    if (
      url.startsWith('chrome://') ||
      url.startsWith('chrome-extension://') ||
      url.startsWith('edge://') ||
      url.startsWith('about:') ||
      url.startsWith('view-source:')
    ) {
      throw new Error(
        `Cannot run on internal browser page (${url}). Please open a real web page (e.g. google.com or wikipedia.org) and try again.`
      );
    }

    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  private async executeOneStep(): Promise<boolean> {
    if (!this.activeTabId) {
      this.finishWithError('No active tab identified');
      return false;
    }

    this.progress.currentStep++;
    this.broadcastUpdate();

    // 1. Ensure content script is injected and observe the page
    let snapshot: PageSnapshot;
    try {
      await this.ensureContentScriptReady(this.activeTabId);

      const response = await chrome.tabs.sendMessage(this.activeTabId, {
        type: 'CONTENT_OBSERVE',
      });
      if (!response || !response.success || !response.snapshot) {
        throw new Error(response?.error || 'Failed to capture page DOM snapshot');
      }
      snapshot = response.snapshot;
    } catch (err: any) {
      this.finishWithError(`Observe failed: ${err.message || String(err)}`);
      return false;
    }

    // 2. Real Fingerprint & Loop Detection
    const currentFingerprint = computePageFingerprint(snapshot);
    if (this.lastFingerprint !== null && this.history.length > 0) {
      const pageChanged = currentFingerprint !== this.lastFingerprint;
      this.history[this.history.length - 1].page_changed = pageChanged;

      if (!pageChanged) {
        this.consecutiveNoChangeCount++;
        if (this.lastTargetActionId) {
          const count = (this.targetFailureCount.get(this.lastTargetActionId) || 0) + 1;
          this.targetFailureCount.set(this.lastTargetActionId, count);
        }
      } else {
        this.consecutiveNoChangeCount = 0;
        this.targetFailureCount.clear();
      }
    }
    this.lastFingerprint = currentFingerprint;

    // Detect hard deadlock (e.g. 4 consecutive actions without any page change)
    if (this.consecutiveNoChangeCount >= 4) {
      this.progress.status = 'blocked';
      this.finishWithError(
        `Agent detected deadlock: 4 consecutive actions produced no change on the page. Please inspect or adjust the goal.`
      );
      return false;
    }

    // 3. Prepare Loop Warning & Suppressed Targets
    let warning: string | undefined;
    const suppressedTargetIds: string[] = [];

    if (this.consecutiveNoChangeCount >= 1 && this.history.length > 0) {
      const lastAction = this.history[this.history.length - 1];
      warning = `ATTENTION: Previous action "${lastAction.action}" resulted in NO visible change on the page. Do NOT repeat the exact same action. Try an alternative target, scroll, or submit button.`;
    }

    for (const [targetId, failCount] of this.targetFailureCount.entries()) {
      if (failCount >= 2) {
        suppressedTargetIds.push(targetId);
      }
    }

    // 4. Formulate Jev Action Space and Questions
    let model =
      this.settings.activeProvider === 'typesafe'
        ? this.settings.typesafe.model
        : this.settings.activeProvider === 'openrouter'
        ? this.settings.openrouter.model
        : this.settings.cloudflare.model;

    if (this.settings.activeProvider === 'openrouter' && (model === 'typesafe/jev-latest' || !model)) {
      model = 'typesafe/jev-1.13';
    }

    const { request, actionSpace } = buildJevRequest(
      model,
      snapshot,
      this.progress.goal,
      this.history,
      { warning, suppressedTargetIds }
    );

    // 5. Query Jev
    const started = Date.now();
    let jevResponse;
    try {
      jevResponse = await callJevProvider(this.settings, request);
    } catch (err: any) {
      this.finishWithError(`Jev decision failed: ${err.message || String(err)}`);
      return false;
    }
    const latencyMs = Date.now() - started;

    // 6. Validate Operation Decision
    let operationAnswer;
    try {
      operationAnswer = validateChoiceAnswer(
        jevResponse.answers?.operation,
        actionSpace.operations
      );
    } catch (err: any) {
      this.finishWithError(`Invalid operation choice: ${err.message || String(err)}`);
      return false;
    }

    const operation = operationAnswer.choice;

    if (operation === 'DONE') {
      this.progress.status = 'done';
      this.addLog({
        step: this.progress.currentStep,
        timestamp: Date.now(),
        operation: 'DONE',
        confidence: operationAnswer.confidence,
        latencyMs,
        provider: this.settings.activeProvider,
        probabilities: operationAnswer.probabilities,
      });
      this.broadcastUpdate();
      return false;
    }

    if (operation === 'BLOCKED') {
      this.progress.status = 'blocked';
      this.addLog({
        step: this.progress.currentStep,
        timestamp: Date.now(),
        operation: 'BLOCKED',
        confidence: operationAnswer.confidence,
        latencyMs,
        provider: this.settings.activeProvider,
        probabilities: operationAnswer.probabilities,
      });
      this.broadcastUpdate();
      return false;
    }

    // 7. Resolve Target Element and Actions
    let targetAction: PageAction | undefined;
    let targetConfidence: number | undefined;

    if (operation in actionSpace.targets) {
      const targetHead = `${operation.toLowerCase()}_target`;
      const targetAnswer = validateChoiceAnswer(
        jevResponse.answers?.[targetHead],
        actionSpace.targets[operation]
      );
      const targetIndex = targetAnswer.choice;
      targetAction = actionSpace.targets[operation][targetIndex];
      targetConfidence = targetAnswer.confidence;
    } else if (operation in actionSpace.controls) {
      targetAction = actionSpace.controls[operation];
      targetConfidence = operationAnswer.confidence;
    }

    if (!targetAction) {
      this.finishWithError(`Could not find target action for operation: ${operation}`);
      return false;
    }

    this.lastTargetActionId = targetAction.id;

    // 8. If TYPE_TEXT, call text helper
    let generatedText: string | undefined;
    if (operation === 'TYPE_TEXT') {
      try {
        const fieldContext = createFieldContext(
          this.progress.goal,
          targetAction,
          { title: snapshot.title, text: snapshot.text },
          this.history
        );
        generatedText = await generateFieldText(this.settings, fieldContext);
      } catch (err: any) {
        this.finishWithError(`Text helper failed: ${err.message || String(err)}`);
        return false;
      }
    }

    // 9. Execute on page via Content Script
    try {
      const actResponse = await chrome.tabs.sendMessage(this.activeTabId, {
        type: 'CONTENT_ACT',
        action: targetAction,
        text: generatedText,
      });

      if (!actResponse || !actResponse.success) {
        throw new Error(actResponse?.error || 'Content action returned failure');
      }
    } catch (err: any) {
      const errMsg = err.message || String(err);
      if (
        errMsg.includes('back/forward cache') ||
        errMsg.includes('message channel is closed') ||
        errMsg.includes('Receiving end does not exist') ||
        errMsg.includes('Frame was removed')
      ) {
        await this.waitForTabToLoad(this.activeTabId);
      } else {
        this.finishWithError(`Act execution failed: ${errMsg}`);
        return false;
      }
    }

    // 10. Record action history & step log
    this.history.push({
      action: `${operation} ${targetAction.label}`,
      kind: targetAction.kind,
      text: generatedText,
      page_changed: undefined, // Will be resolved at start of next step
    });

    this.addLog({
      step: this.progress.currentStep,
      timestamp: Date.now(),
      operation,
      targetId: targetAction.id,
      targetLabel: targetAction.label,
      targetValue: generatedText,
      confidence: targetConfidence ?? operationAnswer.confidence,
      latencyMs,
      provider: this.settings.activeProvider,
      probabilities: operationAnswer.probabilities,
    });

    this.broadcastUpdate();
    return true;
  }

  private addLog(log: AgentStepLog): void {
    this.progress.logs.unshift(log);
    if (this.progress.logs.length > 50) {
      this.progress.logs.pop();
    }
  }

  private finishWithError(errMsg: string): void {
    this.progress.status = 'error';
    this.progress.lastError = errMsg;
    this.broadcastUpdate();
  }

  private broadcastUpdate(): void {
    chrome.runtime.sendMessage({
      type: 'PROGRESS_UPDATE',
      progress: this.progress,
    }).catch(() => {
      // Popup might be closed, ignore
    });
  }
}
