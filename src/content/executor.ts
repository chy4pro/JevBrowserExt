import { ActResult, PageAction } from '../shared/types';
import { getCache, isFresh, isVisible } from './snapshot';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function stale(error: string): ActResult {
  return { success: false, stale: true, error };
}

/**
 * Waits for the page to react to an interaction: up to two animation frames or 50 ms.
 * An editable ARIA combobox instead waits for visible options, capped at 200 ms, so the
 * next observation includes autocomplete suggestions instead of paying for an early decision.
 */
export function settleAfter(action: PageAction): Promise<void> {
  return new Promise<void>((resolve) => {
    const field = action.node !== undefined ? getCache().nodes.get(action.node) : undefined;
    const autocomplete = action.kind === 'fill' && field?.getAttribute('role') === 'combobox';
    let frames = 0;
    let stopped = false;
    const finish = () => {
      if (!stopped) {
        stopped = true;
        resolve();
      }
    };
    setTimeout(finish, autocomplete ? 200 : 50);
    if (typeof requestAnimationFrame !== 'function') return;

    const optionVisible = () => {
      const ids = (field?.getAttribute('aria-controls') || field?.getAttribute('aria-owns') || '')
        .split(/\s+/)
        .filter(Boolean);
      const roots: ParentNode[] = ids.length
        ? ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => !!el)
        : [document];
      return roots
        .flatMap((root) => Array.from(root.querySelectorAll('[role="option"]')))
        .some((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && isVisible(e);
        });
    };

    const ready = () => {
      if (stopped) return;
      if (++frames >= 2 && (!autocomplete || optionVisible())) finish();
      else requestAnimationFrame(ready);
    };
    requestAnimationFrame(ready);
  });
}

function dispatchPointerSequence(el: Element, x: number, y: number): void {
  const init: MouseEventInit = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
  const pointer = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  el.dispatchEvent(new pointer('pointerdown', { ...init, pointerId: 1, isPrimary: true } as PointerEventInit));
  el.dispatchEvent(new MouseEvent('mousedown', init));
  el.dispatchEvent(new pointer('pointerup', { ...init, pointerId: 1, isPrimary: true } as PointerEventInit));
  el.dispatchEvent(new MouseEvent('mouseup', init));
}

/**
 * True when the covering element and the target live in the same small component, such as
 * a hover layer over a product card. Dialogs and page-wide overlays never qualify, so a
 * modal still blocks clicks on what lies beneath it.
 */
function sameComponent(element: Element, hit: Element): boolean {
  if (hit.closest('dialog,[role="dialog"],[aria-modal="true"]')) return false;
  let ancestor: Element | null = element.parentElement;
  while (ancestor && !ancestor.contains(hit)) ancestor = ancestor.parentElement;
  if (!ancestor || ancestor === document.body || ancestor === document.documentElement) return false;
  if (['MAIN', 'HEADER', 'NAV', 'FOOTER', 'SECTION'].includes(ancestor.tagName)) return false;
  const r = ancestor.getBoundingClientRect();
  return r.height < window.innerHeight * 0.6 && r.width < window.innerWidth * 0.9;
}

function clickableAt(element: HTMLElement, hit: Element | null): HTMLElement {
  let node: Element | null = hit;
  while (node && node !== element && element.contains(node)) {
    if (node instanceof HTMLElement && typeof node.click === 'function') return node;
    node = node.parentElement;
  }
  return element;
}

/**
 * Presses Enter in a text field the way a user would: key events for scripts that listen for
 * them, then the field's own form is submitted unless a handler cancelled the key.
 */
function pressEnter(field: HTMLElement): void {
  field.focus();
  const init: KeyboardEventInit = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
  const down = field.dispatchEvent(new KeyboardEvent('keydown', init));
  const press = field.dispatchEvent(new KeyboardEvent('keypress', init));
  field.dispatchEvent(new KeyboardEvent('keyup', init));
  const form = (field as HTMLInputElement).form;
  if (down && press && form) {
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.submit();
  }
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  // Use the prototype setter so React-style value trackers notice the change.
  const prototype = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (descriptor?.set) {
    descriptor.set.call(el, value);
  } else {
    el.value = value;
  }
}

