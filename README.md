# dsh-n8n-lg

[![npm version](https://img.shields.io/npm/v/dsh-n8n-lg.svg)](https://www.npmjs.com/package/dsh-n8n-lg)
[![license](https://img.shields.io/npm/l/dsh-n8n-lg.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/dsh-n8n-lg.svg)](https://nodejs.org)

> 一个给 **DeepSeek Harness (DSH)** 用的轻量 **n8n** 插件：
> 让 AI Agent 帮你**触发 / 监控 / 可视化搭建** n8n 工作流，并带一个**玻璃拟态浮窗**实时盯着 n8n。

![玻璃 HUD 浮窗](./docs/images/hud.png)

---

## 👋 写在前面（作者的话）

我是一名**刚上大学的计算机专业大一新生**，这是我课余时间自己摸索着写的一个小插件。

因为还在学习阶段，**代码和设计上一定有很多不成熟、甚至写错的地方**。如果你在使用的过程中发现了
问题、或者觉得哪里可以做得更好，**非常欢迎指出来**——Issues 和 PR 我都会认真看、虚心学习。

这个项目的初衷很简单：我自己在用 DSH 和 n8n，觉得"每次都要切窗口、手动点"很麻烦，
就想试试能不能让 AI 帮我管起来。能力有限，做得不好的地方还请各位前辈多多包涵 🙏

---

## 它能做什么

- 🔧 **14 个工具**：把 n8n 公开 API 的能力交给 AI Agent（列表 / 创建 / 改 / 删 / 启停 / 触发 / 查执行 / 重试 / 停止）。
- 🪟 **玻璃 HUD 浮窗**：界面右下角一个小玻璃球，点开就是 n8n 监控面板——看工作流状态、点一下就能触发、看最近执行。
- 🧩 **可视化搭建**：你只要**说出需求**，AI 会在 n8n 里**一个一个节点地搭**，同时浮窗**自动打开内嵌 n8n 编辑器**并随每次保存刷新，你能**全程看着工作流长出来**——不用自己 import `.json`。
- 🐳 **可选容器沙箱**：用 Docker 把 n8n 跑在隔离容器里（仅绑 `127.0.0.1`）。

---

## 演示

### 1. 玻璃 HUD 浮窗（监控 + 一键触发）

![玻璃 HUD 浮窗](./docs/images/hud.png)

### 2. 在 DSH 里内嵌 n8n 编辑器 —— AI 逐个节点搭建，你全程看着

![DSH 内嵌 n8n 编辑器](./docs/images/dsh-embedded-editor.jpg)

---

## 安装

### 方式一：在 DSH 桌面端的「插件」里添加（推荐）

1. 打开 **DSH 桌面端** → 左侧 **「插件」**
2. 搜索或直接填入包名 **`dsh-n8n-lg`** → 安装
3. **重启 DSH 桌面端**（bundle 变更需要重启才会加载）

### 方式二：命令行

```sh
# 装到某个 profile（桌面端用的是 desktop profile）
dsh plugin --profile desktop add dsh-n8n-lg
```

> 装完记得**重启对应 profile / DSH 桌面端**。

---

## 配置

在 profile 的 `cordis.patch.yml` 里给插件行提供配置（或在浮窗里直接填）：

```yaml
- id: n8n-lg
  name: dsh-n8n-lg
  config:
    baseUrl: 'http://127.0.0.1:5678'
    apiKey: 'YOUR_N8N_API_KEY'
    allowedWebhookPaths: ['deploy/*']   # 可选：Webhook 白名单
    timeoutMs: 30000
```

| 字段 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `baseUrl` | 否* | 沙箱端点 / `N8N_BASE_URL` | n8n 实例基址（*缺失时回退环境变量或沙箱端点） |
| `apiKey` | 否* | `N8N_API_KEY` | n8n 公开 API Key（**建议用环境变量，不要写进配置文件**） |
| `webhookAuthHeader` / `webhookAuthValue` | 否 | — | Webhook 节点开了 Header 认证时的头名/值 |
| `allowedWebhookPaths` | 否 | `[]` | Webhook 路径白名单；留空=放行全部，生产建议显式配置（支持 `*`） |
| `timeoutMs` | 否 | `30000` | 请求超时（毫秒） |
| `useTestWebhook` | 否 | `false` | 用 `/webhook-test/` 路径（调试用） |

> **关于密钥**：强烈建议把 API Key 放在环境变量 **`N8N_API_KEY`**（地址用 `N8N_BASE_URL`），
> 这样密钥完全不落配置文件、也不会被误提交到 Git。本项目**不会**把任何密钥写进仓库。

### 沙箱配置（可选，`sandbox.enabled: true`）

| 字段 | 默认 | 说明 |
|---|---|---|
| `sandbox.image` | `docker.n8n.io/n8nio/n8n:latest` | n8n 镜像 |
| `sandbox.containerName` | `dsh-n8n-lg` | 容器名 |
| `sandbox.hostPort` | `5679` | 宿主端口（仅绑 127.0.0.1，默认避开常见的 5678） |
| `sandbox.containerPort` | `5678` | 容器内端口 |
| `sandbox.dataVolume` | `dsh-n8n-lg-data` | 数据卷 |
| `sandbox.timezone` | `Asia/Shanghai` | 容器时区 |

---

## 在 DSH 里怎么用

插件是**工具（tool）**，**不需要把任何文档发给 DSH** —— 直接在对话里说需求，agent 会自动选用工具。

直接这样说就行：

- 「列出我的 n8n 工作流」
- 「查询 n8n 执行 `12345` 的状态」
- 「触发 webhook 路径是 `deploy` 的工作流，body 传 `{"env":"prod"}`」
- 「帮我做个工作流：收到 POST 请求后，把 body 里的 name 拼成问候语返回」

最后一句就是**可视化搭建**：AI 会建工作流 → 浮窗自动弹出内嵌编辑器 → 一个个加节点 → 连线 → 激活。

---

## 提供的工具（14 个）

| 工具 | 对应 n8n 接口 |
|---|---|
| `n8n_list_workflows` | `GET /api/v1/workflows` |
| `n8n_get_workflow` | `GET /api/v1/workflows/{id}` |
| `n8n_create_workflow` | `POST /api/v1/workflows` |
| `n8n_update_workflow` | `PUT /api/v1/workflows/{id}` |
| `n8n_delete_workflow` | `DELETE /api/v1/workflows/{id}` |
| `n8n_activate_workflow` | `POST /api/v1/workflows/{id}/publish`（回退 `/activate`） |
| `n8n_deactivate_workflow` | `POST /api/v1/workflows/{id}/deactivate` |
| `n8n_trigger_workflow` | `POST {n8n}/webhook/{path}`（n8n 公开 API 无触发端点） |
| `n8n_get_execution_status` | `GET /api/v1/executions/{id}` |
| `n8n_list_executions` | `GET /api/v1/executions` |
| `n8n_retry_execution` | `POST /api/v1/executions/{id}/retry` |
| `n8n_stop_execution` | `POST /api/v1/executions/{id}/stop` |
| `n8n_add_nodes` | 增量加节点/连线（**可视化搭建**核心：一次一步） |
| `n8n_open_editor` | 让玻璃浮窗**自动打开内嵌 n8n 编辑器** |

参数名、取值语义与响应体均与 n8n 公开 API 保持一致，响应**原样透传**（不做改名/裁剪）。

### 容器沙箱工具（`sandbox.enabled: true` 时额外注册）

| 工具 | 作用 |
|---|---|
| `n8n_sandbox_start` | 启动（不存在则创建），返回 endpoint |
| `n8n_sandbox_stop` | 停止容器 |
| `n8n_sandbox_status` | 状态 + `/healthz` 健康探测 |
| `n8n_sandbox_logs` | 读取容器日志 |
| `n8n_sandbox_remove` | 删除容器（保留数据卷，不丢数据） |

启用后沙箱会注册为 Cordis 服务 `ctx.n8nSandbox`，其他插件可 `inject: ['n8nSandbox']` 复用。

---

## 玻璃 HUD 浮窗

- **位置**：界面右下角的玻璃球（`n8n`），点开是监控面板，点 `—` 收起。
- **连接配置**：直接填 n8n 地址（默认 `http://127.0.0.1:5678`）与 API Key，点「保存」（存本地 `localStorage`）。
- **工作流**：列出工作流 + 启用状态；可「启用/停用」；带 Webhook 的显示「触发」按钮。
- **内嵌编辑器**：点「编辑」→ 面板变宽并内嵌 n8n 编辑器；AI 每保存一次自动刷新。
- **最近执行**：最近 8 条执行 + 状态徽章。
- **自动刷新**：每 5 秒轮询一次。

> 实现说明：n8n 的 API **不返回 CORS 头**，浏览器不能直连，所以浮窗的请求走插件 node 半在 DSH
> webServer 上注册的**同源代理路由** `/api/dsh-n8n-lg/*`，由服务端再去访问 n8n。
> 浮窗需要宿主提供 `webServer`（Web / 桌面端 profile 都有）；纯 headless profile 下浮窗不会挂载，但工具照常可用。

---

## 可视化搭建工作流

详细操作契约（含踩坑清单）见 [`docs/可视化搭建工作流.md`](./docs/可视化搭建工作流.md)。

一句话：**说需求 → AI 用 `n8n_create_workflow` 建空工作流 → `n8n_open_editor` 弹出编辑器 →
反复 `n8n_add_nodes` 一次加一步 → `n8n_activate_workflow` 激活 → 点「触发」试跑**。

---

## ⚠️ 注意事项

1. **必须重启才生效**：bundle 有变更时，需要重启对应 profile / DSH 桌面端。
2. **触发走 Webhook**：n8n 公开 API 没有触发端点，所以触发是 POST 到工作流自己的 Webhook。
   工作流里得有 **Webhook 节点**，并且**已激活**——否则会收到 404。
3. **激活后等几秒再触发**：n8n 注册 webhook 是**异步**的，激活后立刻触发可能 404，等 3–5 秒即可。
4. **`Manual Trigger` 不能激活工作流**：n8n 要求至少一个 Webhook / Schedule 之类的真触发器。
5. **同一工作流里 Webhook 路径不能重复**：否则 `publish` 报 `409 webhook path conflict`。
6. **`publish` 会校验节点配置与凭据**：缺参数或缺凭据都会 400（例如 Google Sheets 的 OAuth 凭据）。
7. **浮窗依赖 `webServer`**：纯 headless profile 下没有浮窗（工具仍可用）。
8. **沙箱需要 Docker**：`sandbox.enabled: true` 时 Docker 守护进程要在运行。
9. **`executeCommand` 节点在 n8n v2 默认被禁用**（安全考虑）。如果你的工作流要用它，
   需要给 n8n 设 `NODES_EXCLUDE=[]`。
10. **实测环境**：Windows + DSH 桌面端 + n8n 2.x。其他平台/版本我还没条件验证，欢迎反馈。

---

## 安全

- API Key 只存在 DSH 配置或环境变量里，**不落源码、不入日志**。
- `allowedWebhookPaths` 白名单可以限制 Agent 只能触发指定工作流。
- 沙箱容器**只绑定 `127.0.0.1`**，不对局域网暴露。

---

## 开发

```sh
npm install
npm test          # 单元测试（vitest）
npm run build     # 编译 TS + 打包客户端 bundle 到 lib/
```

---

## License

[MIT](./LICENSE)

---

## 最后

如果你觉得这个小插件还有点用，欢迎点个 ⭐；如果哪里做得不好，**请一定告诉我**，我会认真改。

—— 一名还在学习路上的大一学生
