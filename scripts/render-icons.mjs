// Renders assets/icon.svg to the PNG sizes Chrome needs, plus the Chrome Web Store promo tile.
// Uses Playwright's Chromium (npx playwright install chromium) so no native image library is needed.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const svg = fs.readFileSync('assets/icon.svg', 'utf8');
const browser = await chromium.launch({ channel: process.env.CHROMIUM_PATH ? undefined : 'chromium', executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 128, height: 128 }, deviceScaleFactor: 1 });

for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="128" height="128"', `width="${size}" height="${size}"`)}</body></html>`);
  await page.screenshot({ path: path.join('public', `icon${size}.png`), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(`public/icon${size}.png`);
}

// Small promo tile (440x280) for the store listing.
await page.setViewportSize({ width: 440, height: 280 });
await page.setContent(`<html><body style="margin:0;width:440px;height:280px;background:#0f172a;display:flex;align-items:center;justify-content:center;gap:28px;font-family:'Liberation Sans',Arial,Helvetica,sans-serif;color:#f8fafc">
  <div style="width:112px;height:112px">${svg.replace('width="128" height="128"', 'width="112" height="112"')}</div>
  <div>
    <div style="font-size:34px;font-weight:700;letter-spacing:-0.5px">Jev for Chrome</div>
    <div style="font-size:16px;color:#c7d2fe;margin-top:8px;line-height:1.35">Sub-second browser agent.<br>Runs in your own tabs.</div>
  </div>
</body></html>`);
await page.screenshot({ path: 'docs/store/promo-440x280.png', clip: { x: 0, y: 0, width: 440, height: 280 } });
console.log('docs/store/promo-440x280.png');
await browser.close();
