# Chrome Web Store listing material

Copy from here into the Developer Dashboard. Everything below is factual; keep it that way if you edit.

## Store listing

**Name**: Jev for Chrome

**Summary** (132 characters max):
Drives the current tab with TypeSafe Jev, a sub-second decision model. Unofficial community port of jev-ultrafast.

**Description**:
Type a goal into the popup, press Run, and watch the tab you are looking at get driven step by step: each click, keystroke and dropdown choice is decided by TypeSafe Jev, a decision model that answers in a few hundred milliseconds instead of generating text. A small text model is called only when a field needs typed text.

It is an unofficial Chrome port of browser-use/jev-ultrafast with the same observation format, questions and execution rules, running in your own tabs with your own logins. Numbered badges show which elements the model can see, a status bar shows each decision and its latency, Step executes one decision at a time, and Copy trace exports a run for bug reports.

You bring your own API key (OpenRouter, TypeSafe or Cloudflare Workers AI for Jev; OpenRouter, DeepSeek or any OpenAI-compatible endpoint for text). Nothing is sent anywhere except to the providers you configure; there is no telemetry. Password fields are never read.

Open source (MIT): https://github.com/chy4pro/jev-for-chrome — with a recorded demo, a 17-task test suite and full traces.

Not affiliated with TypeSafe or Browser Use.

**Category**: Productivity → Workflow & Planning (or Developer Tools)

**Language**: English (add Chinese (Simplified) as a second listing language with the README_CN wording if you like)

**Screenshots** (1280×800): `docs/store/1-typing.png`, `docs/store/2-results.png`, `docs/store/3-options.png`

**Privacy policy URL**: https://github.com/chy4pro/jev-for-chrome/blob/main/docs/PRIVACY.md

## Privacy practices tab

**Single purpose**: Automate the current browser tab toward a goal the user types, by deciding and executing clicks, typing and dropdown selections with a decision model the user configures.

**Permission justifications**:
- `activeTab` / `tabs`: identify the tab the user started a run on, follow a tab that a click opens, and return to the opener when it closes. No other tabs are read.
- `scripting`: inject the page script that observes interactive elements and executes clicks and typing on the run's tab when the declared content script is not yet present (e.g. right after installation).
- `storage`: keep the user's provider settings and API keys on the device.
- Host permission `<all_urls>`: the user chooses which site to run on; the extension cannot know in advance and only touches the tab of an active run.
- Remote code: none. All code ships in the package; providers return JSON decisions, never code.

**Data usage** (check these boxes): the extension collects **website content** (text and structure of the page the user runs it on) and transmits it to the AI providers the user configured, for the extension's single purpose. It does not collect personally identifiable information on its own, health, financial, authentication (password fields are excluded), personal communications, location, web history (only the current tab of an active run), or user activity beyond that tab. Certify: not sold to third parties, not used for purposes unrelated to the single purpose, not used for creditworthiness.

## Distribution

Visibility: Public. Regions: all. Pricing: free.
