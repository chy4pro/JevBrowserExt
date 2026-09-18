import { PageAction, PageSnapshot } from '../shared/types';

interface JevCache {
  ids: WeakMap<Element, number>;
  nodes: Map<number, Element>;
  next: number;
  pageKey: () => any[];
  guard: (e: Element | null | undefined) => any[] | null;
}

declare global {
  interface Window {
    __jevFast?: JevCache;
  }
}

export function takeSnapshot(): PageSnapshot | null {
  if (!document.body) return null;

  const cache: JevCache = (window.__jevFast = window.__jevFast || {
    ids: new WeakMap<Element, number>(),
    nodes: new Map<number, Element>(),
    next: 1,
    pageKey: () => [],
    guard: () => null,
  });

  const identity = (e: Element): number => {
    if (!cache.ids.has(e)) {
      cache.ids.set(e, cache.next++);
    }
    const id = cache.ids.get(e)!;
    cache.nodes.set(id, e);
    return id;
  };

  for (const [id, e] of cache.nodes) {
    if (!e.isConnected) cache.nodes.delete(id);
  }

  const safe = (e: HTMLInputElement): boolean =>
    !['password', 'file', 'hidden'].includes(e.type || '');

  const visible = (e: Element): boolean => {
    if (e.closest('[aria-hidden="true"],[inert]')) return false;
    if ('checkVisibility' in e && typeof e.checkVisibility === 'function') {
      return (e as any).checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
      });
    }
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const name = (e: Element | null, seen = new Set<Element>()): string => {
    if (!e || seen.has(e)) return '';
    seen.add(e);

    const labelledby = e.getAttribute('aria-labelledby') || '';
    if (labelledby) {
      const referenced = labelledby
        .split(/\s+/)
        .map((id) => name(document.getElementById(id), seen))
        .filter(Boolean)
        .join(' ');
      if (referenced) return referenced;
    }

    const ariaLabel = e.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    if ('labels' in e && (e as any).labels) {
      const labelText = Array.from((e as any).labels as NodeListOf<HTMLLabelElement>)
        .map((l) => name(l, seen))
        .filter(Boolean)
        .join(' ');
      if (labelText) return labelText;
    }

    const inputElem = e as HTMLInputElement;
    if (['button', 'submit', 'reset'].includes(inputElem.type || '')) {
      if (inputElem.value) return inputElem.value;
    }

    const alt = e.getAttribute('alt');
    if (alt) return alt;

    if (e.tagName !== 'INPUT') {
      const childTexts = Array.from(e.childNodes)
        .map((n) => {
          if (n.nodeType === 3) return n.textContent || '';
          if (n.nodeType === 1 && (n as Element).getAttribute('aria-hidden') !== 'true') {
            return name(n as Element, seen);
          }
          return '';
        })
        .join(' ')
        .trim();
      if (childTexts) return childTexts;
    }

    return e.getAttribute('title') || e.getAttribute('placeholder') || '';
  };

  const roles = [
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

  const selector =
    'a[href],button,input,textarea,select,summary,[contenteditable="true"],' +
    roles.map((r) => `[role="${r}"]`).join(',');

  const role = (e: Element): string | null => {
    const explicit = e.getAttribute('role');
    if (explicit && roles.includes(explicit)) return explicit;
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
  };

  cache.pageKey = () => [
    performance.timeOrigin,
    location.href,
    window.scrollX,
    window.scrollY,
    window.innerWidth,
    window.innerHeight,
    Array.from(document.querySelectorAll('input,textarea,select'))
      .filter((el) => safe(el as HTMLInputElement))
      .map((el) => {
        const inp = el as HTMLInputElement;
        return [
          identity(el),
          inp.value,
          inp.checked,
          (inp as any).selectedIndex,
          inp.disabled,
          inp.readOnly,
        ];
      }),
  ];

  cache.guard = (e: Element | null | undefined) => {
    if (!e || !e.isConnected || !visible(e)) return null;
    const scope =
      e.closest('form,dialog,[role="dialog"],article,li,tr,[role="row"]') || e.parentElement;
    const inp = e as HTMLInputElement;
    return [
      identity(e),
      role(e),
      name(e),
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
      (scope as HTMLElement)?.innerText?.slice(0, 6000) || '',
    ];
  };

  const actions: PageAction[] = [];
  const elements = Array.from(document.querySelectorAll(selector));

  for (const e of elements) {
    const inputEl = e as HTMLInputElement;
    if (!safe(inputEl) || !visible(e) || e.matches(':disabled') || e.closest('[aria-disabled="true"]')) {
      continue;
    }

    const r = e.getBoundingClientRect();
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    const rname = role(e);

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
      node: identity(e),
      role: rname,
      label: name(e) || rname,
      kind: 'click',
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };

    for (const key of ['checked', 'selected', 'expanded'] as const) {
      const val = e.getAttribute(`aria-${key}`);
      if (val !== null) (base as any)[key] = val;
    }

    if (['checkbox', 'radio'].includes(inputEl.type)) {
      base.checked = String(inputEl.checked);
    }

    if (e.tagName === 'SELECT') {
      const selectEl = e as HTMLSelectElement;
      for (const o of Array.from(selectEl.options)) {
        if (!o.selected && !o.disabled && !o.closest('optgroup[disabled]')) {
          actions.push({
            ...base,
            kind: 'select',
            value: o.value,
            current_value: Array.from(selectEl.selectedOptions)
              .map((op) => op.label)
              .join(', '),
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
          ? (e as HTMLElement).innerText.trim()
          : '';

      actions.push({ ...base, kind: editable ? 'fill' : 'click', value });
      if (editable) {
        actions.push({ ...base, kind: 'click', value, label: `Open ${base.label}` });
      }
    }
  }

  // Extract visible text
  const words: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let node: Node | null;
  let textLength = 0;

  while ((node = walker.nextNode()) && textLength < 6000) {
    const textVal = (node.textContent || '').trim();
    const parent = node.parentElement;
    if (
      !textVal ||
      !parent ||
      parent.closest('script,style,noscript,template') ||
      !visible(parent)
    ) {
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
  const page_key = cache.pageKey();
  const guards: Record<string, any> = {};

  for (const a of actions) {
    if (a.node !== undefined && !(a.node in guards)) {
      guards[a.node] = cache.guard(cache.nodes.get(a.node));
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
    page_key[6],
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
  actions.push({ id: 'wait', kind: 'wait', label: 'Wait for the page to update' });

  return {
    url: location.href,
    title: document.title,
    w: window.innerWidth,
    h: window.innerHeight,
    text: pageText,
    scroll: { y: window.scrollY, height: scrollHeight },
    actions,
    marker,
    page_key,
    guards,
    omitted_actions,
  };
}
