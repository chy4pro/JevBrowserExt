import { PageAction, PageSnapshot } from '../shared/types';

/** Semantic state captured with the last snapshot, used to detect stale decisions. */
interface ObservedState {
  marker: unknown[];
  pageKey: unknown[];
  guards: Record<number, unknown>;
}

interface JevCache {
  ids: WeakMap<Element, number>;
  nodes: Map<number, Element>;
  next: number;
  observed?: ObservedState;
}

declare global {
  interface Window {
    __jevFast?: JevCache;
    __jevContent?: { alive: () => boolean };
  }
}

const ROLES = [
  'button',
  'link',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'menuitem',
  'menuitemradio',
  'option',
  'gridcell',
  'combobox',
  'textbox',
  'searchbox',
  'spinbutton',
];

const SELECTOR =
  'a[href],button,input,textarea,select,summary,[contenteditable="true"],' +
  ROLES.map((r) => `[role="${r}"]`).join(',');

export function getCache(): JevCache {
  return (window.__jevFast = window.__jevFast || {
    ids: new WeakMap<Element, number>(),
    nodes: new Map<number, Element>(),
    next: 1,
  });
}

function identity(cache: JevCache, e: Element): number {
  if (!cache.ids.has(e)) {
    cache.ids.set(e, cache.next++);
  }
  const id = cache.ids.get(e)!;
  cache.nodes.set(id, e);
  return id;
}

const safe = (e: Element): boolean =>
  !['password', 'file', 'hidden'].includes((e as HTMLInputElement).type || '');

