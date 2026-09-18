import { PageAction } from '../shared/types';

let overlayContainer: HTMLElement | null = null;
let statusBanner: HTMLElement | null = null;

export function initOverlay(): void {
  if (overlayContainer) return;

  overlayContainer = document.createElement('div');
  overlayContainer.id = '__jev_overlay_container';
  overlayContainer.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    z-index: 2147483640;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `;
  document.documentElement.appendChild(overlayContainer);
}

export function renderElementBadges(actions: PageAction[], visible: boolean): void {
  initOverlay();
  if (!overlayContainer) return;

  // Clear previous badges except status banner
  const oldBadges = overlayContainer.querySelectorAll('.__jev_badge');
  oldBadges.forEach((b) => b.remove());

  if (!visible) return;

  const cache = window.__jevFast;
  if (!cache) return;

  const nodeActionMap = new Map<number, PageAction>();
  for (const a of actions) {
    if (a.node !== undefined && !nodeActionMap.has(a.node)) {
      nodeActionMap.set(a.node, a);
    }
  }

  let index = 1;
  for (const [nodeId, action] of nodeActionMap.entries()) {
    const el = cache.nodes.get(nodeId);
    if (!el || !el.isConnected) continue;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const badge = document.createElement('div');
    badge.className = '__jev_badge';
    badge.textContent = `${index++}`;
    badge.style.cssText = `
      position: absolute;
      top: ${Math.max(0, rect.top + window.scrollY - 2)}px;
      left: ${Math.max(0, rect.left + window.scrollX - 2)}px;
      background: #4f46e5;
      color: #ffffff;
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
      padding: 2px 4px;
      border-radius: 4px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      pointer-events: none;
      z-index: 2147483641;
      border: 1px solid #818cf8;
      transform: translate(0, -50%);
    `;
    overlayContainer.appendChild(badge);
  }
}

export function highlightTarget(action: PageAction): void {
  initOverlay();
  if (!overlayContainer || action.node === undefined) return;

  const cache = window.__jevFast;
  if (!cache) return;

  const el = cache.nodes.get(action.node);
  if (!el) return;

  const rect = el.getBoundingClientRect();
  const highlight = document.createElement('div');
  highlight.className = '__jev_highlight';
  highlight.style.cssText = `
    position: absolute;
    top: ${rect.top + window.scrollY}px;
    left: ${rect.left + window.scrollX}px;
    width: ${rect.width}px;
    height: ${rect.height}px;
    border: 2px solid #10b981;
    background: rgba(16, 185, 129, 0.2);
    border-radius: 4px;
    pointer-events: none;
    z-index: 2147483642;
    transition: all 0.3s ease;
  `;
  overlayContainer.appendChild(highlight);

  setTimeout(() => {
    highlight.style.opacity = '0';
    setTimeout(() => highlight.remove(), 300);
  }, 600);
}

export function showStatusBanner(text: string, latencyMs?: number): void {
  initOverlay();
  if (!overlayContainer) return;

  if (!statusBanner) {
    statusBanner = document.createElement('div');
    statusBanner.id = '__jev_status_banner';
    statusBanner.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(15, 23, 42, 0.95);
      backdrop-filter: blur(8px);
      color: #f8fafc;
      padding: 8px 16px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 500;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1);
      display: flex;
      align-items: center;
      gap: 10px;
      z-index: 2147483645;
      pointer-events: auto;
      transition: all 0.2s ease;
    `;
    overlayContainer.appendChild(statusBanner);
  }

  const badgeColor = latencyMs ? '#10b981' : '#6366f1';
  statusBanner.innerHTML = `
    <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${badgeColor}; box-shadow:0 0 8px ${badgeColor};"></span>
    <span>⚡ <strong>Jev Agent</strong>: ${text}</span>
    ${latencyMs !== undefined ? `<span style="background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px; font-size:11px; font-mono:monospace;">${latencyMs}ms</span>` : ''}
  `;
}

export function removeStatusBanner(): void {
  if (statusBanner) {
    statusBanner.remove();
    statusBanner = null;
  }
}
