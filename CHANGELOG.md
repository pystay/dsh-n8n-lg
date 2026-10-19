# 变更记录

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [0.5.0] - 2026-10-20

### 新增：在画布上右键节点，用一句话让 AI 改它

n8n 拒绝被内嵌时，浮窗会画一张只读画布。现在这张画布不只是看的 —— **右键任意节点**，
写下你想怎么改（"把 URL 改成 …"、"method 换成 POST"、"加个重试"），回车即可交给 AI 执行。

**为什么浮窗不自己改**：浮窗跑在渲染进程里，没有 LLM，也不该直接写 n8n 库。
它只负责把需求描述清楚并**投递给 Agent**，由 Agent 用现有的 n8n 工具去改 ——
这样改法受和对话里完全一样的约束（先读后改、写前校验、自动快照、可回滚）。

**怎么打通的**：宿主提供了 `sessionController` 服务，它的
`prompt({ sessionId, requestId, content })` 能把一条用户消息投给 Agent。
插件的 `/health` 现在会返回 `aiBridge`，前端据此决定显示输入框还是提示不可用。

几个刻意的设计：

- **发给 Agent 的指令写死了边界**：「只改这一个节点、不要动其他节点、不要重排布局、
  改完校验」—— 否则 Agent 很容易顺手把整个工作流重写一遍；
- **会话挑最近的可用会话**（`agentAvailable` 为真、优先非空会话），插件没有
  「用户正在看哪个会话」的信息，这是能拿到的最接近的答案；只有一个对话时永远正确；
- **没有可用会话就明确报错**（409 + 中文原因），不静默失败；
- **切换工作流会收起未提交的需求**，避免发到另一个工作流上。

### 新增

- `GET /api/dsh-n8n-lg/health` 增加 `aiBridge`（宿主能否投递消息）与
  `sessionShape`（会话列表的结构，**只有键名和数量，不含任何会话内容**，排障用）。

### 已知限制

- 需求投递的**成功路径**只在单测里覆盖过：验证时起的是空 profile，没有真实会话，
  实际投递需要你在桌面端打开一个对话后试用。
- 如果 n8n 允许被内嵌（浮窗显示的是真编辑器），画布不显示，右键功能不适用 ——
  那种情况下直接用 n8n 自己的编辑器更好。

## [0.4.2] - 2026-10-19

### 轻量化

- **编译产物不再带注释**（`tsconfig` 加 `removeComments: true`）：
  `tgz 82.3 → 59.4 kB（-28%）`，解压 `262.6 → 207.3 kB（-21%）`，文件数不变（55）。

  一个开关同时作用在两个地方，收益比预期大：
  - `lib/*.js` **175.7 → 155.7 kB**（注释原本占 7–18%，我写的中文注释比较多）；
  - `lib/*.d.ts` **40.6 → 19.1 kB** —— 声明文件里的 JSDoc 也一起被去掉了。
    代价是 IDE 里看不到类型注释；但对「装进 DSH 运行的插件」来说没人会去读它。

  调试不受影响：本地构建仍生成 sourcemap（`lib/**/*.map` 发布时已排除），要看注释直接看源码。

  **累计**：`0.4.0 的 101.0 kB → 59.4 kB`，**-41%**。

### 检查过但没有可挖的

- **客户端 bundle 的 CSS**：34 个 `.dshn8n-*` 类名全部在用，没有死规则。
- **`.js` 主体**：155.7 kB 已是 tsc 产物（无注释、target ES2022 用原生 `??` / 可选链），没有可再压的冗余。
- **minify 客户端 bundle**：`client.js` gzip 后只有 14 kB（实测 DSH webServer 开了 gzip），
  minify 只省约 4 kB，却要引入 10 MB 的 esbuild —— 不划算。

## [0.4.1] - 2026-10-17

适配 DSH 桌面端 **0.2.1-rc.2**（上一版 0.2.0-rc.2 仍然兼容）。

### 修复

- **`JsonValue` 不再从 `@deepseek-ai/dsh-tools` 导出** —— 0.2.1-rc.2 把它挪到了
  `dsh-util-values`，`tsc` 直接报 `TS2614: has no exported member 'JsonValue'`。
  现在插件**自带这份类型定义**（标准递归 JSON 联合，与 DSH 的完全同构）：
  既不再依赖 dsh 的内部实现包（`dsh-util-values` 只是 `dsh-tools` 的传递依赖，
  pnpm 隔离布局下直接 import 不可靠），也同时兼容新旧两版 DSH。

### 变更

- devDependencies 对齐桌面端：`cordis` 4.0.5 / `dsh-tools` 0.2.1-rc.2 / `schemastery` 3.18.5
  （此前为 4.0.4 / 0.0.1-rc.1 / 3.18.4）。换用新版类型跑 `tsc`、并用新版运行时跑全部
  249 个测试，均通过。
- 文档：0.2.1-rc.2 把核心打进 `resources/app.asar`（不再解包到 `extracted-app`），
  包名 `@deepseek-ai/dsh` → **`@deepseek-ai/dsh-desktop-host`**，入口 `lib/bin.js` → `lib/cli.js`，
  CLI 统一走 `resources/runtime/cli/bin/dsh.cmd`。`docs/演示-DSH调用n8n工具.md` 已更新。

