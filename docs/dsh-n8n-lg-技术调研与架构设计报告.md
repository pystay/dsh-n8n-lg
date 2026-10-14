# DSH 轻量化 n8n 集成插件（dsh-n8n-lg）技术调研与架构设计报告

> 调研时间：2026-10-14
> 调研范围：GitHub 公开仓库、DeepSeek Harness 官方文档（deepseek-harness.github.io）、n8n 官方/社区资料
> 交付状态：前期调研，未产出插件代码
> **修订记录**：2026-10-14 基于 **n8n 2.44.0 源码**核验，修正原稿两处错误假设——① n8n 公开 API **不能触发工作流**（须走 Webhook）；② 公开 API 鉴权头是 **`X-N8N-API-KEY`**（非 Bearer）。详见《dsh-n8n-lg 适配 DSH 桌面端 技术方案》。

---

## 0. 结论速览（TL;DR）

- **DSH（DeepSeek Harness）是真实存在的开源项目**（DeepSeek AI 出品，Cordis 驱动的"一切皆插件"运行时）。插件必须用 **TypeScript** 编写，以 `apply(ctx)` 形式注册能力。
- **"轻量化遥控器"定位完全成立**：插件只需封装 n8n API/Webhook + 注册工具，不需要重写执行引擎。这正是 DSH 插件模型的强项。
- **通信推荐"Webhook 触发 + 回调/查询"混合模式**：n8n 公开 API 没有触发端点，触发必须走工作流的 Webhook URL；公开 API 负责列表/查询/启停。
- **技术栈以 TypeScript + Node.js（DSH 原生插件）为主**；MCP 可作为"第二形态"复用同一套 n8n 客户端逻辑，而非另起 Python 项目。
- 用户提及的 `dsh-n8n`、`dsh-hooks`、`@dsh-enhanced/event-triggers`、`dsh-plugin-create` 等**具体包名在本次公开检索中未能精确命中**，需人工核实（见第 6 节）。其中 `dsh-n8n` 是否已有现成实现，是决定"从零写还是 fork"的关键。

---

## 1. 现有项目对比分析表

| 项目 / 技术栈 | 核心功能 | 优点 | 缺点 | 对我们的借鉴意义 |
|---|---|---|---|---|
| **DeepSeek Harness (dsh)** `github.com/deepseek-ai/deepseek-harness` TypeScript / Cordis | Agent 运行时；"一切皆插件"，模型/工具/日志/Agent Loop 都是插件 | 插件能力边界极广；官方文档完善；`ctx.effect()` 自动清理；支持服务/依赖注入 | 版本较新（官方预览 `0.1.2-rc.1`）；插件生态早期；升级可能破坏性 | 我们的插件必须遵循 Cordis `apply(ctx)` 模型，用 `ctx.tools` / `ctx.effect` 注册与清理 |
| **dsh-github**（LvsH13）TypeScript | 一键把本地插件发布到 GitHub，自动加 `dsh-plugin` 话题、生成中英双语 README | 给出 DSH 插件发布的**标准姿势**；脚本可复用 | 只解决"发布"，不涉及 n8n 集成 | 后续复用其发布/话题规范，让 dsh-n8n-lg 更易被发现 |
| **awesome-deepseek-harness**（libukai）文档/清单 | 精选插件与工具清单、快速入门 | 快速摸清现有插件生态，避免重复造轮子 | 社区维护，可能滞后 | 发布前先在此核对是否已有同类 n8n 插件 |
| **dsh-n8n**（用户提及）— *未精确命中* | （待核实）疑似已有的 DSH × n8n 集成插件 | — | 公开检索未找到确切仓库 | **需人工核实**：是否已存在、做到什么程度、能否直接 fork（最大复用机会） |
| **dsh-hooks / @dsh-enhanced/event-triggers**（用户提及）— *未精确命中* | （待核实）通用 Webhook / 事件桥接 | — | 未找到确切包；但 DSH **确实支持与 Claude Code/Codex 协议兼容的 hooks** | 借鉴其"事件/钩子插件"机制，实现 n8n 回调唤醒 Agent |
| **n8n REST API** `/api/v1/*` + `X-N8N-API-KEY` | 列出/查看/启停工作流、查询/停止/重试执行 | 官方稳定接口；一个 API Key + scope 覆盖管理类操作；最适合程序调用 | **不含"触发新执行"端点**，触发需走 Webhook；不同版本端点有 `/rest` 与 `/api/v1` 差异 | 插件的"通信层"调它做列表/查询/启停；触发另走 Webhook |
| **n8n Webhook 机制** Webhook Trigger / Respond to Webhook / Wait-for-webhook | 工作流被 HTTP 触发；`responseMode: lastNode` 可同步返回结果；执行完可反向回调外部 URL | 天然双向；"Wait for webhook"可生成临时回调 URL，实现事件驱动 | 需在 n8n 侧每个工作流配置 Webhook/Respond 节点 | 实现"触发工作流"与"执行完自动唤醒 DSH Agent"的核心通道 |
| **n8n-mcp-server**（n8n-community）TypeScript / MCP | MCP 服务器，让 AI 助手用自然语言操作 n8n（列/触发/查状态） | 已验证"AI ↔ n8n"可行；工具划分清晰；社区活跃 | 是独立 MCP 服务，**非 DSH 原生插件**；引入额外进程 | 直接借鉴其工具清单与参数设计；也可作为我们插件的"第二形态"（MCP 出口） |
| **mcp-n8n-workflow-builder**（parakastha）Python / MCP | 用 `N8N_HOST=.../api/v1/` + `N8N_API_KEY` 环境变量连接 n8n | 验证了 env 注入凭据 + `/api/v1` 基址的通用模式 | Python，与 DSH 插件栈不一致 | 凭据注入方式可参考（环境变量 → 插件配置映射） |
| **n8n-workflow-builder-mcp**（ifmelate / n8n-community） | 类似上述 MCP 方案 | 多一个参考实现 | 与前者重复 | 横向对比取最优工具设计 |
| **n8n 官方 MCP / 工作流设计器 MCP**（社区/云） | 提供 `list_executions` / `get_execution` / `activate` / `deactivate` / `create_workflow` 等工具 | 工具覆盖度全，参数设计成熟 | 多为外部服务，非本地插件 | 工具粒度设计参考 |

