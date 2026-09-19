import { PageAction } from '../shared/types';
import { getCache } from './snapshot';

let overlayContainer: HTMLElement | null = null;
let statusBanner: HTMLElement | null = null;

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

export function initOverlay(): HTMLElement {
  if (overlayContainer && overlayContainer.isConnected) return overlayContainer;

  overlayContainer = document.createElement('div');
  overlayContainer.id = '__jev_overlay_container';
  overlayContainer.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    pointer-events: none; z-index: 2147483640; font-family: ${FONT};
  `;
  document.documentElement.appendChild(overlayContainer);
  return overlayContainer;
}

export function clearBadges(): void {
  overlayContainer?.querySelectorAll('.__jev_badge').forEach((b) => b.remove());
}

/**
 * Draws [1], [2], ... badges using viewport coordinates. The container is fixed, so
 * badges must not add the scroll offset.
 */
export function renderElementBadges(actions: PageAction[], visible: boolean): void {
  const container = initOverlay();
  clearBadges();
  if (!visible) return;

  const cache = getCache();
  const seen = new Set<number>();
  let index = 0;
  for (const a of actions) {
    if (a.node === undefined || seen.has(a.node)) continue;
    seen.add(a.node);
    index++;

    const el = cache.nodes.get(a.node);
    if (!el || !el.isConnected) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const badge = document.createElement('div');
    badge.className = '__jev_badge';
    badge.textContent = String(index);
    badge.style.cssText = `
      position: absolute;
      top: ${Math.max(0, rect.top - 2)}px;
      left: ${Math.max(0, rect.left - 2)}px;
      background: #4f46e5; color: #ffffff; font-size: 11px; font-weight: 700; line-height: 1;
      padding: 2px 4px; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      pointer-events: none; z-index: 2147483641; border: 1px solid #818cf8;
      transform: translate(0, -50%);
    `;
    container.appendChild(badge);
  }
}

export function highlightTarget(action: PageAction): void {
  const container = initOverlay();
  if (action.node === undefined) return;
  const el = getCache().nodes.get(action.node);
  if (!el) return;

  const rect = el.getBoundingClientRect();
  const highlight = document.createElement('div');
  highlight.className = '__jev_highlight';
  highlight.style.cssText = `
    position: absolute; top: ${rect.top}px; left: ${rect.left}px;
    width: ${rect.width}px; height: ${rect.height}px;
    border: 2px solid #10b981; background: rgba(16, 185, 129, 0.2); border-radius: 4px;
    pointer-events: none; z-index: 2147483642; transition: opacity 0.3s ease;
  `;
  container.appendChild(highlight);
  setTimeout(() => {
    highlight.style.opacity = '0';
    setTimeout(() => highlight.remove(), 300);
  }, 600);
}

/** Floating HUD at the bottom of the page. Text is inserted as text, never as HTML. */
export function showStatusBanner(text: string, latencyMs?: number): void {
  const container = initOverlay();

  if (!statusBanner || !statusBanner.isConnected) {
    statusBanner = document.createElement('div');
    statusBanner.id = '__jev_status_banner';
    statusBanner.style.cssText = `
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(8px); color: #f8fafc;
      padding: 8px 16px; border-radius: 9999px; font-size: 13px; font-weight: 500;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1);
      display: flex; align-items: center; gap: 10px; z-index: 2147483645;
      pointer-events: none; max-width: 80vw; white-space: nowrap; overflow: hidden;
    `;
    container.appendChild(statusBanner);
  }

  statusBanner.replaceChildren();

  const dot = document.createElement('span');
  const color = latencyMs !== undefined ? '#10b981' : '#6366f1';
  dot.style.cssText = `display:inline-block; width:8px; height:8px; border-radius:50%; background:${color}; box-shadow:0 0 8px ${color}; flex-shrink:0;`;
  statusBanner.appendChild(dot);

  const label = document.createElement('span');
  label.style.cssText = 'overflow:hidden; text-overflow:ellipsis;';
  const strong = document.createElement('strong');
  strong.textContent = '⚡ Jev Agent';
  label.appendChild(strong);
  label.appendChild(document.createTextNode(`: ${text}`));
  statusBanner.appendChild(label);

  if (latencyMs !== undefined) {
    const chip = document.createElement('span');
    chip.style.cssText =
      'background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px; font-size:11px; font-family:monospace; flex-shrink:0;';
    chip.textContent = `${latencyMs}ms`;
    statusBanner.appendChild(chip);
  }
}

export function removeStatusBanner(): void {
  statusBanner?.remove();
  statusBanner = null;
}
