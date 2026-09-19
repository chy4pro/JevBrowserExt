# JevBrowserExt

一个用 [TypeSafe Jev](https://typesafe.ai) 驱动网页的 Chrome 扩展。Jev 不生成文本，它在几百毫秒内直接选出下一步该点哪、该在哪输入、该选哪个下拉项。本项目是 [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) 的 Manifest V3 移植：同样的观察格式、同样的问题、同样的执行规则，跑在你自己的浏览器和标签页里。

[English](README.md) | [简体中文](README_CN.md)

## 工作方式

1. 内容脚本读取当前可见页面：每个可交互元素得到一个由代码分配的编号、角色、可访问名称和当前值；可见文本最多取 6,000 字符。不截图。
2. 后台 worker 把目标、元素表和最近动作一次性发给 Jev。Jev 同时回答两个问题：做什么操作（`CLICK`、`TYPE_TEXT`、`SELECT`、`SCROLL_*`、`WAIT`、`DONE`、`BLOCKED`），以及每种操作对应哪个元素。只消费被选中操作的那个目标答案。
3. 如果操作是 `TYPE_TEXT`，由一个小型对话模型（DeepSeek、Gemini 或任何 OpenAI 兼容接口）根据目标和字段上下文给出要输入的字符串。扩展本身从不猜测字段值。
4. 内容脚本在真实 DOM 节点上执行。页面若在观察之后发生了变化就不执行；点击只触发一次；不会替模型按 Enter。

Jev 返回的是候选项上的概率分布，弹窗里每一步都能看到模型考虑了什么、有多确定。答案会被严格校验：出现未提供的候选或分布不自洽时直接终止，不做"修补"。

一次真实运行，目标是 "Search for Taylor Swift and open her early life section"，从 Wikipedia 首页开始，走 OpenRouter：

| 步 | 操作 | 目标 | Jev 延迟 |
|---|---|---|---|
| 1 | TYPE_TEXT | Search Wikipedia → "Taylor Swift"（文本模型 1.6 s） | 346 ms |
| 2 | CLICK | Search | 369 ms |
| 3 | CLICK | 1 Life and career | 366 ms |
| 4 | DONE | | 592 ms |

## 安装

暂未上架商店，从源码构建：

```bash
git clone https://github.com/chy4pro/JevBrowserExt.git
cd JevBrowserExt
npm install
npm run build
```

打开 `chrome://extensions`，开启开发者模式，点 **加载已解压的扩展程序**，选择 `dist/` 目录。

## 配置

打开扩展的选项页。

**Jev 渠道**（三选一）：

| 渠道 | 端点 | 模型 |
|---|---|---|
| OpenRouter | `https://openrouter.ai/api/alpha/decisions` | `typesafe/jev-1.13` |
| TypeSafe.ai | `https://api.typesafe.ai/v1/systemone` | `jev-latest` |
| Cloudflare Workers AI | `https://api.cloudflare.com/client/v4/accounts/{id}/ai/run` | `typesafe/jev` |

**文本助手**（只在 `TYPE_TEXT` 时用到）：OpenRouter、DeepSeek 直连，或任意 OpenAI 兼容 Base URL。切换渠道会自动填入该渠道的默认 Base URL 和模型。如果助手走 OpenRouter 且已经填了 OpenRouter key，助手的 key 可以留空。

**运行参数**：每次运行的最大步数、步间延迟、是否在页面上画编号徽章。

每个渠道旁边的 **Test** 按钮会发一个很小的真实请求并显示返回，可以在开跑前确认 key 是否可用。

## 使用

点工具栏图标，输入目标，按 **Run**。**Step** 只执行一步，方便逐步观察决策；**Stop** 中止。页面上会给模型能看到的元素画编号徽章，底部有一条状态栏显示当前动作和延迟。

运行会在以下情况停止：模型给出 `DONE` 或 `BLOCKED`、连续三个动作都没有改变页面、步数预算用完、任何渠道报错。`DONE` 是模型的判断，不是证明，请自己看一眼页面。

## 能处理和不能处理的

能处理：链接、按钮、文本输入框、textarea、contenteditable、原生 `<select>`、真正渲染出来的复选框和单选框、ARIA 角色（`button`、`link`、`combobox`、`option`、`tab`、`menuitem` 等）、自动补全列表、页内和跨页导航、滚动。

不能处理：shadow root 和 iframe 里的元素、canvas 界面、文件上传、拖拽、纯键盘控件，以及通过 label 做样式、本身被隐藏的原生复选框和单选框（模型看不到它们）。密码框永远不观察也不填写。`chrome://` 内部页面会被拒绝。

策略和边界与参考实现一致；在两个网站上跑通不代表普遍可靠。

## 开发

```bash
npm run check      # 类型检查 + 单元测试 + 生产构建
npm test           # vitest
npm run typecheck
```

测试覆盖动作空间与答案校验、渠道适配器与重试策略、文本助手解析、DOM 快照分类、页内执行器（jsdom）和 agent 循环（mock `chrome`），不会调用任何付费 API。设置 `OPENROUTER_API_KEY` 后 `scripts/test_live_e2e.ts` 会发两个真实请求。

```
src/
  background/agent.ts        观察 → 决策 → 执行 循环，预算，死锁检测
  background/index.ts        消息路由，设置存储
  content/snapshot.ts        DOM 观察，节点身份缓存，新鲜度守卫
  content/executor.ts        防过期的 click / fill / select / scroll
  content/overlay.ts         徽章和状态栏
  shared/action-space.ts     元素表，Jev 问题，严格答案校验
  shared/text-helper.ts      TYPE_TEXT 取值
  shared/providers/          TypeSafe、OpenRouter、Cloudflare 适配器
  popup/, options/           React 界面
public/manifest.json         MV3 manifest（构建时复制到 dist/）
```

## 关键词

浏览器智能体, 网页自动化, 浏览器自动化, Chrome 扩展, Manifest V3, TypeSafe Jev, jev-1.13, 系统一模型, 非自回归, 决策模型, OpenRouter Decisions API, Cloudflare Workers AI, browser-use, jev-ultrafast, DOM 自动化, AI agent, browser agent, web agent, TypeScript, React, Vite

## 许可

MIT
