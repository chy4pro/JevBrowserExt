import { AppSettings, ExtensionMessage, mergeSettings } from '../shared/types';
import { AgentRunner } from './agent';

const runner = new AgentRunner();

async function getStoredSettings(): Promise<AppSettings> {
  const result = await chrome.storage.local.get(['jev_settings']);
  return mergeSettings(result.jev_settings as Partial<AppSettings> | undefined);
}

async function saveStoredSettings(settings: AppSettings): Promise<void> {
  const merged = mergeSettings(settings);
  await chrome.storage.local.set({ jev_settings: merged });
  runner.setSettings(merged);
}

/** Always reload settings before a run: the service worker may have just woken up. */
async function refreshRunnerSettings(): Promise<AppSettings> {
  const settings = await getStoredSettings();
  runner.setSettings(settings);
  return settings;
}

refreshRunnerSettings().catch(() => undefined);

async function getActiveTabId(): Promise<number> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  if (!activeTab || activeTab.id === undefined) {
    throw new Error('No active tab found');
  }
  return activeTab.id;
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse: (response: unknown) => void) => {
    (async () => {
      try {
        switch (message.type) {
          case 'GET_SETTINGS': {
            sendResponse({ type: 'SETTINGS_RESPONSE', settings: await getStoredSettings() });
            return;
          }
          case 'SAVE_SETTINGS': {
            await saveStoredSettings(message.settings);
            sendResponse({ success: true });
            return;
          }
          case 'GET_PROGRESS': {
            sendResponse({ progress: runner.getProgress() });
            return;
          }
          case 'START_AGENT': {
            const goal = (message.goal || '').trim();
            if (!goal) throw new Error('Goal is empty');
            await refreshRunnerSettings();
            const tabId = await getActiveTabId();
            void runner.start(goal, tabId); // runs in the background; progress arrives via PROGRESS_UPDATE
            sendResponse({ success: true });
            return;
          }
          case 'STEP_AGENT': {
            const goal = (message.goal || runner.getProgress().goal || '').trim();
            if (!goal) throw new Error('Goal is empty');
            await refreshRunnerSettings();
            const tabId = await getActiveTabId();
            void runner.step(goal, tabId);
            sendResponse({ success: true });
            return;
          }
          case 'STOP_AGENT': {
            runner.stop();
            sendResponse({ success: true });
            return;
          }
          case 'TOGGLE_OVERLAY': {
            const settings = await getStoredSettings();
            await saveStoredSettings({ ...settings, showOverlay: message.show });
            const tabId = await getActiveTabId();
            await chrome.tabs.sendMessage(tabId, message).catch(() => undefined);
            sendResponse({ success: true });
            return;
          }
          default:
            return;
        }
      } catch (err: any) {
        sendResponse({ success: false, error: err?.message || String(err) });
      }
    })();
    return true; // keep sendResponse open for async work
  }
);
