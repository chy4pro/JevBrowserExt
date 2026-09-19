# ⚡ JevBrowserExt

> **Ultrafast Browser Automation Chrome Extension powered by TypeSafe Jev (System 1 Decision Engine)**

[English](README.md) | [简体中文](README_CN.md)

---

**JevBrowserExt** is a lightweight, ultra-low latency browser automation extension built for Google Chrome (Manifest V3). Inspired by [`browser-use/jev-ultrafast`](https://github.com/browser-use/jev-ultrafast), it replaces traditional slow Vision-Language Models (VLMs that take 3–10 seconds per step) with **TypeSafe Jev**, a non-autoregressive decision model that yields decisions in **70ms – 250ms**.

---

## 🌟 Key Features

- **⚡ Sub-Second Decisions (70ms – 250ms)**:
  Bypasses heavy screenshot encoding and slow multi-second autoregressive text generation. In a single forward pass, Jev simultaneously predicts the operation (`CLICK`, `TYPE_TEXT`, `SELECT`, `WAIT`, `DONE`) and speculative target candidates.
- **🎯 Decisions, Not Token Generation**:
  Returns structured categorical decisions and calibrated confidence probabilities (`answers.operation`, `answers.click_target`), saving immense token costs compared to full LLM agents.
- **🌐 Three First-Class Jev Providers**:
  - **TypeSafe.ai Official API** (`https://api.typesafe.ai/v1/systemone`)
  - **OpenRouter Decisions API** (`https://openrouter.ai/api/alpha/decisions`, model: `typesafe/jev-1.13`)
  - **Cloudflare Workers AI** (`https://api.cloudflare.com/client/v4/accounts/{id}/ai/run`)
- **🧠 Dual-Model Orchestration**:
  - **Jev (System 1)**: Rapidly decides navigation, clicks, element focus, and dropdown selection.
  - **Text Helper (System 2)**: Only invoked when a field needs text input (`TYPE_TEXT`). A lightweight text model (e.g. `deepseek/deepseek-chat` or `google/gemini-3.7-flash`) extracts or generates the exact value from the user's goal.
- **🛡️ Stale-Safe Execution**:
  - Every decision is checked against the page it was made on (URL, viewport, form values, target state and nearby context) right before acting; a stale decision is discarded and the page is observed again. Nothing is ever executed twice.
  - The executor re-checks visibility, enabled state, geometry and occlusion, clicks exactly once, and never presses Enter on the model's behalf — submitting or picking an autocomplete suggestion is the model's next decision.
  - After each action the next observation waits for the page to react (two animation frames, or visible options for autocomplete fields).
- **🔄 Loop Feedback & Deadlock Detection**:
  - A semantic page fingerprint tracks genuine `page_changed` state for every action.
  - The model is warned when its previous action changed nothing; a target that misses twice is removed from the candidates while alternatives remain.
  - Three consecutive non-wait actions without any change stop the run as `BLOCKED`; a step budget and a model-call budget bound every run.
  - Model answers are validated strictly (offered candidate, consistent probability distribution). An invalid answer stops the run instead of being "repaired".
- **🎨 Interactive Visual Overlay**:
  - Real-time `[1]`, `[2]`, `[3]` badge overlays on interactive elements.
  - Floating execution HUD on the page showing the current operation, target and decision latency.
  - Support for autonomous run (**▶ Run Ultrafast**) and interactive single-stepping (**⏭ Step**).

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Chrome Browser                     │
│                                                         │
│  ┌────────────────────────┐    ┌─────────────────────┐  │
│  │ Popup / Options UI     │    │ Content Script      │  │
│  │ (React + Vite)         │    │ - Atomic DOM Parser │  │
│  │ - Goal configuration   │    │ - Element Badges    │  │
│  │ - Live step logs & HUD │    │ - Action Executor   │  │
│  └───────────┬────────────┘    └──────────┬──────────┘  │
│              │                            │             │
│              ▼                            ▼             │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Background Service Worker (Agent Engine)          │  │
│  │ - DOM Observation & Page Fingerprint Tracker      │  │
│  │ - Action Space & Choice Question Formulation      │  │
│  │ - Loop Breaker & Ineffective Action Feedback      │  │
│  └───────────────────────┬───────────────────────────┘  │
└──────────────────────────┼──────────────────────────────┘
                           │
         ┌─────────────────┴─────────────────┐
         ▼                                   ▼
┌───────────────────────────┐     ┌───────────────────────────┐
│ Jev Decision Engine       │     │ Auxiliary Text Helper     │
│ (TypeSafe / OpenRouter /  │     │ (Invoked ONLY on          │
│  Cloudflare Workers AI)   │     │  TYPE_TEXT operations)    │
│ - Operation head          │     │ - DeepSeek / Gemini       │
│ - Speculative target head │     │ - Form input generation   │
└───────────────────────────┘     └───────────────────────────┘
```

---

## 🚀 Quick Start

### 1. Prerequisites & Installation

Clone this repository and install dependencies:

```bash
git clone https://github.com/chy4pro/JevBrowserExt.git
cd JevBrowserExt
npm install
```

### 2. Run Tests & Build

```bash
# Run unit tests
npm test

# Build production bundle for Chrome (outputs to dist/)
npm run build
```

### 3. Load into Google Chrome

1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** toggle in the top-right corner.
3. Click **Load unpacked** (加载已解压的扩展程序).
4. Select the `dist/` directory inside this project.
5. The extension **⚡ Jev Ultrafast Agent** will appear in your Chrome toolbar.

---

## ⚙️ Configuration

Right-click the extension icon and select **Options** (选项), or open `chrome-extension://<id>/options.html`:

### 1. Jev Provider Configuration
Select your active provider:
- **OpenRouter (Recommended)**:
  - **API Key**: Enter your OpenRouter API Key (`sk-or-v1-...`).
  - **Model**: `typesafe/jev-1.13`
  - **Endpoint**: `https://openrouter.ai/api/alpha/decisions`
- **TypeSafe.ai (Official)**:
  - **API Key**: Enter your TypeSafe API Key (`sk-...`).
  - **Model**: `jev-latest`
  - **Endpoint**: `https://api.typesafe.ai/v1/systemone`
- **Cloudflare Workers AI**:
  - **Account ID** & **API Token**
  - **Model**: `typesafe/jev`

### 2. Text Helper Configuration
Used only when Jev selects an input box to fill:
- **Provider**: OpenRouter, DeepSeek, or OpenAI-compatible. Switching the provider fills in that provider's default Base URL and model (for example `deepseek/deepseek-chat` on OpenRouter, `deepseek-chat` on DeepSeek direct).
- **API Key**: optional when the helper uses OpenRouter and an OpenRouter key is already configured.

---

## 🧪 Testing

Unit tests cover action-space generation, strict answer validation, provider adapters and retry policy, text helper parsing, DOM snapshot classification, the in-page executor (single click, no synthetic Enter, stale and occlusion guards) and the agent loop (stale retries, deadlock detection, text-value caching, single-stepping, budgets). Tests never call paid APIs.

```bash
# Type-check, unit tests and production build
npm run check

# Run all Vitest unit tests
npm test

# (Optional) Run live network end-to-end integration test
export OPENROUTER_API_KEY="your-openrouter-key"
npx tsx scripts/test_live_e2e.ts
```

---

## 📁 Project Structure

```text
JevBrowserExt/
├── public/                 # Static assets and icons
│   ├── icon16.png / icon48.png / icon128.png
│   └── manifest.json
├── src/
│   ├── background/         # Service Worker & Agent Runner
│   │   ├── agent.ts        # Observation, decision, and loop breaker engine
│   │   └── index.ts        # Extension runtime message router
│   ├── content/            # Injected Webpage Scripts
│   │   ├── snapshot.ts     # Atomic DOM element extractor (up to 250 elements) + freshness guards
│   │   ├── executor.ts     # Stale-safe execution (single click, fill via prototype setter, select)
│   │   ├── overlay.ts      # Visual badges and status HUD
│   │   └── index.ts        # Content script entry listener (guarded against double injection)
│   ├── popup/              # React Popup UI
│   │   └── Popup.tsx       # Goal input, run/step/stop controls, step logs
│   ├── options/            # React Options UI
│   │   └── Options.tsx     # Provider switcher & live connection test
│   └── shared/             # Shared Types, Prompts, and Adapters
│       ├── action-space.ts # Speculative questions & choice validator
│       ├── prompts.ts      # System prompts & operation rules
│       ├── text-helper.ts  # Fallback text generator for TYPE_TEXT
│       ├── types.ts        # Core TypeScript interfaces & schemas
│       └── providers/      # Adapters for TypeSafe, OpenRouter, Cloudflare (+ shared HTTP retry)
├── tests/                  # Vitest test suite
│   ├── action-space.test.ts
│   ├── agent.test.ts
│   ├── executor.test.ts
│   ├── providers.test.ts
│   └── text-helper.test.ts
├── scripts/
│   ├── generate_icons.js   # Icon generation script
│   └── test_live_e2e.ts    # Live network integration test
└── package.json            # (the MV3 manifest lives in public/manifest.json)
```

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