/**
 * Executes one observed action. Nothing is retried here, and nothing runs when the page no
 * longer matches the snapshot the decision came from (`stale: true`).
 */
export async function executeAction(action: PageAction, text?: string): Promise<ActResult> {
  try {
    if (!isFresh(action)) {
      return stale('Page changed since this decision. Observe again.');
    }

    if (action.kind === 'wait') {
      await sleep(100);
      return { success: true };
    }

    if (action.kind === 'scroll') {
      window.scrollBy({ top: action.delta || 0, behavior: 'instant' as ScrollBehavior });
      await settleAfter(action);
      return { success: true };
    }

    if (typeof action.node !== 'number') {
      return { success: false, error: 'Invalid observed node' };
    }
    const element = getCache().nodes.get(action.node) as HTMLElement | undefined;
    if (!element || !element.isConnected) {
      return stale('Target element is no longer in the DOM. Observe again.');
    }
    if (
      element.matches(':disabled') ||
      element.closest('[aria-disabled="true"],[inert]') ||
      !isVisible(element)
    ) {
      return stale('Target is disabled or hidden. Observe again.');
    }
    if (action.kind === 'fill') {
      const inp = element as HTMLInputElement;
      if (inp.readOnly || element.getAttribute('aria-readonly') === 'true') {
        return stale('Target field became read-only. Observe again.');
      }
    }

    const r = element.getBoundingClientRect();
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    if (!r.width || !r.height || x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) {
      return stale('Target moved out of the viewport. Observe again.');
    }
    const hit = document.elementFromPoint(x, y);
    if (hit && !element.contains(hit) && !hit.contains(element) && !sameComponent(element, hit)) {
      return stale('Target is covered by another element. Observe again.');
    }

    if (action.kind === 'select') {
      const selectEl = element as unknown as HTMLSelectElement;
      if (selectEl.tagName !== 'SELECT') {
        return { success: false, error: 'Target element is not a <select> element' };
      }
      const option = Array.from(selectEl.options).find(
        (o) => o.value === action.value && !o.disabled && !o.closest('optgroup[disabled]')
      );
      if (!option) {
        return { success: false, error: 'Dropdown option is no longer available; inspect before retrying.' };
      }
      selectEl.value = option.value;
      selectEl.dispatchEvent(new Event('input', { bubbles: true }));
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      await settleAfter(action);
      return { success: true };
    }

    if (action.kind === 'fill') {
      const value = text ?? '';
      dispatchPointerSequence(element, x, y);
      element.focus();

      if (element.isContentEditable) {
        const selection = window.getSelection();
        if (selection) {
          selection.selectAllChildren(element);
          selection.deleteFromDocument();
        }
        element.textContent = value;
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      } else {
        const inp = element as unknown as HTMLInputElement | HTMLTextAreaElement;
        setNativeValue(inp, value);
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
      // No synthetic Enter: submitting or picking a suggestion is the model's next decision.
      await settleAfter(action);
      return { success: true };
    }

    if (action.kind === 'click') {
      // A real pointer lands on the innermost element at the point, e.g. the <a> inside an
      // option row; dispatching on that element lets its activation behavior run. SVG icons
      // have no click(), so walk up to the nearest HTML element inside the target.
      const clickTarget = hit && element.contains(hit) ? clickableAt(element, hit) : element;
      dispatchPointerSequence(clickTarget, x, y);
      element.focus();
      // One click only. click() runs the activation behavior (toggle, navigate, submit).
      clickTarget.click();
      await settleAfter(action);
      return { success: true };
    }

    if (action.kind === 'key') {
      pressEnter(element);
      await settleAfter(action);
      return { success: true };
    }

    return { success: false, error: `Unknown action kind: ${String(action.kind)}` };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}
