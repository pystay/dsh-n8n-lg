# dsh-n8n-lg 适配 DSH 桌面端 技术方案（n8n 源码核验版）

> 生成时间：2026-10-14
> 依据：n8n 2.44.0 源码（浅克隆 `third_party/n8n`）+ DSH-Desktop v2.2.4 README + DSH 官方插件文档
> 关联：《dsh-n8n-lg 技术调研与架构设计报告》（本方案修正其两处错误假设）

---

## 一、本次产出

1. **已浅克隆 n8n 源码**到 `third_party/n8n`（**D 盘，未占用 C 盘**）：
   - 仓库：`github.com/n8n-io/n8n`，分支 `master`，`--depth 1`（浅克隆，仅最新快照）
   - 版本：**2.44.0**，HEAD `d68ad7e9`
   - 用途：核验公开 API 端点与 Webhook 触发机制（作为插件的"事实依据"）
2. 基于源码**核验并修正**了初版报告的两处错误（见第五节）。

> 网络备注：本机 git 全局代理 `127.0.0.1:7897` 已失效，实际可用代理为环境变量中的 `127.0.0.1:60830`。克隆时用 `git -c http.proxy=...` 临时覆盖，**未改动你的全局 git 配置**。若希望我顺手把全局代理改到可用端口，请告知。

---

## 二、n8n 侧权威核验结论（来自 2.44.0 源码）

### 2.1 公开 API `/api/v1`
- **鉴权**：请求头 **`X-N8N-API-KEY: <key>`**（**不是** `Authorization: Bearer`；Bearer 是内部 `/rest` 接口的用法）。
- **权限**：按 scope 授权，例如 `workflow:list`、`execution:list`、`execution:read`、`workflow:activate`。

### 2.2 可用端点（源码：`packages/cli/src/public-api/v1/handlers/*/spec/paths`）

| 资源 | 操作 | 说明 |
|---|---|---|
| Workflow | `GET /api/v1/workflows` | 列工作流（query: `active`/`tags`/`name`/`limit`/`cursor`/`projectId`/`excludePinnedData`） |
| Workflow | `GET /api/v1/workflows/{id}` | 取工作流详情 |
| Workflow | `POST /api/v1/workflows` / `PUT|PATCH /workflows/{id}` / `DELETE` | 增改删 |
| Workflow | `POST /api/v1/workflows/{id}/publish` | 启用（旧 `/activate` 已 deprecated） |
| Workflow | `POST /api/v1/workflows/{id}/deactivate` | 停用 |
| Workflow | archive / unarchive / transfer / tags / versions / test runs | 归档、迁移、标签、版本、评测 |
| Execution | `GET /api/v1/executions` | 列执行（query: `status`(new/running/success/error/canceled/crashed/waiting)、`workflowId`、`includeData`、`limit`、`cursor`…） |
| Execution | `GET /api/v1/executions/{id}` | 取执行详情（query: `includeData`、`redactExecutionData`） |
| Execution | `POST /api/v1/executions/{id}/retry` / `.../stop` / stopMany / delete | 重试、停止、删除 |

> **关键结论：公开 API 没有"触发/运行工作流"的端点。** 能做的只有管理类操作（启停、重试、查询、停止）。触发必须另辟通道。

### 2.3 Webhook 触发机制（推荐主通道）
- **URL**：
  - 生产：`{N8N_BASE_URL}/webhook/{path}`（要求工作流 **active**）
  - 测试：`{N8N_BASE_URL}/webhook-test/{path}`（默认端口 `5678`）
- **响应模式**（Webhook 节点 `responseMode`，源码 `nodes-base/nodes/Webhook/description.ts`）：
  - `onReceived`（默认）：**立即**返回，拿不到执行结果 → 适合异步触发
  - `lastNode`：**等最后一个节点执行完再响应** → 适合**同步**拿结果（我们的 sync 模式）
  - `responseNode`：由工作流中的 **Respond to Webhook** 节点决定何时/返回什么 → 精细控制同步响应
- **认证**：Webhook 节点可开启认证（None / Basic / Header）→ 插件用 Header token 调用，避免裸奔。

### 2.4 反向回调（n8n → DSH）
- 工作流内用 **HTTP Request 节点**把结果 POST 回 DSH 插件的本地回调端点；或用 **Wait 节点**的 "Wait for webhook" 生成临时 URL 作为回调地址。这是"执行完自动唤醒 Agent"的落点。

---

## 三、DSH 桌面端结构（来自 DSH-Desktop v2.2.4）

```
DSH-Desktop/
├── app/                  ← 程序本体（Electron 43 + React 19 + TS 5.9）
├── workspace/            ← 工作文件夹（整包拷走即可迁移）
│   ├── runtime/          ← 内置便携 Node / npm / pnpm / Git / dsh
│   ├── data/             ← DSH 数据目录（对话 / 设置 / 凭据，DSH 原生管理）
│   ├── skills/           ← 技能
│   ├── themes/           ← 主题插件
│   ├── backups/          ← 备份
│   └── logs/             ← 日志
└── DSH-Desktop.exe
```

关键行为（README 明确）：
- 核心工作台**内嵌 DSH 完整服务 Web 界面**（模型 / 会话 / API Key 由 DSH 原生管理）。
- 有「**Skill 管理**」：插件 / 技能**双市场**，联网搜索安装、已安装管理。
- **确认 Skill/插件安装后 DSH 热加载即可调用**（v2.2.4）。
- 异地同步覆盖技能/插件/知识/会话，**明确"凭据除外"**。
- 桌面端**强制 `--no-open` 并拦截 webview 新窗口**，禁止自动打开外部浏览器。
- dsh 服务端口被占**自动顺延**；客户端**动态解析 dsh 启动入口、不覆盖已有配置**。