### 修复

- **`n8n_restore_workflow` 能救回被删除的工作流了**。之前 `restore` 直接走
  `updateWorkflow`，工作流一旦删除就 404 —— 而 `n8n_delete_workflow` 的描述还写着
  「先快照，也许还要拿回来」，是句空头承诺。现在检测到 404 就**按快照重建**
  （n8n 分配新 id，结果带 `recreated: true`）。
  浮窗的回滚提示也会明确说「已按快照重建（新 id：xxx）」，
  而不是让用户在列表里突然看到一个陌生条目、不知道它就是刚回滚的那个。
- **`/health` 增加 `persistenceBroken`**：目录不可写或磁盘满时，快照与会话实际只在内存里，
  之前从外部完全看不出来，容易误以为「落盘了所以重启还在」。
- 修掉三处「只在内存」的过时描述（0.4.0 已经持久化）：
  `README.md`、`docs/搭建会话与凭据向导.md`、以及 `n8n_snapshot_workflow` /
  `n8n_get_build_session` 的工具描述 —— 这类描述会直接误导 Agent 的决策。

### 轻量化

- 发布包**不再包含 sourcemap**：`tgz 99.5 kB → 75.5 kB（-24%）`，文件数 `79 → 43`，
  解压体积 `372 kB → 246 kB`。插件是运行时装进 DSH 的，sourcemap 在运行时不参与任何逻辑；
  需要调试请从源码 `npm run build`（本地构建仍会生成 map）。
  实测数据：sourcemap 原本占解压体积的 **34%**（126 kB / 36 个文件）。

### 重构（行为不变）

- `src/tools/index.ts` 从 **670 行**拆成 5 个按用途划分的模块：`workflows`（CRUD / 触发 / 启停）、
  `executions`（查询 / 重试 / 停止）、`build`（加节点 / 编辑器 / 校验 / 快照 / 恢复）、
  `sessions`（会话控制）、`credentials`（凭据向导）。`index.ts` 只剩 39 行编排。
  最大单文件 **670 → 236 行**。
  **代价**：发布包 `tgz 75.8 → 78.4 kB（+2.6 kB）`，文件 43 → 55（每个模块多一份 .js/.d.ts）。
  用 3% 的体积换可维护性 —— 如果你更在意体积，这一步可以合回去。
- 顺手修掉两处**过时文案**（0.4.0 已经持久化，但描述还写着只在内存）：
  `n8n_snapshot_workflow` 的「snapshots live in memory only, cleared on restart」、
  `n8n_get_build_session` 的「会话只存在内存中」。

## [0.4.0] - 2026-10-17

### 变更（会影响现有调用方式）

- **`n8n_delete_workflow` 现在必须传 `confirm: true`**，否则直接拒绝执行。
  删除不可撤销，之前只在工具描述里写了「考虑先快照」—— 对 Agent 来说这只是一句
  它可能忽略的话。现在缺参数或传 `false` 都会报错，且**不会**真的删除。

### 新增

- **快照与搭建会话落盘**：默认写到 `~/.dsh/n8n-lg/`（`snapshots.json` / `sessions.json`），
  插件重启后仍在 —— 之前是纯内存，重启等于回滚点和搭建进度一起丢。
  - 原子写（先写 `.tmp` 再 rename），文件损坏时退化为空而不是让插件崩；
  - 快照按 n8n 实例地址隔离，多 profile 连不同实例时不会互相覆盖；
  - 重启后遗留的 `running` 会话会被标成 `failed`（否则时间线永远卡在 running）；
    `paused` 的保持 `paused`，暂停能跨重启生效；
  - 可关：`persistState: false`；可改目录：`stateDir`。

- **HTTP 层重试**：`GET` / `PUT` / `DELETE` 遇到 5xx 或网络错误会自动重试，
  默认最多 3 次（退避 300ms → 900ms）。`POST` **不重试** —— 创建工作流、
  重试执行这类请求不是幂等的，重发会多出一份。
  可用 `maxAttempts` / `retryBackoffMs` 调整，设 `maxAttempts: 1` 即关闭。
- **只读画布**：n8n 拒绝被 iframe 内嵌时，浮窗改为**自绘 SVG 画布**
  （`GET /api/dsh-n8n-lg/workflows/{id}/canvas`）。节点用圆角矩形、连线用贝塞尔曲线，
  AI 通道虚线、禁用节点半透明。画布数据只含节点名/短类型/坐标/连线 ——
  节点参数（可能有 URL、内联数据、凭据引用）一个字节都不给前端。
  实测三个真实工作流：体积 31KB → 8.5KB（压掉 72.8%）。
- `examples/hello-webhook.json`：可直接导入的最小示例（Webhook → Code），
  零凭据依赖，用来确认「装好了、能跑通」。

### 工程

- 接入测试覆盖率（`npm run coverage`）。首次接入就发现 **`src/config.ts`、
  `src/index.ts`、`src/tools/sandbox.ts` 是 0%** —— 插件装配路径（schema 默认值、
  `apply()` 注册了什么、沙箱工具挂没挂上）完全没有回归保护。已补 14 个测试，
  行覆盖 **88.79% → 94.75%**，测试 204 → 218。

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
