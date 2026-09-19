// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { executeAction } from '../src/content/executor';
import { takeSnapshot } from '../src/content/snapshot';
import { PageAction } from '../src/shared/types';

/** jsdom has no layout: give every element a real-looking rect and treat it as visible. */
function fakeLayout(): void {
  let n = 0;
  const rects = new WeakMap<Element, DOMRect>();
  Element.prototype.getBoundingClientRect = function () {
    if (!rects.has(this)) {
      const top = 10 + (n++ % 30) * 24;
      rects.set(this, { x: 10, y: top, top, left: 10, width: 200, height: 20, right: 210, bottom: top + 20, toJSON() {} } as DOMRect);
    }
    return rects.get(this)!;
  };
  (Element.prototype as any).checkVisibility = () => true;
  Range.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, width: 100, height: 10, right: 100, bottom: 10, toJSON() {} } as DOMRect);
  (document as any).elementFromPoint = () => null;
}

function actionFor(actions: PageAction[], predicate: (a: PageAction) => boolean): PageAction {
  const a = actions.find(predicate);
  if (!a) throw new Error('action not found');
  return a;
}

describe('snapshot classification', () => {
  beforeEach(() => {
    delete (window as any).__jevFast;
    fakeLayout();
  });

  it('marks editable fields as fill + open, checkboxes as click only, and hides unsafe/disabled inputs', () => {
    document.body.innerHTML = `
      <form>
        <label>Name <input id="name" type="text" value="Ada"></label>
        <label><input id="agree" type="checkbox"> Agree</label>
        <input type="password" value="secret">
        <button disabled>Disabled</button>
        <button id="go">Go</button>
        <select id="trip" aria-label="Trip"><option value="rt" selected>Round</option><option value="ow">One way</option></select>
      </form>`;
    const snapshot = takeSnapshot()!;
    const kinds = snapshot.actions.map((a) => `${a.kind}:${a.label}`);

    expect(kinds).toContain('fill:Name');
    expect(kinds).toContain('click:Open Name');
    expect(kinds).toContain('click:Agree');
    expect(kinds).not.toContain('fill:Agree');
    expect(kinds).toContain('click:Go');
    expect(kinds).not.toContain('click:Disabled');
    expect(kinds).toContain('select:Trip → One way');
    expect(kinds).not.toContain('select:Trip → Round');
    expect(snapshot.actions.filter((a) => a.role === 'textbox' && a.value === 'secret')).toHaveLength(0);
    expect(snapshot.actions.at(-1)).toMatchObject({ id: 'wait', kind: 'wait' });
    expect(snapshot.actions.find((a) => a.id === 'scroll_up')).toBeUndefined();
    expect(actionFor(snapshot.actions, (a) => a.label === 'Agree').checked).toBe('false');
    expect(actionFor(snapshot.actions, (a) => a.label === 'Name').value).toBe('Ada');
  });
});

