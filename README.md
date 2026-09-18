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
- **🔄 Self-Healing & Deadlock Prevention**:
  - Real page fingerprinting (`url`, `scroll`, `input_values`, `dom_text`) to track genuine `page_changed` state.
  - Adaptive feedback alerts when an action produces no change.
  - Automatic target suppression / candidate penalization to prevent infinite loops on stuck elements.
  - Automatic `Enter` key trigger for search and form submissions.
- **🎨 Interactive Visual Overlay**:
  - Real-time `[1]`, `[2]`, `[3]` badge overlays on interactive elements.
  - Floating execution HUD displaying step progress, confidence, latency, and calibrated probabilities.
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
- **Provider**: OpenRouter, DeepSeek, or OpenAI-compatible.
- **Model**: `deepseek/deepseek-chat` or `google/gemini-3.7-flash`.

---

## 🧪 Testing

The repository includes complete test suites covering action space generation, provider adapters, text helper parsing, and loop detection:

```bash
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
│   │   ├── snapshot.ts     # Atomic DOM element extractor (up to 250 elements)
│   │   ├── executor.ts     # Synthetic DOM events (click, fill with prototype setter, select, Enter)
│   │   ├── overlay.ts      # Visual badges and status HUD
│   │   └── index.ts        # Content script entry listener
│   ├── popup/              # React Popup UI
│   │   └── Popup.tsx       # Goal input, run/step/stop controls, step logs
│   ├── options/            # React Options UI
│   │   └── Options.tsx     # Provider switcher & live connection test
│   └── shared/             # Shared Types, Prompts, and Adapters
│       ├── action-space.ts # Speculative questions & choice validator
│       ├── prompts.ts      # System prompts & operation rules
│       ├── text-helper.ts  # Fallback text generator for TYPE_TEXT
│       ├── types.ts        # Core TypeScript interfaces & schemas
│       └── providers/      # Adapters for TypeSafe, OpenRouter, Cloudflare
├── tests/                  # Vitest test suite
│   ├── action-space.test.ts
│   ├── providers.test.ts
│   └── text-helper.test.ts
├── scripts/
│   ├── generate_icons.js   # Icon generation script
│   └── test_live_e2e.ts    # Live network integration test
├── manifest.json           # Chrome MV3 manifest
└── package.json
```

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
