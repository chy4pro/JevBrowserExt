/**
 * Loads the built extension into a real Chromium (new headless) and drives it end to end:
 * service worker, options page, popup, content script, real web pages.
 *
 *   npm run e2e:ext                              # smoke: no API key, checks boot + clear error
 *   OPENROUTER_API_KEY=... npm run e2e:ext       # one goal (E2E_URL / E2E_GOAL)
 *   OPENROUTER_API_KEY=... E2E_TASKS=scripts/e2e-tasks.json npm run e2e:ext   # a suite
 *
 * Each suite task: { name, url, goal, maxSteps?, expectUrl?, expectText? } where expectUrl /
 * expectText are regexes checked against the final URL / visible page text, independently of
 * the model's DONE. Results go to <E2E_OUT>/<task>/ (run.log, step screenshots) and
 * <E2E_OUT>/summary.md.
 *
 * Env: E2E_OUT (default .e2e-out), E2E_MAX_STEPS, CHROMIUM_PATH.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type BrowserContext, type Page, type Worker } from 'playwright';

interface Task {
  name: string;
  url: string;
  goal: string;
  maxSteps?: number;
  expectUrl?: string;
  expectText?: string;
}

interface Result {
  task: Task;
  status: string;
  steps: number;
  seconds: number;
  finalUrl: string;
  verified: boolean | null;
  error?: string;
  trace: string[];
}

const DIST = path.resolve('dist');
const OUT = path.resolve(process.env.E2E_OUT || '.e2e-out');
const API_KEY = (process.env.OPENROUTER_API_KEY || '').trim();
const DEFAULT_MAX_STEPS = Number(process.env.E2E_MAX_STEPS || 8);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

class Log {
  lines: string[] = [];
  constructor(private prefix = '') {}
  add(msg: string) {
    const line = `${new Date().toISOString().slice(11, 23)} ${this.prefix}${msg}`;
    this.lines.push(line);
    console.log(line);
  }
  save(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, this.lines.join('\n') + '\n');
  }
}

function attachPageLogging(page: Page, log: Log) {
  const tag = () => (page.url().startsWith('chrome-extension://') ? page.url().split('/').pop()?.split('?')[0] : 'web');
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') log.add(`[${tag()} console.${m.type()}] ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => log.add(`[${tag()} pageerror] ${e.message.slice(0, 300)}`));
}

async function launch(log: Log): Promise<{ context: BrowserContext; sw: Worker; extId: string }> {
  if (!fs.existsSync(path.join(DIST, 'manifest.json'))) throw new Error('dist/ missing; run npm run build');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-ext-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: process.env.CHROMIUM_PATH ? undefined : 'chromium',
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
    viewport: { width: 1280, height: 800 },
    locale: process.env.E2E_LOCALE || 'en-US',
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--no-sandbox', '--disable-gpu'],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  sw.on('console', (m) => log.add(`[sw console.${m.type()}] ${m.text().slice(0, 300)}`));
  const extId = new URL(sw.url()).host;
  log.add(`extension loaded: ${extId}`);
  return { context, sw, extId };
}

async function progress(popup: Page): Promise<any> {
  return popup.evaluate(
    () => new Promise((resolve) => chrome.runtime.sendMessage({ type: 'GET_PROGRESS' }, (r: any) => resolve(r?.progress)))
  );
}

async function runTask(context: BrowserContext, sw: Worker, extId: string, task: Task): Promise<Result> {
  const dir = path.join(OUT, slug(task.name));
  fs.mkdirSync(dir, { recursive: true });
  const log = new Log();
  const maxSteps = task.maxSteps ?? DEFAULT_MAX_STEPS;
  const trace: string[] = [];
  const started = Date.now();
  let page: Page | null = null;
  let popup: Page | null = null;
  let result: Result = { task, status: 'error', steps: 0, seconds: 0, finalUrl: task.url, verified: null, trace };
  try {
    await sw.evaluate(async (maxSteps) => {
      const { jev_settings } = await chrome.storage.local.get('jev_settings');
      await chrome.storage.local.set({ jev_settings: { ...(jev_settings || {}), maxSteps } });
    }, maxSteps);

    page = await context.newPage();
    attachPageLogging(page, log);
    await page.goto(task.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const tabId = await sw.evaluate(
      async (url) => (await chrome.tabs.query({})).find((t) => (t.url || '').startsWith(url.split('#')[0]))?.id,
      task.url
    );
    if (typeof tabId !== 'number') throw new Error('could not find the web tab id');
    log.add(`[${task.name}] ${task.url}`);

    popup = await context.newPage();
    attachPageLogging(popup, log);
    await popup.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}`);
    await popup.getByText('Jev Ultrafast').first().waitFor({ timeout: 10000 });
    await popup.locator('textarea').fill(task.goal);
    await popup.getByRole('button', { name: /Run Ultrafast/ }).click();
    await page.bringToFront();
    log.add(`[${task.name}] goal: ${task.goal}`);

    let seen = 0;
    let last: any = null;
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
      await sleep(400);
      const p = await progress(popup);
      if (!p) continue;
      last = p;
      const entries = [...p.logs].reverse(); // stored newest first
      for (const e of entries.slice(seen)) {
        const line =
          `${e.operation}${e.targetLabel ? ` → ${e.targetLabel.slice(0, 60)}` : ''}${e.targetValue ? ` "${e.targetValue}"` : ''}` +
          ` (${Math.round((e.confidence ?? 0) * 100)}%, ${e.latencyMs}ms${e.goalDone !== undefined ? `, goal ${Math.round(e.goalDone * 100)}%` : ''}${e.stuck !== undefined ? `, stuck ${Math.round(e.stuck * 100)}%` : ''})`;
        trace.push(line);
        log.add(`[${task.name}] step ${e.step}: ${line}`);
        await page.screenshot({ path: path.join(dir, `step-${String(trace.length).padStart(2, '0')}.png`) }).catch(() => undefined);
      }
      seen = entries.length;
      if (p.status !== 'running') break;
    }
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    await sleep(500);
    const finalUrl = page.url();
    let verified: boolean | null = null;
    if (task.expectUrl || task.expectText) {
      const text = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
      const urlOk = task.expectUrl ? new RegExp(task.expectUrl, 'i').test(finalUrl) : true;
      const textOk = task.expectText ? new RegExp(task.expectText, 'i').test(text) : true;
      verified = urlOk && textOk;
    }
    await page.screenshot({ path: path.join(dir, 'final-page.png') }).catch(() => undefined);
    await popup.screenshot({ path: path.join(dir, 'final-popup.png') }).catch(() => undefined);
    result = {
      task,
      status: last?.status || 'unknown',
      steps: last?.currentStep || 0,
      seconds,
      finalUrl,
      verified,
      error: last?.lastError,
      trace,
    };
    log.add(`[${task.name}] ${result.status} in ${seconds}s, ${result.steps} steps, verified=${verified}, url=${finalUrl}${result.error ? `, error: ${result.error}` : ''}`);
  } catch (err: any) {
    result.error = err?.message || String(err);
    result.seconds = Math.round((Date.now() - started) / 100) / 10;
    log.add(`[${task.name}] FAILED: ${result.error}`);
  } finally {
    log.save(path.join(dir, 'run.log'));
    await popup?.close().catch(() => undefined);
    await page?.close().catch(() => undefined);
  }
  return result;
}

function summary(results: Result[]): string {
  const rows = results.map((r) => {
    const ok = r.verified === null ? (r.status === 'done' ? '✅' : '❌') : r.verified ? '✅' : '❌';
    return `| ${ok} | ${r.task.name} | ${r.status} | ${r.steps} | ${r.seconds}s | ${r.verified === null ? '—' : r.verified ? 'yes' : 'no'} | ${r.error ? r.error.slice(0, 80) : ''} |`;
  });
  const passed = results.filter((r) => (r.verified === null ? r.status === 'done' : r.verified)).length;
  return [
    `# Extension E2E suite — ${passed}/${results.length} passed`,
    '',
    '| | Task | Status | Steps | Time | Verified | Error |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
    ...results.flatMap((r) => [`## ${r.task.name}`, '', `Goal: ${r.task.goal}`, `Final URL: ${r.finalUrl}`, '', ...r.trace.map((t, i) => `${i + 1}. ${t}`), '']),
  ].join('\n');
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const log = new Log();
  const { context, sw, extId } = await launch(log);
  let failed = false;
  try {
    await sw.evaluate(
      async ({ apiKey }) => {
        await chrome.storage.local.set({
          jev_settings: {
            activeProvider: 'openrouter',
            openrouter: { apiKey, model: 'typesafe/jev-1.13', endpoint: '' },
            textHelper: { provider: 'openrouter', apiKey: '', baseUrl: '', model: '' },
            maxSteps: 8,
            stepDelayMs: 300,
            showOverlay: true,
          },
        });
      },
      { apiKey: API_KEY }
    );

    const options = await context.newPage();
    attachPageLogging(options, log);
    await options.goto(`chrome-extension://${extId}/options.html`);
    await options.getByText('Jev Ultrafast Extension Settings').waitFor({ timeout: 10000 });
    log.add(`options page ok; model = "${await options.locator('input[placeholder="typesafe/jev-1.13"]').inputValue()}"`);
    await options.screenshot({ path: path.join(OUT, 'options.png') });
    await options.close();

    const tasks: Task[] = process.env.E2E_TASKS
      ? JSON.parse(fs.readFileSync(process.env.E2E_TASKS, 'utf8'))
      : [
          {
            name: 'default',
            url: process.env.E2E_URL || 'https://en.wikipedia.org/wiki/Main_Page',
            goal: process.env.E2E_GOAL || 'Search for Taylor Swift and open her early life section',
          },
        ];

    const results: Result[] = [];
    for (const task of tasks) {
      results.push(await runTask(context, sw, extId, task));
    }
    const md = summary(results);
    fs.writeFileSync(path.join(OUT, 'summary.md'), md);
    console.log('\n' + md.split('\n').slice(0, results.length + 4).join('\n'));

    if (!API_KEY) {
      const r = results[0];
      const ok = r.status === 'error' && /API Key/i.test(r.error || '');
      log.add(ok ? 'smoke ok: missing key produced a clear error' : 'smoke FAILED: expected a clear missing-key error');
      failed = !ok;
    } else {
      failed = results.some((r) => (r.verified === null ? r.status !== 'done' : !r.verified));
    }
  } finally {
    log.save(path.join(OUT, 'run.log'));
    await context.close();
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`FATAL: ${err?.stack || err}`);
  process.exit(2);
});
