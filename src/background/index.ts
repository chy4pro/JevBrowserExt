import { AppSettings, DEFAULT_SETTINGS, ExtensionMessage } from '../shared/types';
import { AgentRunner } from './agent';

const runner = new AgentRunner();

async function getStoredSettings(): Promise<AppSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['jev_settings'], (result) => {
      let settings: AppSettings = DEFAULT_SETTINGS;
      if (result.jev_settings) {
        settings = { ...DEFAULT_SETTINGS, ...result.jev_settings };

        // Auto-migrate cached obsolete openrouter model
        if (settings.openrouter?.model === 'typesafe/jev-latest') {
          settings.openrouter.model = 'typesafe/jev-1.13';
        }
        if (!settings.openrouter?.apiKey) {
          settings.openrouter.apiKey = DEFAULT_SETTINGS.openrouter.apiKey;
        }

        // Auto-migrate obsolete text helper models (404 models or ambiguous slugs)
        if (
          settings.textHelper?.model === 'deepseek-chat' ||
          settings.textHelper?.model?.includes('1.5-8b') ||
          settings.textHelper?.model?.includes('2.0-flash') ||
          !settings.textHelper?.model
        ) {
          settings.textHelper.model = 'deepseek/deepseek-chat';
        }
      }
      resolve(settings);
    });
  });
}

async function saveStoredSettings(settings: AppSettings): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ jev_settings: settings }, () => {
      runner.setSettings(settings);
      resolve();
    });
  });
}

// Initialize settings on start
getStoredSettings().then((settings) => {
  runner.setSettings(settings);
});

async function getActiveTabId(): Promise<number> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  if (!activeTab || activeTab.id === undefined) {
    throw new Error('No active tab found');
  }
  return activeTab.id;
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'GET_SETTINGS') {
        const settings = await getStoredSettings();
        sendResponse({ type: 'SETTINGS_RESPONSE', settings });
        return;
      }

      if (message.type === 'SAVE_SETTINGS') {
        await saveStoredSettings(message.settings);
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'GET_PROGRESS') {
        sendResponse({ progress: runner.getProgress() });
        return;
      }

      if (message.type === 'START_AGENT') {
        const tabId = await getActiveTabId();
        // Do not await runner.start() here to avoid blocking response
        runner.start(message.goal, tabId);
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'STEP_AGENT') {
        const tabId = await getActiveTabId();
        runner.step(runner.getProgress().goal, tabId);
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'STOP_AGENT') {
        runner.stop();
        sendResponse({ success: true });
        return;
      }

      if (message.type === 'TOGGLE_OVERLAY') {
        const tabId = await getActiveTabId();
        await chrome.tabs.sendMessage(tabId, message);
        sendResponse({ success: true });
        return;
      }
    } catch (err: any) {
      sendResponse({ success: false, error: err.message || String(err) });
    }
  })();

  return true; // Keep sendResponse open for async
});
