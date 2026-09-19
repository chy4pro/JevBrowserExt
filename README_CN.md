# ⚡ JevBrowserExt

> **基于 TypeSafe Jev（系统一非自回归决策引擎）的极速浏览器自动化 Chrome 插件**

[English](README.md) | [简体中文](README_CN.md)

---

**JevBrowserExt** 是专为 Google Chrome（Manifest V3）打造的超轻量、低延迟浏览器自动化扩展插件。设计理念源自 [`browser-use/jev-ultrafast`](https://github.com/browser-use/jev-ultrafast)，通过将传统需要 3~10 秒的多模态 VLM（截图 + 逐字生成的慢速过程）替换为 **TypeSafe Jev** 决策模型，将单步动作裁决时间极致压缩至 **70ms ~ 250ms**。

---

## 🌟 核心特性

- **⚡ 亚秒级极速决策（70ms ~ 250ms）**：
  摒弃笨重的高清截图编码与漫长的文字自回归生成过程。Jev 在单次前向推理中，同时裁决下一步动作类型（`CLICK`、`TYPE_TEXT`、`SELECT`、`WAIT`、`DONE`）及候选目标元素。
- **🎯 纯粹决策输出（Decisions, Not Strings）**：
  直接返回结构化决策与校准置信度（`answers.operation`、`answers.click_target`），不产生冗长自然语言 Token，相比传统 LLM Agent 极大节省计算与 API 费用。
- **🌐 原生支持三大 Jev 接入渠道**：
  - **TypeSafe.ai 官方 API**（`https://api.typesafe.ai/v1/systemone`）
  - **OpenRouter Decisions API**（`https://openrouter.ai/api/alpha/decisions`，模型：`typesafe/jev-1.13`）
  - **Cloudflare Workers AI**（`https://api.cloudflare.com/client/v4/accounts/{id}/ai/run`）
- **🧠 双模型协同架构（Dual-Model Orchestration）**：
  - **Jev（系统一）**：快速裁决点击、导航、聚焦、下拉选择等空间与交互动作。
  - **Text Helper（系统二）**：仅在遇到输入框（`TYPE_TEXT`）时调用。由轻量文本大模型（如 `deepseek/deepseek-chat` 或 `google/gemini-3.7-flash`）根据用户目标快速提取填充文本。
- **🛡️ 防过期执行（Stale-Safe Execution）**：
  - 每个决策在执行前都会与它所依据的页面状态比对（URL、视口、表单值、目标元素状态及其所在表单/对话框/行的上下文）；页面已变则丢弃该决策、重新观察。任何动作都不会被执行两次。
  - 执行器在动作前重新检查可见性、可用状态、几何位置与遮挡；点击只触发一次；不会替模型按 `Enter`——提交或选取自动补全建议由模型在下一步决定。
  - 每次动作后等待页面响应（两帧动画，或等待自动补全选项出现）再进行下一次观察。
- **🔄 循环反馈与死锁检测**：
  - 语义化页面指纹为每个动作标注真实的 `page_changed` 状态。
  - 上一动作无效时向 Jev 下发警告；同一目标连续两次无效且存在替代目标时，将其移出候选。
  - 连续三个非 WAIT 动作均未引起页面变化即判定 `BLOCKED` 终止；每次运行同时受步数预算与模型调用预算约束。
  - 严格校验模型答案（必须是已提供的候选、概率分布自洽）；答案非法即终止，绝不"修补"后执行。
- **🎨 实时可视化悬浮交互**：
  - 页面实时可交互元素编号悬浮标签 `[1]`, `[2]`, `[3]`。
  - 页面内悬浮 HUD 状态条实时展示当前操作、目标元素与决策延迟。
  - 支持全自动运行（**▶ Run Ultrafast**）与单步调试（**⏭ Step**）。

---

## 🏗️ 系统架构图

```
┌─────────────────────────────────────────────────────────┐
│                      Chrome 浏览器                      │
│                                                         │
│  ┌────────────────────────┐    ┌─────────────────────┐  │
│  │ Popup / Options UI     │    │ Content Script      │  │
│  │ (React + Vite)         │    │ - 原子 DOM 提取器   │  │
│  │ - 目标指令配置与交互   │    │ - 元素悬浮标记      │  │
│  │ - 步骤日志与实时 HUD   │    │ - 真实动作执行器    │  │
│  └───────────┬────────────┘    └──────────┬──────────┘  │
│              │                            │             │
│              ▼                            ▼             │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Background Service Worker (调度内核)              │  │
│  │ - DOM 观察与页面指纹差分计算                      │  │
│  │ - 动作空间与候选问题构造                          │  │
│  │ - 死锁侦测与动态自愈熔断机制                      │  │
│  └───────────────────────┬───────────────────────────┘  │
└──────────────────────────┼──────────────────────────────┘
                           │
         ┌─────────────────┴─────────────────┐
         ▼                                   ▼
┌───────────────────────────┐     ┌───────────────────────────┐
│ Jev 决策引擎              │     │ 辅助文本大模型            │
│ (TypeSafe / OpenRouter /  │     │ (仅在 TYPE_TEXT           │
│  Cloudflare Workers AI)   │     │  需要填表时按需调用)      │
│ - 操作裁决头              │     │ - DeepSeek / Gemini       │
│ - 目标候选裁决头          │     │ - 输入内容精准生成        │
└───────────────────────────┘     └───────────────────────────┘
```

---

## 🚀 快速上手

### 1. 克隆项目并安装依赖

```bash
git clone https://github.com/chy4pro/JevBrowserExt.git
cd JevBrowserExt
npm install
```

### 2. 运行测试与项目编译

```bash
# 运行单元测试
npm test

# 编译打包 Chrome MV3 产物（输出至 dist/）
npm run build
```

### 3. 加载至 Google Chrome

1. 打开 Google Chrome 浏览器，在地址栏输入 `chrome://extensions/`。
2. 开启右上角的 **开发者模式** 开关。
3. 点击左上角的 **加载已解压的扩展程序**（Load unpacked）。
4. 选择本项目中的 `dist/` 目录。
5. 扩展程序栏中即会出现 **⚡ Jev Ultrafast Agent** 图标。

---

## ⚙️ 模型与渠道配置

右键扩展图标选择 **选项（Options）**，或直接打开 `chrome-extension://<id>/options.html`：

### 1. Jev 决策渠道配置
选择使用的服务提供商：
- **OpenRouter（推荐）**：
  - **API Key**：填入 OpenRouter 密钥（`sk-or-v1-...`）。
  - **Model**：`typesafe/jev-1.13`
  - **Endpoint**：`https://openrouter.ai/api/alpha/decisions`
- **TypeSafe.ai（官方）**：
  - **API Key**：填入官方控制台获取的 `sk-...`
  - **Model**：`jev-latest`
  - **Endpoint**：`https://api.typesafe.ai/v1/systemone`
- **Cloudflare Workers AI**：
  - **Account ID** 与 **API Token**
  - **Model**：`typesafe/jev`

### 2. 文本辅助模型配置
仅在 Jev 选择填充输入框时触发：
- **Provider**：OpenRouter、DeepSeek 或 OpenAI 兼容接口。切换 Provider 时会自动填入该渠道的默认 Base URL 与模型（如 OpenRouter 下为 `deepseek/deepseek-chat`，DeepSeek 直连为 `deepseek-chat`）。
- **API Key**：当辅助模型走 OpenRouter 且已配置 OpenRouter Key 时可留空。

---

## 🧪 自动化测试

单元测试覆盖动作空间生成、严格答案校验、渠道适配器与重试策略、文本辅助解析、DOM 快照分类、页内执行器（单次点击、不合成 Enter、过期与遮挡守卫）以及 agent 循环（过期重试、死锁检测、文本值缓存、单步执行、预算）。单元测试不会调用任何付费 API。

```bash
# 类型检查 + 单元测试 + 生产构建
npm run check

# 运行所有 Vitest 单元测试
npm test

# （可选）运行端到端网络真实链路测试
export OPENROUTER_API_KEY="your-openrouter-key"
npx tsx scripts/test_live_e2e.ts
```

---

## 📄 开源协议

基于 MIT License 开源，详情参阅 [LICENSE](LICENSE)。
