# Privacy policy — Jev for Chrome

Last updated: 2026-09-19

Jev for Chrome is a browser extension that automates the tab you point it at, using a decision model (TypeSafe Jev) and a small text model that you configure yourself. It is a community project, not affiliated with TypeSafe or Browser Use.

## What the extension does with data

- **Nothing happens until you start a run.** The extension reads a tab only after you type a goal into its popup and press Run or Step, and only on that tab.
- **During a run, each step sends one request to the Jev provider you chose** (OpenRouter, TypeSafe or Cloudflare Workers AI). That request contains: your goal, the current tab's URL, title and visible text (up to 6,000 characters), the list of interactive elements with their labels, current values and link targets, and the last ten actions taken.
- **When the model decides to type into a field, one request goes to the text model you chose** (OpenRouter, DeepSeek or an OpenAI-compatible endpoint) with the goal, the field's label and the same page text.
- **Password fields are never read or filled.** Pages under `chrome://` and other internal schemes are refused.
- **Nothing is sent anywhere else.** There is no telemetry, no analytics, no crash reporting and no server operated by the author.

## What is stored, and where

- Your API keys and settings are stored in `chrome.storage.local` on your device only. They are sent solely to the provider they belong to, as an authorization header.
- Run logs (the decisions shown in the popup) are kept in memory while the extension's service worker is alive and are discarded afterwards. "Copy trace" puts a run on your clipboard only when you click it.

## Third parties

The providers you configure process the data described above under their own terms and privacy policies: [OpenRouter](https://openrouter.ai/privacy), [TypeSafe](https://typesafe.ai), [Cloudflare](https://www.cloudflare.com/privacypolicy/), [DeepSeek](https://platform.deepseek.com), or whichever OpenAI-compatible endpoint you enter. The author has no access to that data.

## Permissions

- `activeTab`, `tabs`, `scripting` and the `<all_urls>` host permission: needed to read the tab you started a run on, to inject the page script that executes clicks and typing, and to follow a link that opens a new tab. They are not used on other tabs.
- `storage`: to keep your settings and keys on your device.

## Contact

Questions and issues: https://github.com/chy4pro/jev-for-chrome/issues