> **关于"其他 AI Agent（Claude Code / OpenClaw）集成 n8n"**：未检索到以这两个名字直接发布的 n8n 集成仓库；但 n8n 官方文档明确其 Webhook/Hooks 与 **Claude Code/Codex 协议兼容**，社区 MCP 服务器（上表）是更直接的"双向通信"范例，建议直接借鉴。

---

## 2. 最优技术选型建议

### 2.1 通信方式：Webhook 触发 + 回调/查询（混合），避免纯轮询

| 方案 | 机制 | 优点 | 缺点 |
|---|---|---|---|
| 纯 REST 轮询 | 触发后不断 GET 执行状态直到完成 | 实现简单 | 长任务浪费请求、有延迟、需自管超时；**且公开 API 无法触发，仍需 Webhook** |
| Webhook 同步 | POST 工作流 Webhook URL，节点设 `responseMode: 'lastNode'` | 一次调用直接拿结果；对 Agent 最友好 | 受 HTTP 超时限制，仅适合短任务 |
| Webhook 双向回调 | Webhook `onReceived` 立即返回，工作流结束用 HTTP Request / `Respond to Webhook` 把结果推回 | 事件驱动、零轮询、可反向唤醒 Agent | n8n 侧工作流需加 Webhook/Respond 节点 |

**推荐**：**触发一律走 Webhook**（n8n 公开 API 没有触发端点，见第 2.4/3 节）。MVP 让工作流 Webhook 节点用 `responseMode: 'lastNode'` 实现**同步拿结果**；长任务用 `responseMode: 'onReceived'`（立即返回）+ 回调或 `n8n_get_execution_status` 查询。插件内部统一抽象为 `trigger(webhookPath, input, { mode: 'sync' \| 'async' })`，对 Agent 屏蔽底层差异。

### 2.2 技术栈：TypeScript + Node.js（DSH 原生插件）为主，MCP 为可选第二形态

- DSH 插件**必须用 TypeScript 编写**（Cordis 运行时），所以"用 Python 通过 MCP 实现"会得到**一个独立 MCP 服务器，而不是 DSH 插件**——这与"DSH 里的遥控器"定位不符，且额外引入 Python 运行时。
- **结论**：主体用 **TypeScript 实现 DSH 原生插件**，直接调用 n8n API/Webhook。若未来也要让非 DSH 的 Agent（Claude / OpenClaw）使用，可在同一插件内**额外起一个 MCP 出口**，复用同一套 n8n 客户端逻辑（参考 n8n-mcp-server）。即"**一套逻辑，两种入口**"。

### 2.3 插件架构：四层划分

