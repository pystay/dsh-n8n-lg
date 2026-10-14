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
| `baseUrl` | 是 | — | n8n 实例基址 |
| `apiKey` | 是 | — | n8n 公开 API Key（敏感，放入 `X-N8N-API-KEY`） |
| `webhookAuthHeader` / `webhookAuthValue` | 否 | — | Webhook 节点开启 Header 认证时的头名/值 |
| `allowedWebhookPaths` | 否 | `[]` | Webhook 路径白名单；**留空=放行全部**，生产建议显式配置（支持 `*` 通配） |
| `timeoutMs` | 否 | `30000` | 请求超时（毫秒） |
| `useTestWebhook` | 否 | `false` | 使用 `/webhook-test/` 路径（调试用） |

## 提供的工具

| 工具 | 对应 n8n 接口 |
|---|---|
| `n8n_list_workflows` | `GET /api/v1/workflows` |
| `n8n_get_workflow` | `GET /api/v1/workflows/{id}` |
| `n8n_trigger_workflow` | `POST {n8n}/webhook/{path}`（n8n 公开 API 无触发端点） |
| `n8n_get_execution_status` | `GET /api/v1/executions/{id}` |
| `n8n_list_executions` | `GET /api/v1/executions` |

参数名、取值语义与响应体均与 n8n 公开 API 保持一致，响应**原样透传**（不做字段改名/裁剪）。

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
