# dsh-n8n-lg

轻量级 **DeepSeek Harness (DSH)** 插件：在你的 AI Agent 里触发并监控 **n8n** 工作流。
定位是 DSH 里的「遥控器」——只做触发与查询，不重造 n8n 执行引擎。

## 为什么

n8n 公开 API（`/api/v1`）**没有触发工作流的端点**，只有管理类操作（列表 / 查询 / 启停 / 重试 / 停止）。
所以本插件：

- **触发** → POST 到工作流自身的 **Webhook URL**（`{n8n}/webhook/{path}`）；
- **列表 / 查询执行** → 走 n8n 公开 API（鉴权头 `X-N8N-API-KEY`）。

若工作流的 Webhook 节点把 `responseMode` 设为 `lastNode`（或 `responseNode` + Respond to Webhook），
一次调用即可**同步拿到执行结果**。

## 安装

作为 DSH bundle 安装到某个 profile（桌面端也可在其「插件市场」搜索安装）：

```sh
dsh plugin --profile web add dsh-n8n-lg
```

安装后**重启该 profile**（桌面端重启 dsh 服务）以加载新的 bundle。

## 配置

在 profile 的 `cordis.yml` / `cordis.patch.yml` 中为插件行提供配置：

```yaml
- insert:
    - id: n8n-lg
      name: dsh-n8n-lg
      config:
        baseUrl: 'https://n8n.example.com'
        apiKey: 'YOUR_N8N_API_KEY'
        allowedWebhookPaths: ['deploy/*']
        timeoutMs: 30000
        useTestWebhook: false
```

| 字段 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `baseUrl` | 否* | 沙箱端点 / `N8N_BASE_URL` | n8n 实例基址（*缺失时回退环境变量或沙箱端点） |
| `apiKey` | 否* | `N8N_API_KEY` | n8n 公开 API Key（敏感；**建议用环境变量，不写入配置文件**） |
| `webhookAuthHeader` / `webhookAuthValue` | 否 | — | Webhook 节点开启 Header 认证时的头名/值 |
| `allowedWebhookPaths` | 否 | `[]` | Webhook 路径白名单；**留空=放行全部**，生产建议显式配置（支持 `*` 通配） |
| `timeoutMs` | 否 | `30000` | 请求超时（毫秒） |
| `useTestWebhook` | 否 | `false` | 使用 `/webhook-test/` 路径（调试用） |

### 沙箱配置（`sandbox`）

| 字段 | 默认 | 说明 |
|---|---|---|
| `sandbox.enabled` | `false` | 是否注册沙箱工具 |
| `sandbox.image` | `docker.n8n.io/n8nio/n8n:latest` | n8n 镜像 |
| `sandbox.containerName` | `dsh-n8n-lg` | 容器名 |
| `sandbox.hostPort` | `5679` | 宿主端口（仅绑 127.0.0.1；默认避开常见的 5678） |
| `sandbox.containerPort` | `5678` | 容器内端口 |
| `sandbox.dataVolume` | `dsh-n8n-lg-data` | 数据卷 |
| `sandbox.timezone` | `Asia/Shanghai` | 容器时区 |

> **密钥卫生**：`apiKey` 建议通过环境变量 **`N8N_API_KEY`** 提供（`baseUrl` 可用 `N8N_BASE_URL`），
> 这样密钥完全不落配置文件、也不会被误提交到 Git。本项目**不会**把任何密钥写入仓库（见 `AGENTS.md`）。

## 在 DSH 里怎么用

插件是**工具**（tool），**不需要把任何文档发给 DSH** —— 直接在对话里提需求，agent 会自动选用对应工具。

**前置条件**
1. n8n 正在运行（本机默认 `http://127.0.0.1:5678`）。
2. 插件已装进目标 profile，并**重启该 profile / DSH 桌面端**（bundle 有变更时必须重启才会加载）。
3. profile 配置里有 `baseUrl` + `apiKey`（或环境变量 `N8N_BASE_URL` / `N8N_API_KEY`）。

**直接这样说就行（示例）**
- 「列出我的 n8n 工作流」
- 「查询 n8n 执行 `12345` 的状态」
- 「触发 webhook 路径为 `deploy` 的工作流，body 传 `{"env":"prod"}`」
- 「在 n8n 新建一个工作流：Webhook 触发 → 返回 `hello`」

> 触发走的是工作流的 **Webhook 节点**：该节点要配好路径，且工作流需**已激活**（可用 `n8n_activate_workflow`）。

## 玻璃 HUD（桌面端 / Web 端浮窗）

插件还带一个**玻璃拟态浮窗**，用于实时监控与快速触发，无需通过对话。

- **位置**：界面右下角的玻璃球（`n8n`），点击展开为监控面板，再点 `—` 收起。
- **连接配置**：面板内直接填 **n8n 地址**（默认 `http://127.0.0.1:5678`，可自定义）与 **API Key**，点「保存」（存本地 `localStorage`）。
- **工作流**：列出工作流 + 启用状态；每个工作流可「启用/停用」；带 Webhook 节点的工作流显示「触发」按钮（快速启动）。
- **最近执行**：显示最近 8 条执行及状态徽章。
- **自动刷新**：每 5 秒轮询一次。

> 实现说明：n8n 的 API **不返回 CORS 头**，浏览器不能直连，因此 HUD 的请求走插件 node 半在 DSH webServer 上注册的**同源代理路由** `/api/dsh-n8n-lg/*`（服务端再去访问 n8n）。
> 该浮窗需要宿主提供 `webServer`（Web / 桌面端 profile 都有）；纯 headless profile 下浮窗不会挂载，但工具照常可用。

## 提供的工具
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

参数名、取值语义与响应体均与 n8n 公开 API 保持一致，响应**原样透传**（不做字段改名/裁剪）。

### 容器沙箱工具（可选，`sandbox.enabled: true` 时注册）

用 Docker 把 n8n 跑在隔离容器里（仅绑 `127.0.0.1`，数据落命名卷）：

| 工具 | 作用 |
|---|---|
| `n8n_sandbox_start` | 启动（不存在则创建，已停止则 start），返回 endpoint |
| `n8n_sandbox_stop` | 停止容器 |
| `n8n_sandbox_status` | 状态 + `/healthz` 健康探测 |
| `n8n_sandbox_logs` | 读取容器日志 |
| `n8n_sandbox_remove` | 删除容器（保留数据卷，不丢数据） |

启用沙箱后，插件会把沙箱注册为 Cordis 服务 **`ctx.n8nSandbox`**，其他插件可 `inject: ['n8nSandbox']` 复用。`n8n_sandbox_start` 会在启动后轮询 `/healthz` 直到 n8n 就绪。

> 详见 [`docs/dsh-n8n-lg-n8n沙箱设计.md`](./docs/dsh-n8n-lg-n8n沙箱设计.md)。前置条件：Docker 守护进程需已启动。

## 安全

- API Key 仅存于 DSH 配置，不落源码、不入日志；DSH 桌面端同步时**排除凭据**。
- `allowedWebhookPaths` 白名单可限制 Agent 只能触发指定工作流。
- 所有请求走 HTTPS。

## 开发

```sh
npm install
npm test          # 运行单元测试
npm run build     # 编译到 lib/
```

## License

MIT
