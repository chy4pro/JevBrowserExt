/**
 * Loads the built extension into a real Chromium (new headless) and drives it end to end:
 * service worker, options page, popup, content script, real web page.
 *
 *   npm run e2e:ext                       # smoke: no API key, checks boot + clear error
 *   OPENROUTER_API_KEY=... npm run e2e:ext # full run with real Jev decisions
 *
 * Env: E2E_URL (start page), E2E_GOAL, E2E_MAX_STEPS, E2E_OUT (screenshots + log dir),
 *      CHROMIUM_PATH (executable override).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type BrowserContext, type Page, type Worker } from 'playwright';

const DIST = path.resolve('dist');
const OUT = path.resolve(process.env.E2E_OUT || '.e2e-out');
const START_URL = process.env.E2E_URL || 'https://en.wikipedia.org/wiki/Main_Page';
const GOAL = process.env.E2E_GOAL || 'Search for Taylor Swift and open her early life section';
const MAX_STEPS = Number(process.env.E2E_MAX_STEPS || 8);
const API_KEY = (process.env.OPENROUTER_API_KEY || '').trim();

const lines: string[] = [];
const log = (msg: string) => {
  const line = `${new Date().toISOString().slice(11, 23)} ${msg}`;
  lines.push(line);
  console.log(line);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function attachPageLogging(page: Page) {
  const tag = () => (page.url().startsWith('chrome-extension://') ? page.url().split('/').pop()?.split('?')[0] : 'web');
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') log(`[${tag()} console.${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => log(`[${tag()} pageerror] ${e.message}`));
}

async function launch(): Promise<{ context: BrowserContext; sw: Worker; extId: string }> {
  if (!fs.existsSync(path.join(DIST, 'manifest.json'))) throw new Error('dist/ missing; run npm run build');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-ext-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: process.env.CHROMIUM_PATH ? undefined : 'chromium',
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--no-sandbox', '--disable-gpu'],
  });
  context.on('page', attachPageLogging);
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  sw.on('console', (m) => log(`[sw console.${m.type()}] ${m.text()}`));
  const extId = new URL(sw.url()).host;
  log(`extension loaded: ${extId} (${sw.url()})`);
  return { context, sw, extId };
}

async function progress(popup: Page): Promise<any> {
  return popup.evaluate(
    () => new Promise((resolve) => chrome.runtime.sendMessage({ type: 'GET_PROGRESS' }, (r: any) => resolve(r?.progress)))
  );
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { context, sw, extId } = await launch();
  let failed = false;
  try {
    // Settings written straight into chrome.storage, like the options page would.
    await sw.evaluate(
      async ({ apiKey, maxSteps }) => {
        await chrome.storage.local.set({
          jev_settings: {
            activeProvider: 'openrouter',
            openrouter: { apiKey, model: 'typesafe/jev-1.13', endpoint: '' },
            textHelper: { provider: 'openrouter', apiKey: '', baseUrl: '', model: '' },
            maxSteps,
            stepDelayMs: 300,
            showOverlay: true,
          },
        });
      },
      { apiKey: API_KEY, maxSteps: MAX_STEPS }
    );

    // Options page renders and reflects the stored settings.
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extId}/options.html`);
    await options.getByText('Jev Ultrafast Extension Settings').waitFor({ timeout: 10000 });
    const storedModel = await options.locator('input[placeholder="typesafe/jev-1.13"]').inputValue();
    log(`options page ok; OpenRouter model field = "${storedModel}"`);
    await options.screenshot({ path: path.join(OUT, 'options.png') });
    await options.close();

    // Real web page + popup bound to it.
    const page = await context.newPage();
    await page.goto(START_URL, { waitUntil: 'domcontentloaded' });
    const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({})).find((t) => (t.url || '').startsWith(url))?.id, START_URL);
    if (typeof tabId !== 'number') throw new Error('could not find the web tab id');
    log(`web tab ${tabId}: ${page.url()}`);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}`);
    await popup.getByText('Jev Ultrafast').first().waitFor({ timeout: 10000 });
    await popup.locator('textarea').fill(GOAL);
    await popup.getByRole('button', { name: /Run Ultrafast/ }).click();
    await page.bringToFront();
    log(`run started: "${GOAL}"`);

    let seen = 0;
    let last: any = null;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      await sleep(400);
      const p = await progress(popup);
      if (!p) continue;
      last = p;
      const entries = [...p.logs].reverse(); // stored newest first
      for (const e of entries.slice(seen)) {
        log(
          `step ${e.step}: ${e.operation}${e.targetLabel ? ` → ${e.targetLabel}` : ''}${e.targetValue ? ` "${e.targetValue}"` : ''} ` +
            `(conf ${Math.round((e.confidence ?? 0) * 100)}%, ${e.latencyMs}ms)`
        );
        await page.screenshot({ path: path.join(OUT, `step-${e.step}.png`) }).catch(() => undefined);
      }
      seen = entries.length;
      if (p.status !== 'running') break;
    }
    log(`final status: ${last?.status} step ${last?.currentStep}/${last?.maxSteps}${last?.lastError ? ` error: ${last.lastError}` : ''}`);
    log(`final url: ${page.url()}`);
    await page.screenshot({ path: path.join(OUT, 'final-page.png') }).catch(() => undefined);
    await popup.screenshot({ path: path.join(OUT, 'final-popup.png') }).catch(() => undefined);

    if (!API_KEY) {
      const ok = last?.status === 'error' && /API Key/i.test(last?.lastError || '');
      log(ok ? 'smoke ok: missing key produced a clear error' : 'smoke FAILED: expected a clear missing-key error');
      failed = !ok;
    } else {
      failed = last?.status === 'error';
    }
  } finally {
    fs.writeFileSync(path.join(OUT, 'run.log'), lines.join('\n') + '\n');
    await context.close();
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  log(`FATAL: ${err?.stack || err}`);
  fs.writeFileSync(path.join(OUT, 'run.log'), lines.join('\n') + '\n');
  process.exit(2);
});