describe('executeAction', () => {
  beforeEach(() => {
    delete (window as any).__jevFast;
    fakeLayout();
  });

  it('clicks exactly once, so a checkbox toggles instead of bouncing back', async () => {
    document.body.innerHTML = '<label><input id="c" type="checkbox"> Agree</label>';
    const checkbox = document.getElementById('c') as HTMLInputElement;
    let clicks = 0;
    checkbox.addEventListener('click', () => clicks++);

    const snapshot = takeSnapshot()!;
    const res = await executeAction(actionFor(snapshot.actions, (a) => a.label === 'Agree'));

    expect(res).toEqual({ success: true });
    expect(clicks).toBe(1);
    expect(checkbox.checked).toBe(true);
  });

  it('fills a form field without pressing Enter', async () => {
    document.body.innerHTML = '<form><input id="first" name="first_name" aria-label="First name"><input name="last"></form>';
    const first = document.getElementById('first') as HTMLInputElement;
    const events: string[] = [];
    first.addEventListener('keydown', (e) => events.push(`keydown:${e.key}`));
    first.addEventListener('input', () => events.push('input'));
    first.addEventListener('change', () => events.push('change'));

    const snapshot = takeSnapshot()!;
    const res = await executeAction(actionFor(snapshot.actions, (a) => a.kind === 'fill'), 'Alice');

    expect(res).toEqual({ success: true });
    expect(first.value).toBe('Alice');
    expect(events).toEqual(['input', 'change']);
  });

  it('refuses to act on a stale snapshot without touching the page', async () => {
    document.body.innerHTML = '<input id="q" aria-label="Query" value=""><button id="b">Search</button>';
    const button = document.getElementById('b')!;
    let clicks = 0;
    button.addEventListener('click', () => clicks++);

    const snapshot = takeSnapshot()!;
    (document.getElementById('q') as HTMLInputElement).value = 'changed by the page';

    const res = await executeAction(actionFor(snapshot.actions, (a) => a.label === 'Search'));
    expect(res.success).toBe(false);
    expect(res.stale).toBe(true);
    expect(clicks).toBe(0);
  });

  it('treats a covered target as stale', async () => {
    document.body.innerHTML = '<button id="b">Buy</button><div id="modal">Cookie banner</div>';
    const button = document.getElementById('b')!;
    let clicks = 0;
    button.addEventListener('click', () => clicks++);

    const snapshot = takeSnapshot()!;
    (document as any).elementFromPoint = () => document.getElementById('modal');

    const res = await executeAction(actionFor(snapshot.actions, (a) => a.label === 'Buy'));
    expect(res.stale).toBe(true);
    expect(clicks).toBe(0);
  });

  it('selects a dropdown option by value and fires change; a vanished option is an error, not stale', async () => {
    document.body.innerHTML =
      '<select id="s" aria-label="Trip"><option value="rt" selected>Round</option><option value="ow">One way</option></select>';
    const select = document.getElementById('s') as HTMLSelectElement;
    let changes = 0;
    select.addEventListener('change', () => changes++);

    const snapshot = takeSnapshot()!;
    const action = actionFor(snapshot.actions, (a) => a.kind === 'select' && a.value === 'ow');
    expect(await executeAction(action)).toEqual({ success: true });
    expect(select.value).toBe('ow');
    expect(changes).toBe(1);

    const again = takeSnapshot()!;
    const rt = actionFor(again.actions, (a) => a.kind === 'select' && a.value === 'rt');
    select.remove();
    const res = await executeAction({ ...rt });
    expect(res.success).toBe(false);
  });

  it('clicks the innermost element under the pointer so a link inside an option row navigates', async () => {
    document.body.innerHTML = '<ul><li role="option" id="row"><a id="link" href="#go">Taylor Swift</a></li></ul>';
    const row = document.getElementById('row')!;
    const link = document.getElementById('link')!;
    const clicked: string[] = [];
    row.addEventListener('click', (e) => clicked.push('row:' + (e.target as Element).id));
    link.addEventListener('click', (e) => { clicked.push('link'); e.preventDefault(); });

    const snapshot = takeSnapshot()!;
    (document as any).elementFromPoint = () => link;
    const res = await executeAction(actionFor(snapshot.actions, (a) => a.role === 'option'));

    expect(res).toEqual({ success: true });
    expect(clicked).toEqual(['link', 'row:link']);
  });

  it('runs wait and scroll controls', async () => {
    document.body.innerHTML = '<p>Hello</p>';
    const snapshot = takeSnapshot()!;
    expect(await executeAction(actionFor(snapshot.actions, (a) => a.id === 'wait'))).toEqual({ success: true });
  });
});

describe('click targets and PRESS_ENTER', () => {
  beforeEach(() => {
    delete (window as any).__jevFast;
    fakeLayout();
  });

  it('clicks the button when the pointer lands on an SVG icon inside it', async () => {
    document.body.innerHTML = '<button id="go"><svg id="icon" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg></button>';
    const button = document.getElementById('go')!;
    let clicks = 0;
    button.addEventListener('click', () => clicks++);
    const snapshot = takeSnapshot()!;
    (document as any).elementFromPoint = () => document.querySelector('#icon path');
    const res = await executeAction(actionFor(snapshot.actions, (a) => a.role === 'button'));
    expect(res).toEqual({ success: true });
    expect(clicks).toBe(1);
  });

  it('offers PRESS_ENTER only for a focused field with text, and submits that field\'s own form', async () => {
    document.body.innerHTML =
      '<form id="other"><input aria-label="Other" value="x"></form>' +
      '<form id="mine"><input id="q" aria-label="Query"></form>';
    const q = document.getElementById('q') as HTMLInputElement;
    expect(takeSnapshot()!.actions.find((a) => a.id === 'press_enter')).toBeUndefined();

    q.focus();
    q.value = 'hello';
    const snapshot = takeSnapshot()!;
    const press = snapshot.actions.find((a) => a.id === 'press_enter');
    expect(press).toMatchObject({ kind: 'key', label: 'Press Enter in the focused field "Query" to submit it' });

    const submitted: string[] = [];
    for (const id of ['mine', 'other']) {
      const form = document.getElementById(id) as HTMLFormElement;
      form.addEventListener('submit', (e) => { e.preventDefault(); submitted.push(id); });
      (form as any).requestSubmit = () => form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }
    const keys: string[] = [];
    q.addEventListener('keydown', (e) => keys.push(e.key));
    expect(await executeAction(press!)).toEqual({ success: true });
    expect(keys).toEqual(['Enter']);
    expect(submitted).toEqual(['mine']);
  });

  it('does not submit the form when a keydown handler cancels Enter', async () => {
    document.body.innerHTML = '<form id="f"><input id="q" aria-label="Query"></form>';
    const q = document.getElementById('q') as HTMLInputElement;
    const form = document.getElementById('f') as HTMLFormElement;
    let submits = 0;
    (form as any).requestSubmit = () => submits++;
    q.addEventListener('keydown', (e) => e.preventDefault());
    q.focus();
    q.value = 'x';
    const snapshot = takeSnapshot()!;
    await executeAction(actionFor(snapshot.actions, (a) => a.id === 'press_enter'));
    expect(submits).toBe(0);
  });
});

