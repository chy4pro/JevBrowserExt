import { ExtensionMessage } from '../shared/types';
import { executeAction } from './executor';
import { highlightTarget, removeStatusBanner, renderElementBadges, showStatusBanner } from './overlay';
import { takeSnapshot } from './snapshot';

let showOverlay = true;

chrome.runtime.onMessage.addListener((message: any, _sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ pong: true });
    return true;
  }

  if (message.type === 'CONTENT_OBSERVE') {
    try {
      const snapshot = takeSnapshot();
      if (!snapshot) {
        sendResponse({ success: false, error: 'Document body is not ready' });
        return true;
      }
      renderElementBadges(snapshot.actions, showOverlay);
      sendResponse({ success: true, snapshot });
    } catch (err: any) {
      sendResponse({ success: false, error: err.message || String(err) });
    }
    return true;
  }

  if (message.type === 'CONTENT_ACT') {
    const { action, text } = message;
    highlightTarget(action);

    executeAction(action, text)
      .then((res) => {
        sendResponse(res);
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message || String(err) });
      });

    return true;
  }

  if (message.type === 'TOGGLE_OVERLAY') {
    showOverlay = message.show;
    const snapshot = takeSnapshot();
    if (snapshot) {
      renderElementBadges(snapshot.actions, showOverlay);
    }
    if (!showOverlay) {
      removeStatusBanner();
    }
    sendResponse({ success: true });
    return true;
  }

  return false;
});
