# JevBrowserExt

一个用 [TypeSafe Jev](https://typesafe.ai) 驱动网页的 Chrome 扩展。Jev 不生成文本，它在几百毫秒内直接选出下一步该点哪、该在哪输入、该选哪个下拉项。本项目是 [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) 的 Manifest V3 移植：同样的观察格式、同样的问题、同样的执行规则，跑在你自己的浏览器和标签页里。

[English](README.md) | [简体中文](README_CN.md)

## 工作方式

1. 内容脚本读取当前可见页面：每个可交互元素得到一个由代码分配的编号、角色、可访问名称和当前值；可见文本最多取 6,000 字符。不截图。
2. 后台 worker 把目标、元素表和最近动作一次性发给 Jev。Jev 同时回答两个问题：做什么操作（`CLICK`、`TYPE_TEXT`、`SELECT`、`SCROLL_*`、`WAIT`、`DONE`、`BLOCKED`），以及每种操作对应哪个元素。只消费被选中操作的那个目标答案。
3. 如果操作是 `TYPE_TEXT`，由一个小型对话模型（DeepSeek、Gemini 或任何 OpenAI 兼容接口）根据目标和字段上下文给出要输入的字符串。扩展本身从不猜测字段值。
4. 内容脚本在真实 DOM 节点上执行。页面若在观察之后发生了变化就不执行；点击只触发一次。不会偷偷替模型按 Enter：当聚焦的文本框里有内容时，会单独提供一个 `PRESS_ENTER` 控件，由模型自己选择（这是相对参考项目动作空间唯一的新增；arXiv、Wolfram Alpha 这类站点没有提交按钮）。

Jev 在两次调用之间没有任何记忆，所以每次请求的 `state` 里要把它需要的全部给到：任务本身；当前 URL、标题和可见文本；每个元素的角色、当前值、链接目标（`href`）和它所在的标题（`section`）；最近的动作以及每个动作实际造成了什么（"跳转到 …""页面内容变了""没有变化"）；以及到目前为止访问过的 URL。规则文本按 TypeSafe 文档的建议用字段名引用这些内容。

同一请求还会附带两个独立的是非题：当前页面上任务是否已经完成、最近的动作是否在原地打转。它们看不到动作选择的答案，所以是诚实的交叉检查：目标检查不支持（低于 50%）的 DONE 会被撤回一次，并告诉模型还缺什么；卡住检查不支持的 BLOCKED 同样处理。弹窗每一步都显示这两个概率，**Copy trace** 按钮把整次运行以 JSON 复制到剪贴板，方便报 bug。

Jev 返回的是候选项上的概率分布，弹窗里每一步都能看到模型考虑了什么、有多确定。答案会被严格校验：出现未提供的候选或分布不自洽（超出渠道两位小数的舍入）时先重问一次，再不行才终止，不做"修补"。同一个控件在六步内被选中三次，即使每次点击都改变了页面（比如反复开关一个菜单），在警告过模型之后也会以 BLOCKED 结束。

## 实测结果

下面每条任务都是把构建好的扩展装进 headless Chromium（真实的 service worker、内容脚本和 popup）、走 OpenRouter 跑出来的。任务来源：本扩展弹窗里的示例、参考项目、X 上别人发的演示（Steve Krouse 的 jev + kernel 试玩页、jkudish/jev-browser、Vlad Terin 的 Codex 适配器），以及 WebVoyager 风格的站点。"结果"是对最终 URL 或页面文本的独立校验，不看模型自己报的 DONE。这次运行的完整轨迹见 [docs/e2e-suite-2026-09-19.md](docs/e2e-suite-2026-09-19.md)。

| 来源 | 任务 | 结果 | 步数 | 耗时 |
|---|---|---|---|---|
| 弹窗示例 | Google Flights 单程苏黎世→伦敦，2026-09-20 | ✅ | 14 | 21 s |
| 弹窗示例 | Wikipedia 搜 Taylor Swift 并打开 Early life | ✅ | 3 | 9.6 s |
| 弹窗示例 | 把评分最高的商品加入购物车（OpenCart 演示站） | ✅ | 5 | 6.8 s |
| 参考项目 | Wikipedia 打开哥德尔不完备定理词条 | ✅ | 2 | 5.0 s |
| X / Krouse | Wikiracing：只靠链接从 Rubber duck 到 Eiffel Tower | ✅ | 2 | 6.3 s |
| X / Krouse | Hacker News：打开头条的评论 | ✅ | 1 | 2.0 s |
| X / Krouse | Val Town：找 Airtable API 示例 | ❌ | 3 | 7.3 s |
| X / jev-browser | Wikipedia：Coffee → Espresso | ✅ | 1 | 3.2 s |
| X / jev-browser | GitHub：打开 browser-use 最新 release | ✅ | 2 | 5.2 s |
| X / jev-browser | Wikipedia：搜索 Ristretto 并停在词条 | ❌ | 0 | 5.5 s |
| X / Terin | Python 文档：打开教程的 Data Structures 章节 | ❌ | 1 | 5.6 s |
| WebVoyager 风格 | Wiktionary：查 serendipity | ✅ | 3 | 12.5 s |
| WebVoyager | arXiv：搜 "Attention Is All You Need" 并打开摘要页 | ❌ | 6 | 22.4 s |
| WebVoyager | Hugging Face：打开 openai/whisper-large-v3 | ✅ | 3 | 10.7 s |
| WebVoyager | Wolfram Alpha：求 x³ sin x 的导数 | ✅ | 4 | 8.3 s |
| WebVoyager 风格 | Wikibooks 食谱：打开香蕉面包配方 | ✅ | 3 | 7.4 s |
| WebVoyager | BBC：打开科技版块 | ✅ | 1 | 2.7 s |

这轮 17 过 13。七轮下来同一套任务分别得到 9、10、11、14、13、13、13，期间在修执行器和循环的 bug，同一条任务在不同运行间会翻转。这轮的失败：

- **Ristretto** 和 **Python 文档**：OpenRouter 后面的文本模型在第一次 TYPE_TEXT 时返回 HTTP 429（限流），这两条在之前几轮都通过。瞬时错误现在重试三次、退避更长。
- **Val Town**：跳到 docs.val.town 时在这个 headless 环境里落到了浏览器错误页，内容脚本无法运行。
- **arXiv**：模型拿到了每条结果的 `href` 和"按相关性排序"的下拉框，仍然在按日期排序的结果里翻页，最后打开了一篇 2026 年的同名论文。这是模型的决策，不是缺上下文。

购物车这条在此前六轮都失败，原因值得记一笔：那个商店排序后把旧的商品卡片留在 DOM 里、压在新列表下面，它们能通过所有可见性检查，于是模型一直被提供一个谁都点不到的链接。观察阶段现在对每个控件做命中测试，被别的块盖住的一律不提供。Google Flights 在中文界面（`hl=zh-CN`、locale zh-CN）下同样 10 步完成，结果尚未加载时的一次过早 DONE 被目标检查否决。

被 Cloudflare "verify you are human" 拦住的站点（Cambridge Dictionary、Allrecipes、demo.nopcommerce.com、demo.opencart.com）在数据中心的 headless 浏览器里会停在验证页，模型会正确地报 BLOCKED。`E2E_TASKS=scripts/e2e-tasks.json npm run e2e:ext` 可以复现这张表。

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

运行会在以下情况停止：模型给出 `DONE` 或 `BLOCKED`、连续三个动作都没有改变页面、步数预算用完、任何渠道报错。置信度低于 50% 的 `DONE`/`BLOCKED` 会等页面稳定后再问一次，重复才算数。目标被遮挡、或文本模型无法从目标里推出该填什么，会反馈给模型，两次之后该目标不再提供。`DONE` 是模型的判断，不是证明，请自己看一眼页面。

## 能处理和不能处理的

能处理：链接、按钮、文本输入框、textarea、contenteditable、原生 `<select>`、真正渲染出来的复选框和单选框、ARIA 角色（`button`、`link`、`combobox`、`option`、`tab`、`menuitem` 等）、自动补全列表、页内和跨页导航、滚动，以及会打开新标签页的链接：agent 会跟进自己点开的新标签页继续执行，该标签页被关闭时退回原来的标签页。

不能处理：shadow root 和 iframe 里的元素、canvas 界面、文件上传、拖拽、纯键盘控件，以及通过 label 做样式、本身被隐藏的原生复选框和单选框（模型看不到它们）。密码框永远不观察也不填写。`chrome://` 内部页面会被拒绝。商品卡片内部悬停才出现的浮层会被穿透点击；对话框或整页遮罩下面的元素不会。

策略和边界与参考实现一致；在两个网站上跑通不代表普遍可靠。

## 开发

```bash
npm run check      # 类型检查 + 单元测试 + 生产构建
npm test           # vitest
npm run typecheck
```

测试覆盖动作空间与答案校验、渠道适配器与重试策略、文本助手解析、DOM 快照分类、内容脚本启动守卫、页内执行器（jsdom）和 agent 循环（mock `chrome`），不会调用任何付费 API。设置 `OPENROUTER_API_KEY` 后 `scripts/test_live_e2e.ts` 会发两个真实请求。

### 在真实浏览器里跑构建好的扩展

```bash
npx playwright install chromium          # 一次即可
npm run e2e:ext                          # 冒烟：全部启动，期望得到清晰的缺 key 错误
OPENROUTER_API_KEY=... npm run e2e:ext   # 完整运行，真实决策
```

脚本把 `dist/` 加载进 Playwright 的 Chromium（新版 headless，不需要显示器），把设置写入 `chrome.storage`，打开选项页、popup 和一个真实网页，通过真实的 service worker 和内容脚本跑完目标，并把 `run.log` 和每步截图写到 `.e2e-out/`。可用变量：`E2E_URL`、`E2E_GOAL`、`E2E_MAX_STEPS`、`E2E_OUT`、`CHROMIUM_PATH`。popup 支持 `?tabId=`，测试（或分离窗口）可以指定目标标签页。

没有 root 的机器上，可用 `apt-get download` 拿到 Chromium 缺的共享库、`dpkg -x` 解包，然后把 `LD_LIBRARY_PATH` 和 `FONTCONFIG_FILE` 指过去；本项目开发所在的容器就是这么跑的。

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
