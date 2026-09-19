# Jev for Chrome

[![check](https://github.com/chy4pro/jev-for-chrome/actions/workflows/check.yml/badge.svg)](https://github.com/chy4pro/jev-for-chrome/actions/workflows/check.yml)
[![release](https://img.shields.io/github/v/release/chy4pro/jev-for-chrome?display_name=tag)](https://github.com/chy4pro/jev-for-chrome/releases)
[![license](https://img.shields.io/github/license/chy4pro/jev-for-chrome)](LICENSE)

A Chrome extension that drives the tab you are looking at with [TypeSafe Jev](https://typesafe.ai), a decision model that picks the next click, keystroke or dropdown value in a few hundred milliseconds instead of generating text. It is a Manifest V3 port of [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast): same observation format, same questions, same execution rules. Community project, not affiliated with TypeSafe or Browser Use.

[English](README.md) | [简体中文](README_CN.md)

![Google Flights, one-way Zurich to London on September 20 2026, driven by the extension in headless Chromium at real speed](docs/demo.gif)

*One goal typed into the popup. Ten decisions, about thirteen seconds, recorded at real speed by the test harness ([webm](docs/demo.webm)); the numbered badges are the elements the model could see.*

## Why an extension

- **Your browser, your sessions.** It runs in the tab you already have open, with your cookies and logins, on your normal Chrome profile. Nothing to install besides the extension; no Python, no Playwright, no second browser.
- **Sites that turn away automated browsers are not a problem.** In a datacenter headless browser the test suite is stopped by Cloudflare's "verify you are human" page on several sites; the same pages open normally in a real Chrome profile, and the model just sees the page.
- **Watch it and step it.** Badges show what the model sees, a status bar shows the decision and its latency, **Step** executes one decision at a time, **Copy trace** exports the run for a bug report.
- **Same policy as the reference, and a few things it does not do yet.** Links that open new tabs are followed, wrapped links are clicked where they render, controls hidden under other blocks are not offered, and two independent probability checks veto a premature DONE.

| | Jev for Chrome | jev-ultrafast | jev-browser (jkudish) | browser-use |
|---|---|---|---|---|
| Runs in | your own Chrome tab and profile | a Chrome tab owned by Browser Harness (CDP) | a Playwright browser | Playwright or Browser Use cloud |
| Runtime you need | Chrome | Python, uv, Browser Harness | Node | Python |
| Who decides each step | Jev: operation + element in one request | Jev: operation + element in one request | Jev picks the action; goal/stuck checks | an LLM |
| Who writes typed text | small text model | small text model | text model or heuristic | the LLM |

Descriptions of the other projects are taken from their READMEs in September 2026.

## How it works
## How it works

1. The content script reads the visible page: every interactive element gets a code-owned index, a role, an accessible name and its current value. Visible text is captured up to 6,000 characters. No screenshots.
2. The background worker sends one request to Jev with the goal, the element table and recent actions. Jev answers two questions at once: which operation (`CLICK`, `TYPE_TEXT`, `SELECT`, `SCROLL_*`, `WAIT`, `DONE`, `BLOCKED`) and, for each operation, which element. Only the target head of the chosen operation is used.
3. If the operation is `TYPE_TEXT`, a small chat model (DeepSeek, Gemini, anything OpenAI-compatible) turns the goal and field context into the exact string to type. The extension never guesses field values itself.
4. The content script executes the action on the real DOM node. Nothing runs if the page changed since the observation; a click is dispatched once. Enter is never pressed implicitly: when a focused text field holds text, a separate `PRESS_ENTER` control is offered and the model has to choose it (this is the one addition to the reference action space; sites like arXiv and Wolfram Alpha have no submit button).

Jev has no memory between calls, so everything it needs is in the `state` of each request: the task; the current URL, title and visible text; every element with its role, current value, link target (`href`) and the heading it sits under (`section`); the recent actions with what each one visibly did ("navigated to …", "page content changed", "no visible change"); and the URLs visited so far. The rules reference these fields by name, as the TypeSafe docs recommend.

The same request also asks two independent yes/no questions: is the task already achieved on this page, and are the recent actions stuck? They are answered without seeing the action choice, so they act as an honest cross-check: a DONE the goal check does not support (below 50%) is withheld once and the model is told what is still missing; a BLOCKED the stuck check does not support is treated the same way. The popup shows both probabilities on every step, and **Copy trace** puts the whole run on the clipboard as JSON for bug reports.

Jev returns a probability over the offered candidates, so every step in the popup shows what the model considered and how sure it was. Answers are validated strictly: an unknown candidate or an inconsistent distribution (beyond the provider's two-decimal rounding) is asked once more, then stops the run rather than being "repaired". A control that is chosen three times within six steps, even when each click changes the page (a menu that opens and closes), ends the run as BLOCKED after the model has been warned.

## Results

Every task below was run through the built extension in headless Chromium (real service worker, content script, popup) with OpenRouter. Tasks come from this extension's popup, from the reference project, from demos people posted on X (Steve Krouse's jev + kernel playground, jkudish/jev-browser, Vlad Terin's Codex adapter) and from WebVoyager-style sites. "Result" is an independent check of the final URL or page text, not the model's DONE. Full traces of the recorded run: [docs/e2e-suite-2026-09-19.md](docs/e2e-suite-2026-09-19.md).

| Source | Task | Result | Steps | Time |
|---|---|---|---|---|
| Popup | Google Flights, one-way Zurich → London, Sep 20 2026 | ✅ | 14 | 21 s |
| Popup | Wikipedia: search Taylor Swift, open Early life | ✅ | 3 | 9.6 s |
| Popup | Add the highest-rated product to the cart (OpenCart demo) | ✅ | 5 | 6.8 s |
| Reference | Wikipedia: open Gödel's incompleteness theorems | ✅ | 2 | 5.0 s |
| X / Krouse | Wikiracing: Rubber duck → Eiffel Tower, links only | ✅ | 2 | 6.3 s |
| X / Krouse | Hacker News: open comments of the top story | ✅ | 1 | 2.0 s |
| X / Krouse | Val Town: find the Airtable API examples | ❌ | 3 | 7.3 s |
| X / jev-browser | Wikipedia: Coffee → Espresso | ✅ | 1 | 3.2 s |
| X / jev-browser | GitHub: open the newest browser-use release | ✅ | 2 | 5.2 s |
| X / jev-browser | Wikipedia: search Ristretto, stop on the article | ❌ | 0 | 5.5 s |
| X / Terin | Python docs: open the tutorial's Data Structures chapter | ❌ | 1 | 5.6 s |
| WebVoyager-style | Wiktionary: look up serendipity | ✅ | 3 | 12.5 s |
| WebVoyager | arXiv: search "Attention Is All You Need", open the abstract | ❌ | 6 | 22.4 s |
| WebVoyager | Hugging Face: open openai/whisper-large-v3 | ✅ | 3 | 10.7 s |
| WebVoyager | Wolfram Alpha: derivative of x³ sin x | ✅ | 4 | 8.3 s |
| WebVoyager-style | Wikibooks Cookbook: open the banana bread recipe | ✅ | 3 | 7.4 s |
| WebVoyager | BBC: open the technology section | ✅ | 1 | 2.7 s |

13 of 17 in this run; across seven rounds the same suite scored 9, 10, 11, 14, 13, 13 and 13 while executor and loop bugs were being fixed, and individual tasks flip between runs. The misses in this run:

- **Ristretto** and **Python docs**: the text model behind OpenRouter answered HTTP 429 (rate limited) on the first TYPE_TEXT; both passed in earlier rounds. Transient statuses are now retried three times with longer backoff.
- **Val Town**: the hop to docs.val.town ends on a browser error page in this headless environment, where no content script can run.
- **arXiv**: the model had the results' `href`s and the "sort by relevance" dropdown and still paged through date-sorted results, then opened a 2026 paper with the same title. A model decision, not missing context.

The cart task failed in six rounds before this one for an executor reason worth knowing: after sorting, that shop keeps the old product cards in the DOM underneath the new list. They passed every visibility check, so the model kept being offered a link nobody could click. The observer now hit-tests every control and drops the ones another block covers. Google Flights in the Chinese interface (`hl=zh-CN`, locale zh-CN) also completes, in 10 steps; its one premature DONE, before the results had loaded, was vetoed by the goal check.

Sites behind Cloudflare's "verify you are human" page (Cambridge Dictionary, Allrecipes, demo.nopcommerce.com, demo.opencart.com) stop at that page in a headless datacenter browser; the model correctly reports BLOCKED there. `E2E_TASKS=scripts/e2e-tasks.json npm run e2e:ext` reproduces the table.

## Install

There is no Chrome Web Store listing yet.

**From a release**: download `jev-for-chrome-<version>.zip` from the [Releases page](https://github.com/chy4pro/jev-for-chrome/releases), unzip it, open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick the unzipped folder.

**From source**:

```bash
git clone https://github.com/chy4pro/jev-for-chrome.git
cd jev-for-chrome
npm install
npm run build
```

Then load the `dist/` folder the same way.

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

Runs stop on `DONE`, on `BLOCKED`, after three consecutive actions that changed nothing on the page, when the step budget is exhausted, or on any provider error. A `DONE` or `BLOCKED` given with less than 50% confidence is asked once more after the page settles before it counts. A target that turns out to be covered, or a field the text model cannot fill from the goal, is reported back to the model and withheld after two attempts. `DONE` is the model's opinion, not proof; check the page.

## What leaves your browser

Each step sends one request to the Jev provider you chose (OpenRouter, TypeSafe or Cloudflare) containing: your goal, the current tab's URL, title and visible text (up to 6,000 characters), the table of interactive elements with their labels, current values and link targets, and the last ten actions. When the model decides to type, one request goes to the text model with the goal, the field and the same page text. Nothing is sent anywhere else; there is no telemetry. API keys stay in `chrome.storage.local` on your machine. Password fields are never read or filled, and `chrome://` pages are refused. The `<all_urls>` permission exists because the extension has to read the tab you point it at; it does nothing on tabs where you have not started a run.

## What is and isn't handled

Works: links, buttons, text inputs, textareas, contenteditable, native `<select>`, checkboxes and radios that are actually rendered, ARIA roles (`button`, `link`, `combobox`, `option`, `tab`, `menuitem`, ...), autocomplete lists, in-page and cross-page navigation, scrolling, and links that open a new tab: the agent follows the tab its click opened, continues there, and returns to the opener if that tab is closed.

Not handled: elements inside shadow roots or iframes, canvas UIs, file uploads, drag and drop, keyboard-only widgets, and natively hidden checkboxes/radios styled through their label (the model cannot see them). Password fields are never observed or filled. Internal `chrome://` pages are refused. Hover-only layers inside a product card are clicked through; anything under a dialog or page-wide overlay is not.

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
