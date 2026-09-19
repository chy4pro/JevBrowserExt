// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function fakeChrome(id: string | undefined) {
  const addListener = vi.fn();
  vi.stubGlobal('chrome', {
    runtime: { id, onMessage: { addListener } },
    storage: { local: { get: vi.fn((_k: unknown, cb: (r: unknown) => void) => cb({})) } },
  });
  return addListener;
}

describe('content script boot guard', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (window as any).__jevContent;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('registers one listener on first load and publishes a liveness marker', async () => {
    const addListener = fakeChrome('ext-1');
    await import('../src/content/index');
    expect(addListener).toHaveBeenCalledTimes(1);
    expect((window as any).__jevContent.alive()).toBe(true);
  });

  it('does not register a second listener when a live instance already exists', async () => {
    const addListener = fakeChrome('ext-1');
    (window as any).__jevContent = { alive: () => true };
    await import('../src/content/index');
    expect(addListener).not.toHaveBeenCalled();
  });

  it('boots again when the previous instance belongs to a reloaded (dead) extension', async () => {
    const addListener = fakeChrome('ext-2');
    // Marker left by the old instance: its chrome.runtime.id is gone after the reload.
    (window as any).__jevContent = { alive: () => false };
    await import('../src/content/index');
    expect(addListener).toHaveBeenCalledTimes(1);
    expect((window as any).__jevContent.alive()).toBe(true);
  });
});
