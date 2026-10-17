# 变更记录

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [0.4.0] - 未发布

### 变更（会影响现有调用方式）

- **`n8n_delete_workflow` 现在必须传 `confirm: true`**，否则直接拒绝执行。
  删除不可撤销，之前只在工具描述里写了「考虑先快照」—— 对 Agent 来说这只是一句
  它可能忽略的话。现在缺参数或传 `false` 都会报错，且**不会**真的删除。

### 新增

- **HTTP 层重试**：`GET` / `PUT` / `DELETE` 遇到 5xx 或网络错误会自动重试，
  默认最多 3 次（退避 300ms → 900ms）。`POST` **不重试** —— 创建工作流、
  重试执行这类请求不是幂等的，重发会多出一份。
  可用 `maxAttempts` / `retryBackoffMs` 调整，设 `maxAttempts: 1` 即关闭。
- `examples/hello-webhook.json`：可直接导入的最小示例（Webhook → Code），
  零凭据依赖，用来确认「装好了、能跑通」。

## [0.3.0] - 2026-10-16

### 新增

- **搭建会话与进度时间线**：`n8n_begin_build_session` / `n8n_get_build_session` /
  `n8n_set_build_session_state`。`n8n_add_nodes` 会按 `stepId` 把结果记到对应步骤上；
  暂停会话会**真的拦下**所有写操作（包括浮窗里点的「启用」），不是只画个图标。
- **凭据向导**：`n8n_check_credentials` 列出工作流缺哪些凭据、涉及哪些节点。
  只读凭据**类型**，不读取也不索要任何密钥；无法判断的节点归入 `unverified` 而不是误报缺失。
- **内嵌编辑器探测** `GET /embed-check`：n8n 拒绝被内嵌时返回原因，
  浮窗改为显示说明 + 「在系统浏览器打开」。

### 修复

- **浮窗内嵌编辑器一片空白**：n8n 2.43.5 对所有 HTML 路由返回
  `X-Frame-Options: SAMEORIGIN`，而浮窗跑在自定义协议 `dsh-app://app` 上、与 n8n 不同源，
  浏览器直接拒绝渲染。
  > 此前判断「n8n 没有这个头、可以内嵌」是错的 —— 当时用 `curl -I`（HEAD）探测，
  > 而 n8n 对 HEAD 返回 404、不带任何安全头。错的是探测方法。

## [0.2.0] - 2026-10-15

### 新增

- 写前校验、读回验证、自动快照与一步回滚：
  `n8n_validate_workflow` / `n8n_snapshot_workflow` / `n8n_restore_workflow`
- 增量加节点 `n8n_add_nodes`：`stepId` 幂等（重试不会加两遍）、
  并发写不丢更新、非 `main` 通道（如 `ai_languageModel`）合并不覆盖
- 浮窗编辑器改为按**宿主的连接地址**打开（之前用的是浏览器地址，实例不同就会打不开）
- 测试 145 → 197，含基于真实 DOM 的浮窗测试

### 修复

- 凭据错配
- E2E 假绿灯（测试没真正验证触发结果）
- 连线指向不存在的节点时，本地只给 warning、请求发出去才被 n8n 以
  `400 unknown_connection_target` 打回 —— 现在改为写前 error

## [0.1.0] - 2026-10-14

首个可用版本：工作流 CRUD、执行查询与重试/停止、Webhook 触发、玻璃 HUD 浮窗、
内嵌 n8n 编辑器、Docker 沙箱（默认 5679，避开本机 5678）。
