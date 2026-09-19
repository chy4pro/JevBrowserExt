import { ActResult, ExtensionMessage } from '../shared/types';
import { executeAction } from './executor';
import {
  clearBadges,
  highlightTarget,
  removeStatusBanner,
  renderElementBadges,
  showStatusBanner,
} from './overlay';
import { takeSnapshot } from './snapshot';

/**
 * The manifest injects this script at document_idle and the background may inject it
 * earlier on demand. Both land in the same isolated world, so a window flag guarantees a
 * single listener: two listeners would execute every action twice.
 */
if (!window.__jevContentLoaded) {
  window.__jevContentLoaded = true;
  boot();
}

function boot(): void {
  let showOverlay = true;

  try {
    chrome.storage.local.get(['jev_settings'], (result) => {
      const stored = result?.jev_settings as { showOverlay?: unknown } | undefined;
      if (stored && typeof stored.showOverlay === 'boolean') {
        showOverlay = stored.showOverlay;
      }
    });
  } catch {
    // storage unavailable in this context; keep the default
  }

  chrome.runtime.onMessage.addListener(
    (message: ExtensionMessage, _sender, sendResponse: (response: unknown) => void) => {
      switch (message.type) {
        case 'PING': {
          sendResponse({ pong: true });
          return false;
        }

        case 'CONTENT_OBSERVE': {
          try {
            const snapshot = takeSnapshot();
            if (!snapshot) {
              sendResponse({ success: false, error: 'Document body is not ready' });
              return false;
            }
            renderElementBadges(snapshot.actions, showOverlay);
            sendResponse({ success: true, snapshot });
          } catch (err: any) {
            sendResponse({ success: false, error: err?.message || String(err) });
          }
          return false;
        }

        case 'CONTENT_ACT': {
          if (showOverlay) highlightTarget(message.action);
          // Badges describe the previous observation; drop them before the page changes.
          clearBadges();
          executeAction(message.action, message.text)
            .then((res: ActResult) => sendResponse(res))
            .catch((err) => sendResponse({ success: false, error: err?.message || String(err) }));
          return true; // async sendResponse
        }

        case 'CONTENT_STATUS': {
          if (message.clear || !showOverlay) {
            removeStatusBanner();
          } else if (message.text) {
            showStatusBanner(message.text, message.latencyMs);
          }
          sendResponse({ success: true });
          return false;
        }

        case 'TOGGLE_OVERLAY': {
          showOverlay = message.show;
          if (showOverlay) {
            const snapshot = takeSnapshot();
            if (snapshot) renderElementBadges(snapshot.actions, true);
          } else {
            clearBadges();
            removeStatusBanner();
          }
          sendResponse({ success: true });
          return false;
        }

        default:
          return false;
      }
    }
  );
}