1. **凭据管理层（Config / Secrets）**：在 DSH 插件配置中保存 n8n Base URL 与 API Key（借鉴 `N8N_HOST` / `N8N_API_KEY` 环境变量模式），运行期注入，绝不落日志。
2. **API 通信层（n8n Client）**：封装 n8n `/api/v1` 请求（listWorkflows / getExecution / publish / stop），统一 **`X-N8N-API-KEY`** 鉴权头、错误处理、超时、重试与速率限制；另封装 Webhook 触发调用。
3. **工具注册层（Tools）**：用 `ctx.tools.register(...)` 把能力暴露给 Agent，为每个工具定义 JSON Schema 入参/出参。
4. **UI 展示层（Panel）**：注册一个简单的 DSH Web UI 面板，列出工作流、提供触发按钮、展示最近执行的状态与结果，降低"盲调 API"的门槛。

### 2.4 n8n 触发机制（源码核验结论）

n8n 公开 API `/api/v1`（源码：`packages/cli/src/public-api/v1/handlers/*/spec/paths`）**只有管理类端点**，**没有触发新执行的端点**：

- Workflow：`getWorkflows` / `getWorkflow` / `createWorkflow` / `updateWorkflow` / `deleteWorkflow` / `activateWorkflow`（新路径 `POST /workflows/{id}/publish`）/ `deactivateWorkflow` / archive / transfer / tags / versions / test runs。
- Execution：`getExecutions` / `getExecution` / `deleteExecution` / `retryExecution` / `stopExecution` / `stopManyExecutions` / execution tags。
- 因此**触发新执行只能 POST 到工作流自身的 Webhook URL**：生产 `{N8N_BASE_URL}/webhook/{path}`（工作流需 active），测试 `{N8N_BASE_URL}/webhook-test/{path}`（默认端口 5678）。

---

## 3. dsh-n8n-lg 核心功能模块设计

建议实现 **5 个工具**，MVP 先落地前 3 个：

### T1. `n8n_list_workflows`
- **入参**：`{ active?: boolean, tags?: string, name?: string, limit?: number, cursor?: string }`
- **出参**：`{ workflows: [{ id, name, active, activeVersionId, tags, updatedAt }], nextCursor }`
- 对标 `GET /api/v1/workflows`（scope `workflow:list`）

### T2. `n8n_trigger_workflow`（核心，走 Webhook）
- **背景**：n8n 公开 API **没有触发端点**，触发只能 POST 到工作流的 Webhook URL。
- **入参**：`{ webhookPath: string, payload?: object, method?: 'POST' | 'GET', mode?: 'sync' | 'async', authHeader?: string }`
  - `mode: 'sync'` → 工作流 Webhook 节点设 `responseMode: 'lastNode'`（或 `responseNode` + Respond to Webhook），插件一次 POST 即拿到执行结果
  - `mode: 'async'` → 工作流 `responseMode: 'onReceived'`（立即 200），插件后续用 `n8n_get_execution_status` 或等回调
- **出参**：`{ ok, status, result? }`
- **安全**：`webhookPath` 必须在插件白名单内；Webhook 节点建议开启 Header 认证，插件用 `authHeader` 传递

### T3. `n8n_get_execution_status`
- **入参**：`{ executionId: string, includeData?: boolean }`
- **出参**：`{ executionId, status: 'new' | 'running' | 'success' | 'error' | 'canceled' | 'crashed' | 'waiting', startedAt, stoppedAt, data? }`
- 对标 `GET /api/v1/executions/{id}`（scope `execution:read`）

### T4. `n8n_get_workflow_detail`（可选）
- **入参**：`{ workflowId: string }`
- **出参**：`{ id, name, nodes: [...], connections: [...], active }`
- 帮助 Agent 在触发前理解工作流结构，避免瞎填参数

### T5. `n8n_configure`（凭据/白名单配置）
- **入参**：`{ baseUrl, apiKey, allowedWebhookPaths?, defaultMode? }`
- 写入 DSH 插件配置；`apiKey` 仅保存、不回显
- 建议作为首次使用的引导工具

---

## 4. 分阶段开发路线图

### 第一阶段（MVP）—— 打通最小闭环
- **脚手架**：用 `dsh plugin --profile web add` 或官方 create 生成插件骨架（具体生成器命令见第 6 节核实）。
- 实现**凭据管理层 + API 通信层**（仅 listWorkflows / webhook trigger(sync) / getExecution 三个调用）。
- 注册 **T1 / T2(sync) / T3** 三个工具。
- **验收**：Agent 能列工作流、POST 一个 Webhook 触发测试工作流并拿到结果。

