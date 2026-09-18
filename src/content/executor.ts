import { PageAction } from '../shared/types';

export async function executeAction(
  action: PageAction,
  text?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const kind = action.kind;

    if (kind === 'wait') {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { success: true };
    }

    if (kind === 'scroll') {
      window.scrollBy({
        top: action.delta || 0,
        behavior: 'smooth',
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      return { success: true };
    }

    const cache = window.__jevFast;
    if (!cache || action.node === undefined) {
      return { success: false, error: 'Element cache not initialized or invalid node index' };
    }

    const element = cache.nodes.get(action.node);
    if (!element || !element.isConnected) {
      return { success: false, error: 'Target element is no longer in the DOM (Stale Element)' };
    }

    // Scroll into view if needed
    element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });

    if (kind === 'select') {
      const selectEl = element as HTMLSelectElement;
      if (selectEl.tagName === 'SELECT') {
        selectEl.value = action.value || '';
        selectEl.dispatchEvent(new Event('input', { bubbles: true }));
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true };
      } else {
        return { success: false, error: 'Target element is not a <select> element' };
      }
    }

    if (kind === 'fill') {
      const inputEl = element as HTMLInputElement | HTMLTextAreaElement;
      const val = text ?? action.value ?? '';

      element.focus();

      if (element.isContentEditable) {
        element.textContent = val;
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      } else if ('value' in inputEl) {
        // Use prototype setter to bypass React 16+ setter overrides
        const prototype =
          element.tagName === 'TEXTAREA'
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

        if (descriptor?.set) {
          descriptor.set.call(element, val);
        } else {
          inputEl.value = val;
        }

        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));

        // For search boxes or form fields, dispatch Enter key events to allow instant form trigger
        const isSearchOrForm =
          inputEl.type === 'search' ||
          inputEl.name?.toLowerCase().includes('search') ||
          inputEl.name?.toLowerCase() === 'q' ||
          inputEl.placeholder?.toLowerCase().includes('search') ||
          inputEl.closest('form');

        if (isSearchOrForm) {
          element.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              bubbles: true,
            })
          );
          element.dispatchEvent(
            new KeyboardEvent('keyup', {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              bubbles: true,
            })
          );
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 80));
      return { success: true };
    }

    if (kind === 'click') {
      const htmlEl = element as HTMLElement;
      htmlEl.focus();

      // Dispatch mouse event sequence
      const rect = element.getBoundingClientRect();
      const clientX = rect.x + rect.width / 2;
      const clientY = rect.y + rect.height / 2;

      const mouseOptions: MouseEventInit = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY,
      };

      element.dispatchEvent(new PointerEvent('pointerdown', mouseOptions));
      element.dispatchEvent(new MouseEvent('mousedown', mouseOptions));
      element.dispatchEvent(new PointerEvent('pointerup', mouseOptions));
      element.dispatchEvent(new MouseEvent('mouseup', mouseOptions));
      element.dispatchEvent(new MouseEvent('click', mouseOptions));

      // Trigger native click
      if (typeof htmlEl.click === 'function') {
        htmlEl.click();
      }

      return { success: true };
    }

    return { success: false, error: `Unknown action kind: ${kind}` };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}