describe('covers inside one component', () => {
  beforeEach(() => {
    delete (window as any).__jevFast;
    fakeLayout();
  });

  it('clicks through a hover layer that belongs to the same product card', async () => {
    document.body.innerHTML =
      '<main><ul><li id="card" style="position:relative"><a id="p" href="#prod">Apple Cinema 30"</a><div id="hover" style="position:absolute;inset:0;opacity:0"></div></li></ul></main>';
    const link = document.getElementById('p')!;
    let clicks = 0;
    link.addEventListener('click', (e) => { clicks++; e.preventDefault(); });
    const snapshot = takeSnapshot()!;
    (document as any).elementFromPoint = () => document.getElementById('hover');
    const res = await executeAction(actionFor(snapshot.actions, (a) => a.label.startsWith('Apple')));
    expect(res).toEqual({ success: true });
    expect(clicks).toBe(1);
  });

  it('still refuses to click beneath a dialog', async () => {
    document.body.innerHTML =
      '<div id="wrap"><a id="p" href="#prod">Buy</a><div role="dialog" id="modal">Cookies?</div></div>';
    const link = document.getElementById('p')!;
    let clicks = 0;
    link.addEventListener('click', () => clicks++);
    const snapshot = takeSnapshot()!;
    (document as any).elementFromPoint = () => document.getElementById('modal');
    const res = await executeAction(actionFor(snapshot.actions, (a) => a.label === 'Buy'));
    expect(res.stale).toBe(true);
    expect(clicks).toBe(0);
  });
});

describe('element context', () => {
  beforeEach(() => {
    delete (window as any).__jevFast;
    fakeLayout();
  });

  it('records the heading above each control and the target of each link', () => {
    document.body.innerHTML =
      '<h2>Search results</h2><a href="/abs/1706.03762">Attention Is All You Need</a>' +
      '<h2>Related</h2><a href="https://other.example/x?y=1#z">Elsewhere</a><button>Go</button>';
    const snapshot = takeSnapshot()!;
    const first = snapshot.actions.find((a) => a.label === 'Attention Is All You Need')!;
    expect(first.section).toBe('Search results');
    expect(first.href).toBe('/abs/1706.03762');
    const other = snapshot.actions.find((a) => a.label === 'Elsewhere')!;
    expect(other.section).toBe('Related');
    expect(other.href).toBe('other.example/x?y=1#z');
    expect(snapshot.actions.find((a) => a.label === 'Go')!.href).toBeUndefined();
  });
});

describe('wrapped inline links', () => {
  beforeEach(() => {
    delete (window as any).__jevFast;
    fakeLayout();
  });

  it('clicks the first rendered line of a link that wraps, not the centre of its union box', async () => {
    document.body.innerHTML = '<ul><li><a id="p" href="#prod">Apple Cinema 30\"</a></li><li id="next">next row</li></ul>';
    const link = document.getElementById('p')!;
    const frag = (x: number, y: number, w: number, h: number) => ({ x, y, top: y, left: x, width: w, height: h, right: x + w, bottom: y + h, toJSON() {} } as DOMRect);
    // Two line fragments; the union box centre (y=160) falls on the next row.
    (link as any).getClientRects = () => [frag(10, 100, 120, 20), frag(10, 200, 60, 20)];
    (link as any).getBoundingClientRect = () => frag(10, 100, 120, 120);
    (document as any).elementFromPoint = (_x: number, y: number) => (y < 130 ? link : document.getElementById('next'));
    let clicks = 0;
    link.addEventListener('click', (e) => { clicks++; e.preventDefault(); });
    const snapshot = takeSnapshot()!;
    const res = await executeAction(actionFor(snapshot.actions, (a) => a.label.startsWith('Apple')));
    expect(res).toEqual({ success: true });
    expect(clicks).toBe(1);
  });
});

describe('covered elements are not observed', () => {
  beforeEach(() => {
    delete (window as any).__jevFast;
    fakeLayout();
  });

  it('drops a control that sits under another block, keeps one under its own card\'s hover layer', () => {
    document.body.innerHTML =
      '<main><div id="old"><a id="stale" href="#a">Apple Cinema 30"</a></div><div id="new"><a id="fresh" href="#b">Canon EOS</a></div></main>' +
      '<ul><li id="card"><a id="p" href="#c">HP LP3065</a><div id="hover"></div></li></ul>';
    (document as any).elementFromPoint = (_x: number, y: number) => {
      // The stale link is under the new list; the card link is under its own hover layer.
      const stale = document.getElementById('stale')!.getBoundingClientRect();
      if (Math.abs(y - (stale.top + stale.height / 2)) < 1) return document.getElementById('new');
      const p = document.getElementById('p')!.getBoundingClientRect();
      if (Math.abs(y - (p.top + p.height / 2)) < 1) return document.getElementById('hover');
      return null;
    };
    const labels = takeSnapshot()!.actions.map((a) => a.label);
    expect(labels).not.toContain('Apple Cinema 30"');
    expect(labels).toContain('Canon EOS');
    expect(labels).toContain('HP LP3065');
  });
});