### 第二阶段（完善）—— UI 面板与状态反馈
- 注册 **UI 面板**：工作流列表、一键触发、最近执行状态与时间线、结果预览。
- `n8n_configure` 配置向导 + API Key 安全存储 UI。
- 增加 **T4**、错误态友好提示、限流/超时处理。

### 第三阶段（进阶）—— n8n 执行完自动唤醒 DSH Agent
- 采用 **Webhook 回推**：插件在 DSH 侧暴露一个受保护的回调端点（或用 n8n Wait 临时 URL），n8n 工作流以 HTTP Request / `Respond to Webhook` 把结果推回。
- 利用 DSH 的 **Event/Hook 插件机制**（兼容 Claude Code/Codex 协议）在收到回调后向当前会话推送消息、恢复 Agent 执行，形成"触发 → 离开 → 被唤醒 → 继续"的闭环。
- 可选：在同一插件内暴露 **MCP 出口**，供其他 Agent 复用同一套 n8n 客户端。

---

## 5. 安全与风险提示

### 凭据管理
- **专用密钥**：在 n8n 为 dsh-n8n-lg 创建**专用 API Key**（非个人账户），按最小权限授予所需 scope（如 `workflow:list`、`execution:read`）；定期轮换。
- **存储位置**：仅保存在 DSH 插件配置（`~/.dsh` 内），用 DSH 的配置隔离机制；**绝不写进源码、不提交到仓库、不打印到日志**。可借鉴 `N8N_API_KEY` 环境变量注入模式。
- **传输**：所有请求走 HTTPS；公开 API 的 Key 仅出现在 **`X-N8N-API-KEY`** 请求头（不是 Bearer）。

### 防止 Agent 执行未授权 / 危险操作
- **白名单**：插件只允许触发配置中 `allowedWebhookPaths` 列出的 Webhook，默认拒绝一切；Agent 无法任意触发 n8n 的任意工作流。
- **危险操作确认**：对会改库、发消息、删数据的工作流，触发前要求用户/权限策略确认（可复用 DSH 的审批机制）。
- **实例绑定**：Base URL 固定为受信任的自托管 n8n，禁止指向未知公网实例。
- **超时与限流**：所有 API 调用设超时、并发上限，防止 Agent 失控刷爆 n8n。
- **隔离提示**：DSH 自身的 `dsh-workflow-worker-thread` 用 `worker_threads` + vm 上下文隔离脚本——这保护的是 DSH 内部脚本执行；若插件未来要执行从 n8n 拉回的不可信代码，同样必须放进隔离上下文，**不得在主线程 eval**。

---

## 6. 调研不确定项 & 需人工核实清单

以下问题公开检索未能定论，建议 Pystay 人工确认后再敲定方案：

1. **`dsh-n8n`**：是否已存在公开/私有仓库？做到什么程度？能否直接 fork 而非从零写？（**最关键的复用机会**）
2. ~~`dsh-plugin-create` / 官方脚手架命令~~ **已核验（2026-10-14，DSH 源码 + 官方发布文档）**：无需专门脚手架。插件就是一个 npm 包——`package.json` 声明 `dsh.bundle.patch` + 贡献一个 `cordis.patch.yml`（`insert: [{ id, name }]`）+ 构建后的 `lib/`，用 `dsh plugin --profile <name> add <pkg>` 安装，发布到 npm 后可被 DSH 桌面端插件市场搜到。详见《dsh-n8n-lg 适配 DSH 桌面端 技术方案》。
3. **`dsh-hooks` / `@dsh-enhanced/event-triggers`**：确切包名/仓库；确认其 hooks 是否就是"兼容 Claude Code/Codex 协议"的那套，以便第三阶段做回调唤醒。
4. **DSH 插件凭据安全存储机制**：当前版本对 API Key 是否有原生加密/secret 管理？需查官方"插件配置 / Secrets"文档，决定复用还是自建。
5. ~~n8n 触发端点与参数~~ **已核验（2026-10-14，n8n 2.44.0 源码）**：公开 API 无触发端点，触发走 Webhook；`responseMode: 'lastNode'` 可同步返回结果。详见《dsh-n8n-lg 适配 DSH 桌面端 技术方案》。
6. **n8n API Key 权限范围**：确认你版本支持的最小权限 scope，便于专用密钥的权限收敛。

---

*本报告为前期技术调研产出，未包含任何插件代码。下一步建议在核实第 6 节清单后，进入第一阶段 MVP 实现。*