export function isVisible(e: Element): boolean {
  if (e.closest('[aria-hidden="true"],[inert]')) return false;
  if (typeof (e as any).checkVisibility === 'function') {
    return (e as any).checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  }
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function accessibleName(e: Element | null, seen = new Set<Element>()): string {
  if (!e || seen.has(e)) return '';
  seen.add(e);

  const labelledby = e.getAttribute('aria-labelledby') || '';
  if (labelledby) {
    const referenced = labelledby
      .split(/\s+/)
      .map((id) => accessibleName(document.getElementById(id), seen))
      .filter(Boolean)
      .join(' ');
    if (referenced) return referenced;
  }

  const ariaLabel = e.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  const labels = (e as HTMLInputElement).labels;
  if (labels && labels.length) {
    const labelText = Array.from(labels)
      .map((l) => accessibleName(l, seen))
      .filter(Boolean)
      .join(' ');
    if (labelText) return labelText;
  }

  const inputElem = e as HTMLInputElement;
  if (['button', 'submit', 'reset'].includes(inputElem.type || '') && inputElem.value) {
    return inputElem.value;
  }

  const alt = e.getAttribute('alt');
  if (alt) return alt;

  if (e.tagName !== 'INPUT') {
    const childTexts = Array.from(e.childNodes)
      .map((n) => {
        if (n.nodeType === Node.TEXT_NODE) return n.textContent || '';
        if (n.nodeType === Node.ELEMENT_NODE && (n as Element).getAttribute('aria-hidden') !== 'true') {
          return accessibleName(n as Element, seen);
        }
        return '';
      })
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (childTexts) return childTexts;
  }

  return e.getAttribute('title') || e.getAttribute('placeholder') || '';
}

function roleOf(e: Element): string | null {
  const explicit = e.getAttribute('role');
  if (explicit && ROLES.includes(explicit)) return explicit;
  if (e.tagName === 'BUTTON' || e.tagName === 'SUMMARY') return 'button';
  if (e.tagName === 'A') return 'link';
  if (e.tagName === 'SELECT') return 'combobox';
  if (e.tagName === 'TEXTAREA' || (e as HTMLElement).isContentEditable) return 'textbox';
  if (e.tagName === 'INPUT') {
    const type = (e as HTMLInputElement).type;
    if (['checkbox', 'radio'].includes(type)) return type;
    if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
    if (type === 'search') return 'searchbox';
    if (type === 'number') return 'spinbutton';
    if (['text', 'email', 'url', 'tel'].includes(type)) return 'textbox';
  }
  return null;
}

export function isEditableField(e: Element): boolean {
  if (e.tagName === 'TEXTAREA') return !(e as HTMLTextAreaElement).readOnly;
  if (e.tagName === 'INPUT') {
    const input = e as HTMLInputElement;
    return !input.readOnly && !['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file', 'hidden', 'password', 'range', 'color'].includes(input.type);
  }
  return (e as HTMLElement).isContentEditable === true;
}

export function fieldValue(e: Element): string {
  if ('value' in e) return String((e as HTMLInputElement).value ?? '');
  return (e as HTMLElement).innerText ?? e.textContent ?? '';
}

const innerText = (e: Element | null | undefined): string => {
  if (!e) return '';
  const t = (e as HTMLElement).innerText;
  return typeof t === 'string' ? t : e.textContent || '';
};

function pageKey(cache: JevCache): unknown[] {
  return [
    performance.timeOrigin,
    location.href,
    window.scrollX,
    window.scrollY,
    window.innerWidth,
    window.innerHeight,
    Array.from(document.querySelectorAll('input,textarea,select'))
      .filter(safe)
      .map((el) => {
        const inp = el as HTMLInputElement;
        return [
          identity(cache, el),
          inp.value,
          inp.checked,
          (inp as any).selectedIndex,
          inp.disabled,
          inp.readOnly,
        ];
      }),
  ];
}

function guard(cache: JevCache, e: Element | null | undefined): unknown[] | null {
  if (!e || !e.isConnected || !isVisible(e)) return null;
  const scope = e.closest('form,dialog,[role="dialog"],article,li,tr,[role="row"]') || e.parentElement;
  const inp = e as HTMLInputElement;
  return [
    identity(cache, e),
    roleOf(e),
    accessibleName(e),
    inp.value ?? null,
    inp.checked ?? null,
    (inp as any).selectedIndex ?? null,
    inp.readOnly ?? null,
    e.matches(':disabled'),
    e.getAttribute('aria-disabled'),
    e.getAttribute('aria-expanded'),
    e.getAttribute('aria-checked'),
    e.getAttribute('aria-selected'),
    e.getAttribute('href'),
    innerText(scope).slice(0, 6000),
  ];
}

function readState(): { snapshot: PageSnapshot; observed: ObservedState } | null {
  if (!document.body) return null;
  const cache = getCache();

  for (const [id, e] of cache.nodes) {
    if (!e.isConnected) cache.nodes.delete(id);
  }

  const actions: PageAction[] = [];
  for (const e of Array.from(document.querySelectorAll(SELECTOR))) {
    const inputEl = e as HTMLInputElement;
    if (!safe(e) || !isVisible(e) || e.matches(':disabled') || e.closest('[aria-disabled="true"]')) {
      continue;
    }

    const r = e.getBoundingClientRect();
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    const rname = roleOf(e);
    if (
      !rname ||
      r.width <= 0 ||
      r.height <= 0 ||
      x < 0 ||
      y < 0 ||
      x >= window.innerWidth ||
      y >= window.innerHeight
    ) {
      continue;
    }
    if (rname === 'gridcell' && e.querySelector('button,[role="button"]')) continue;

    const base: PageAction = {
      id: '',
      node: identity(cache, e),
      role: rname,
      label: accessibleName(e) || rname,
      kind: 'click',
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
    for (const key of ['checked', 'selected', 'expanded'] as const) {
      const val = e.getAttribute(`aria-${key}`);
      if (val !== null) base[key] = val;
    }
    if (['checkbox', 'radio'].includes(inputEl.type)) {
      base.checked = String(inputEl.checked);
    }

    if (e.tagName === 'SELECT') {
      const selectEl = e as HTMLSelectElement;
      const current = Array.from(selectEl.selectedOptions)
        .map((op) => op.label)
        .join(', ');
      for (const o of Array.from(selectEl.options)) {
        if (!o.selected && !o.disabled && !o.closest('optgroup[disabled]')) {
          actions.push({
            ...base,
            kind: 'select',
            value: o.value,
            current_value: current,
            label: `${base.label} → ${o.label}`,
          });
        }
      }
    } else {
      const editable =
        !inputEl.readOnly &&
        e.getAttribute('aria-readonly') !== 'true' &&
        (['textbox', 'searchbox', 'spinbutton'].includes(rname) ||
          (rname === 'combobox' && ['INPUT', 'TEXTAREA'].includes(e.tagName)));
      const value =
        'value' in e
          ? String(inputEl.value)
          : (e as HTMLElement).isContentEditable || rname === 'combobox'
          ? innerText(e).trim()
          : '';
      actions.push({ ...base, kind: editable ? 'fill' : 'click', value });
      if (editable) {
        actions.push({ ...base, kind: 'click', value, label: `Open ${base.label}` });
      }
    }
  }

  // Visible text, in document order, capped at 6000 characters.
  const words: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let node: Node | null;
  let textLength = 0;
  while ((node = walker.nextNode()) && textLength < 6000) {
    const textVal = (node.textContent || '').trim();
    const parent = node.parentElement;
    if (!textVal || !parent || parent.closest('script,style,noscript,template') || !isVisible(parent)) {
      continue;
    }
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (
      r.width > 0 &&
      r.height > 0 &&
      r.bottom > 0 &&
      r.top < window.innerHeight &&
      r.right > 0 &&
      r.left < window.innerWidth
    ) {
      words.push(textVal);
      textLength += textVal.length;
    }
  }
  const pageText = words.join('\n').slice(0, 6000);
  const scrollHeight = document.documentElement.scrollHeight;

  const key = pageKey(cache);
  const guards: Record<number, unknown> = {};
  for (const a of actions) {
    if (a.node !== undefined && !(a.node in guards)) {
      guards[a.node] = guard(cache, cache.nodes.get(a.node));
    }
  }

  const semantics = actions.map(({ rect, ...a }) => a);
  const marker = [
    performance.timeOrigin,
    location.href,
    window.scrollX,
    window.scrollY,
    window.innerWidth,
    window.innerHeight,
    document.title,
    pageText,
    semantics,
    key[6],
  ];

  const omitted_actions = Math.max(0, actions.length - 250);
  actions.splice(250);
  actions.forEach((a, i) => {
    a.id = `e${i + 1}`;
  });

  if (window.scrollY + window.innerHeight < scrollHeight - 2) {
    actions.push({ id: 'scroll_down', kind: 'scroll', label: 'Scroll down', delta: 560 });
  }
  if (window.scrollY > 0) {
    actions.push({ id: 'scroll_up', kind: 'scroll', label: 'Scroll up', delta: -560 });
  }
  const focused = document.activeElement as HTMLElement | null;
  if (focused && isEditableField(focused) && fieldValue(focused).trim()) {
    actions.push({
      id: 'press_enter',
      kind: 'key',
      node: identity(cache, focused),
      label: `Press Enter in the focused field "${accessibleName(focused) || 'text field'}" to submit it`,
    });
  }
  actions.push({ id: 'wait', kind: 'wait', label: 'Wait for the page to update' });

  return {
    snapshot: {
      url: location.href,
      title: document.title,
      w: window.innerWidth,
      h: window.innerHeight,
      text: pageText,
      scroll: { y: window.scrollY, height: scrollHeight },
      actions,
      omitted_actions,
    },
    observed: { marker, pageKey: key, guards },
  };
}

/** Observes the page and remembers its semantic state for later freshness checks. */
export function takeSnapshot(): PageSnapshot | null {
  const state = readState();
  if (!state) return null;
  getCache().observed = state.observed;
  return state.snapshot;
}

/**
 * True when the page still matches the snapshot this action was chosen from.
 * Click/select compare the target and its nearby form/dialog/row context; everything else
 * compares the full semantic marker.
 */
export function isFresh(action: PageAction): boolean {
  const cache = getCache();
  const observed = cache.observed;
  if (!observed) return false;

  if (action.kind === 'click' || action.kind === 'select') {
    if (typeof action.node !== 'number') return false;
    const current = [pageKey(cache), guard(cache, cache.nodes.get(action.node))];
    const expected = [observed.pageKey, observed.guards[action.node] ?? null];
    return JSON.stringify(current) === JSON.stringify(expected);
  }

  const state = readState();
  if (!state) return false;
  return JSON.stringify(state.observed.marker) === JSON.stringify(observed.marker);
}