---

## 四、适配方案：把 dsh-n8n-lg 落到 DSH 桌面端

> 核心判断：**无需为桌面端单独定制**。DSH 桌面端是"Electron 壳 + 内嵌 DSH 完整服务"，只要做成**标准 DSH 插件**，桌面端即可承载。适配工作集中在下面 7 个点。

| # | 适配点 | 做法 |
|---|---|---|
| 1 | **插件形态** | 标准 Cordis 插件（TypeScript，`apply(ctx)`）。与 Web 版共用同一份产物，不为桌面端分叉。 |
| 2 | **安装方式** | 首选走桌面端「Skill 管理 → 插件市场」联网安装；或放入工作文件夹后由 DSH **热加载**（无需重启）。发布时用 `dsh-github` 那套（加 `dsh-plugin` 话题 + 双语 README）便于被市场检索。 |
| 3 | **凭据管理** | n8n Base URL + API Key 交给 **DSH 原生配置/数据机制**（落在 `workspace/data/`）。桌面端同步**明确排除凭据**，天然不随 Git 泄露。插件**不自行落盘明文**、不打日志。 |
| 4 | **UI 面板** | 面板必须渲染在 **DSH Web UI 内**（桌面端以 webview 内嵌）。**不要依赖打开外部浏览器**（桌面端 `--no-open` + 拦截新窗口）——所有展示走 webview 内路由/面板。 |
| 5 | **回调端口** | 桌面端 dsh 服务端口**被占会自动顺延** → 插件的本地回调端点必须**动态获取自身 host:port**，不能硬编码 5678/3080 之类。 |
| 6 | **运行时/依赖** | 桌面端内置便携 Node/pnpm → 插件应**编译为纯 JS**、避免原生依赖，发布产物自带 `dist`，做到"装完即用、无需额外安装步骤"。 |
| 7 | **升级兼容** | 桌面端"动态解析 dsh 入口 + 不覆盖已有配置" → 插件用**标准 cordis 配置块**声明配置即可平滑升级，不要写死路径。 |

### 4.1 适配后的通信矩阵

| 动作 | 通道 | 鉴权 | 备注 |
|---|---|---|---|
| 列工作流 | `GET {n8n}/api/v1/workflows` | `X-N8N-API-KEY` | scope `workflow:list` |
| 查执行 | `GET {n8n}/api/v1/executions/{id}` | `X-N8N-API-KEY` | scope `execution:read` |
| 启停工作流 | `POST {n8n}/api/v1/workflows/{id}/publish` | `X-N8N-API-KEY` | scope `workflow:activate` |
| **触发（同步）** | `POST {n8n}/webhook/{path}` | 可选 Header 认证 | Webhook 节点 `responseMode: lastNode` |
| **触发（异步）** | `POST {n8n}/webhook/{path}` | 可选 Header 认证 | `onReceived` 立即返回，后续查执行 |
| **反向唤醒** | n8n HTTP Request 节点 → 插件本地回调 | 自定义 token | 端口动态获取 |

### 4.2 与桌面端"工作文件夹"的对应

- 插件本体 → 由「Skill 管理」安装，落到 DSH 插件目录（工作文件夹内由 DSH 管理）。
- 插件配置/凭据 → `workspace/data/`（DSH 原生，随工作文件夹迁移；Git 同步排除）。
- 插件日志 → 归入 `workspace/logs/`（便于用桌面端"设置 → 高级 → 日志"导出排查）。

---

## 五、对初版报告的修正

| 位置 | 原稿（错误） | 修正后（源码核验） |
|---|---|---|
| 触发方式 | `POST /api/v1/workflows/{id}/execute?waitTillFinish=true` | **该端点不存在**；改为 `POST {n8n}/webhook/{path}` + `responseMode: lastNode` |
| 鉴权头 | `Authorization: Bearer` | 公开 API 用 **`X-N8N-API-KEY`**（Bearer 是内部 `/rest`） |
| API 能力 | "列出/查看/**触发**工作流" | 公开 API 仅管理类（列表/查询/启停/重试/停止），**不含触发** |

其余结论（四层架构、工具划分、路线图、安全策略）**不变**。

---

## 六、仍需你人工确认

1. **DSH 桌面端插件安装的确切目录/来源**：建议在桌面端「Skill 管理」里点一个已装插件，看它落在 `workspace/` 下哪个子目录、以什么清单（如 `dsh.bundle` / plugin manifest）声明——决定我们的打包格式。
2. **DSH 插件是否有原生 secret 存储**：决定 API Key 是复用 DSH 机制还是插件自建（初版报告第 6 节第 4 条）。
3. **你实际 n8n 实例的版本与 scope 体系**：确认你的 API Key 能开哪些 scope，以及 Webhook 节点认证方式（None/Basic/Header）——决定 `authHeader` 设计。

---

## 七、下一步建议

1. 在桌面端「Skill 管理」确认插件安装格式（第 6.1 条），随后**生成插件骨架**。
2. MVP 三个工具：`n8n_list_workflows` + `n8n_trigger_workflow`(Webhook, sync) + `n8n_get_execution_status`。
3. 用一个最小 n8n 测试工作流（Webhook `lastNode` + 返回 JSON）联调，验证"一次 POST 拿结果"。
4. 通过后按 AGENTS.md 规则补测试并提交。

---

*本方案为适配设计文档，未包含插件代码。n8n 源码位于 `third_party/n8n`（已加入 .gitignore，不入库）。*
