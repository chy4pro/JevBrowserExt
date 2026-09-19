// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { executeAction } from '../src/content/executor';
import { takeSnapshot } from '../src/content/snapshot';
import { PageAction } from '../src/shared/types';

/** jsdom has no layout: give every element a real-looking rect and treat it as visible. */
function fakeLayout(): void {
  let n = 0;
  Element.prototype.getBoundingClientRect = function () {
    const top = 10 + (n++ % 30) * 24;
    return { x: 10, y: top, top, left: 10, width: 200, height: 20, right: 210, bottom: top + 20, toJSON() {} } as DOMRect;
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
