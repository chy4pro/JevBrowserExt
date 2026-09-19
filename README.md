# JevBrowserExt

A Chrome extension that drives web pages with [TypeSafe Jev](https://typesafe.ai), a decision model that picks the next click, keystroke or dropdown value in a few hundred milliseconds instead of generating text. It is a Manifest V3 port of [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast): same observation format, same questions, same execution rules, running inside your own browser and your own tabs.

[English](README.md) | [简体中文](README_CN.md)

## How it works

1. The content script reads the visible page: every interactive element gets a code-owned index, a role, an accessible name and its current value. Visible text is captured up to 6,000 characters. No screenshots.
2. The background worker sends one request to Jev with the goal, the element table and recent actions. Jev answers two questions at once: which operation (`CLICK`, `TYPE_TEXT`, `SELECT`, `SCROLL_*`, `WAIT`, `DONE`, `BLOCKED`) and, for each operation, which element. Only the target head of the chosen operation is used.
3. If the operation is `TYPE_TEXT`, a small chat model (DeepSeek, Gemini, anything OpenAI-compatible) turns the goal and field context into the exact string to type. The extension never guesses field values itself.
4. The content script executes the action on the real DOM node. Nothing runs if the page changed since the observation; a click is dispatched once; Enter is never pressed on the model's behalf.

Jev returns a probability over the offered candidates, so every step in the popup shows what the model considered and how sure it was. Answers are validated strictly: an unknown candidate or an inconsistent distribution stops the run rather than being "repaired".

A real run against Wikipedia with the goal "Search for Taylor Swift and open her early life section", through OpenRouter:

| Step | Operation | Target | Jev latency |
|---|---|---|---|
| 1 | TYPE_TEXT | Search Wikipedia → "Taylor Swift" (text model, 1.6 s) | 346 ms |
| 2 | CLICK | Search | 369 ms |
| 3 | CLICK | 1 Life and career | 366 ms |
| 4 | DONE | | 592 ms |

## Install

There is no store listing yet. Build it from source:

```bash
git clone https://github.com/chy4pro/JevBrowserExt.git
cd JevBrowserExt
npm install
npm run build
```

Then open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick the `dist/` folder.

## Configure

Open the extension's Options page.

**Jev provider** (pick one):

| Provider | Endpoint | Model |
|---|---|---|
| OpenRouter | `https://openrouter.ai/api/alpha/decisions` | `typesafe/jev-1.13` |
| TypeSafe.ai | `https://api.typesafe.ai/v1/systemone` | `jev-latest` |
| Cloudflare Workers AI | `https://api.cloudflare.com/client/v4/accounts/{id}/ai/run` | `typesafe/jev` |

**Text helper** (only used for `TYPE_TEXT`): OpenRouter, DeepSeek direct, or any OpenAI-compatible base URL. Switching the provider fills in its default base URL and model. If the helper runs through OpenRouter and you already entered an OpenRouter key, you can leave the helper key empty.

**Runtime**: max steps per run, delay between steps, and whether to draw the numbered badges on the page.

The **Test** button on each provider sends a tiny real request and shows the answer, so you can check a key before starting a run.

## Use

Click the toolbar icon, type a goal, press **Run**. **Step** executes exactly one action so you can watch decisions one at a time; **Stop** aborts. The page shows numbered badges on the elements the model can see and a small status bar with the current action and its latency.

Runs stop on `DONE`, on `BLOCKED`, after three consecutive actions that changed nothing on the page, when the step budget is exhausted, or on any provider error. `DONE` is the model's opinion, not proof; check the page.

## What is and isn't handled

Works: links, buttons, text inputs, textareas, contenteditable, native `<select>`, checkboxes and radios that are actually rendered, ARIA roles (`button`, `link`, `combobox`, `option`, `tab`, `menuitem`, ...), autocomplete lists, in-page and cross-page navigation, scrolling.

Not handled: elements inside shadow roots or iframes, canvas UIs, file uploads, drag and drop, keyboard-only widgets, and natively hidden checkboxes/radios styled through their label (the model cannot see them). Password fields are never observed or filled. Internal `chrome://` pages are refused.

Same policy and same boundaries as the reference implementation; two websites do not prove general reliability.

## Development

```bash
npm run check      # typecheck + unit tests + production build
npm test           # vitest
npm run typecheck
```

Tests cover the action space and answer validation, provider adapters and retry policy, the text helper parser, DOM snapshot classification, the content script boot guard, the in-page executor (jsdom) and the agent loop (mocked `chrome`). They never call a paid API. `scripts/test_live_e2e.ts` runs two real requests when `OPENROUTER_API_KEY` is set.

### Running the built extension in a real browser

```bash
npx playwright install chromium          # once
npm run e2e:ext                          # smoke: boots everything, expects a clear missing-key error
OPENROUTER_API_KEY=... npm run e2e:ext   # full run with real decisions
```

The script loads `dist/` into Playwright's Chromium (new headless, no display needed), writes settings into `chrome.storage`, opens the options page, the popup and a real web page, runs the goal through the real service worker and content script, and writes `run.log` plus screenshots per step to `.e2e-out/`. Variables: `E2E_URL`, `E2E_GOAL`, `E2E_MAX_STEPS`, `E2E_OUT`, `CHROMIUM_PATH`. The popup accepts `?tabId=` so a test (or a detached window) can target a specific tab.

On a machine without root, fetch Chromium's missing shared libraries with `apt-get download`, extract them with `dpkg -x` and point `LD_LIBRARY_PATH` and `FONTCONFIG_FILE` at the result; that is how the container this was developed in runs it.

```
src/
  background/agent.ts        observe → decide → act loop, budgets, deadlock detection
  background/index.ts        message router, settings storage
  content/snapshot.ts        DOM observation, node identity cache, freshness guards
  content/executor.ts        stale-safe click / fill / select / scroll
  content/overlay.ts         badges and status bar
  shared/action-space.ts     element table, Jev questions, strict answer validation
  shared/text-helper.ts      TYPE_TEXT value generation
  shared/providers/          TypeSafe, OpenRouter, Cloudflare adapters
  popup/, options/           React UI
public/manifest.json         MV3 manifest (copied into dist/)
```

## Keywords

browser agent, web agent, browser automation, chrome extension, manifest v3, typesafe jev, jev-1.13, system 1 model, non-autoregressive, decision model, openrouter decisions api, cloudflare workers ai, browser-use, jev-ultrafast, dom automation, ai agent, web automation, typescript, react, vite

## License

MIT
