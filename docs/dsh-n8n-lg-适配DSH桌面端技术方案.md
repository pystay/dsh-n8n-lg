# dsh-n8n-lg 适配 DSH 桌面端 技术方案（n8n + DSH 源码核验版）

> 生成时间：2026-10-14
> 依据：n8n 2.44.0 源码（`third_party/n8n`）+ DSH-Desktop v2.2.4 源码（`third_party/DSH-Desktop`，重点 `src/main/plugins.ts`）+ DSH 官方插件文档
> 关联：《dsh-n8n-lg 技术调研与架构设计报告》（本方案修正其两处错误假设）
> 说明：DSH 桌面端**只有"插件"概念，没有"Skill"**——本方案统一用"插件"表述。

---

## 一、本次产出

1. **浅克隆 n8n 源码** → `third_party/n8n`（版本 2.44.0，master，`--depth 1`）
2. **浅克隆 DSH-Desktop 源码** → `third_party/DSH-Desktop`（v2.2.4），用于核验桌面端的插件安装机制
3. **核验出 DSH 插件的打包 / 安装 / 加载格式**（本方案核心，见第二节）
4. 修正初版报告两处错误（见第六节）

> 两者均在 **D 盘**，已加入 `.gitignore` 不入库。
> 网络备注：git 全局代理 `127.0.0.1:7897` 已失效，实际可用代理是环境变量里的 `127.0.0.1:60830`；克隆时用 `git -c http.proxy=...` 临时覆盖，**未改你的全局配置**。

---

## 二、DSH 插件到底是什么：打包 / 安装 / 加载格式 ★核心

DSH 插件 = **一个 npm 包**；分发单位叫 **bundle**。结论来自官方发布文档 + DSH-Desktop `plugins.ts` 注释（"已从 dsh-app-boot / @deepseek-ai/dsh 源码核实"）。

### 2.1 两个概念

| 概念 | 是什么 | 由谁声明 |
|---|---|---|
| **bundle** | 一个承载配置层的 npm 包，"这个包贡献了什么" | 包的 `package.json` 里 `dsh.bundle` |
| **profile** | `$DSH_HOME/profiles/<name>` 下的可运行组合，"哪些 bundle 按什么顺序拼起来" | profile 的 `package.json` 里 `dsh.profile` |

### 2.2 一个 bundle 的最小结构

```
dsh-n8n-lg/
├── package.json        # 声明 dsh.bundle
├── cordis.patch.yml    # 该 bundle 贡献的 patch 层
└── lib/index.js        # 插件入口（apply(ctx)）
```

`package.json`：

```json
{
  "name": "dsh-n8n-lg",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "files": ["lib", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

`cordis.patch.yml`（**插件行按"包名"引用**，而非源码路径，这样 Node 能解析到已安装的代码）：

```yaml
- insert:
    - id: n8n-lg
      name: dsh-n8n-lg
```

> 注意：**没有 `dsh.bundle` 声明的包仍可安装，但只当普通依赖**——`dsh plugin` 会警告且不激活任何层。所以我们的包**必须**声明 `dsh.bundle`。

### 2.3 安装命令

```sh
dsh plugin --profile <name> add <spec>
```

- `<spec>` 可以是 `./本地目录`、`github:you/repo`、或 **npm 包名**（`dsh plugin add dsh-n8n-lg`）。
- 该命令把参数转发给 profile 目录下的 **pnpm**；成功后因包声明了 `dsh.bundle`，dsh 会把它追加进 `dsh.profile.bundles`。
- profile 的 `package.json` / `cordis.patch.yml` 由 `dsh plugin` 自动创建维护，不用手写。

### 2.4 层叠顺序（后层逐行获胜）

生效配置从空根开始，按顺序应用：

1. profile `dsh.profile.bundles` 里的每个 bundle patch（`@deepseek-ai/dsh-base` 最先）
2. profile 自己的 `cordis.patch.yml`
3. **home 级 `$DSH_HOME/cordis.patch.yml`**（机器级偏好，优先级高于单个 profile 层）
4. 每个 `--patch <path>` 覆盖层（按 argv 顺序）

> 关键：patch **整体替换目标行的 `config`**（不是按 key 深合并）；要覆盖某行必须重写它需要的**所有** key。

### 2.5 重启边界

- `dsh plugin add/remove`（pnpm 操作）改变磁盘清单与 bundle 列表，但**正在运行的 profile 保留启动时的 bundle 集合 → 增删/更新 bundle 后必须重启该 profile**。
- 而普通编辑 profile 或 home 级 `cordis.patch.yml` **走热加载**。

### 2.6 分发方式

| 方式 | 说明 | 注意 |
|---|---|---|
| **npm 发布**（推荐） | 构建好 `lib/` 后 `pnpm publish`，用户装到预构建代码 | 无需用户在安装期执行构建，最安全 |
| git 安装 | `dsh plugin --profile x add github:you/repo` | 拿到的是**源码**，`build` 不执行 → 需 `prepare` 脚本；pnpm ≥10 还要 `allowBuilds` 放行（=允许该包在安装时在你的机器上执行代码，有风险，需固定 commit） |
| tarball | 预构建产物打包分发 | 同样无需构建权限 |

---

## 三、n8n 侧权威核验结论（n8n 2.44.0 源码）

### 3.1 公开 API `/api/v1`
- **鉴权头**：`X-N8N-API-KEY: <key>`（**不是** Bearer；Bearer 是内部 `/rest`）。
- **scope**：`workflow:list` / `execution:list` / `execution:read` / `workflow:activate` 等。

### 3.2 可用端点（`packages/cli/src/public-api/v1/handlers/*/spec/paths`）

| 资源 | 操作 |
|---|---|
| Workflow | `GET /api/v1/workflows`、`GET /workflows/{id}`、`POST /workflows`、`PUT|PATCH /workflows/{id}`、`DELETE`、`POST /workflows/{id}/publish`（启用，旧 `/activate` 已弃用）、`POST /workflows/{id}/deactivate`、archive/unarchive/transfer/tags/versions/test-runs |
| Execution | `GET /api/v1/executions`、`GET /executions/{id}`、`POST /executions/{id}/retry`、`POST /executions/{id}/stop`、stopMany、`DELETE`、execution tags |

> **关键结论：公开 API 没有"触发/运行工作流"的端点。** 触发必须走工作流自身的 Webhook。

### 3.3 Webhook 触发机制（主通道）
- URL：生产 `{n8n}/webhook/{path}`（工作流需 active）；测试 `{n8n}/webhook-test/{path}`（默认端口 5678）。
- `responseMode`（`nodes-base/nodes/Webhook/description.ts`）：
  - `onReceived`（默认）：立即返回 → 异步触发
  - `lastNode`：**等最后节点跑完再响应** → **同步拿结果**（我们的 sync 模式）
  - `responseNode`：由 **Respond to Webhook** 节点控制响应 → 精细同步
- Webhook 节点可开认证（None / Basic / Header）。

### 3.4 反向回调（n8n → DSH）
工作流内用 HTTP Request 节点把结果 POST 回插件的本地回调端点（或用 Wait 节点的 "Wait for webhook" 临时 URL）。

---

## 四、DSH 桌面端结构 + 它的插件机制（源码核验）

### 4.1 工作文件夹

```
DSH-Desktop/
├── app/                    程序本体（Electron 43 + React 19 + TS 5.9）
└── workspace/              工作文件夹（整包可迁移）
    ├── runtime/            内置便携 Node / npm / pnpm / Git / dsh
    ├── data/               = $DSH_HOME（对话 / 设置 / 凭据，DSH 原生管理）
    │   ├── cordis.patch.yml      ← home 级用户补丁层
    │   └── profiles/
    │       ├── web/              ← web profile（package.json + dsh.profile.bundles）
    │       └── node_modules/     ← in-box 插件扁平回退目录
    ├── skills/  themes/  backups/  logs/
    └── ...
```

### 4.2 桌面端安装插件的确切做法（`src/main/plugins.ts`）

- 桌面端"插件市场"= 搜 **npmmirror**（`registry.npmmirror.com`）→ 安装走 **`dsh plugin --profile web add <pkg>`**（用内置便携 Node 执行）。
- **启用机制**：追加 `$DSH_HOME/cordis.patch.yml`（即 `workspace/data/cordis.patch.yml`）的 `{ insert: [{ id, name }] }` 条目即可加载；声明了 `dsh.bundle` 的包会自动并入 `dsh.profile.bundles` 层。
- 桌面端自带的 dsh「插件」设置页**只做已加载插件的配置编辑，不做安装**——安装由桌面端的插件市场/本模块负责。
- 安装后**需重启 profile**（桌面端重启 dsh 服务）才会加载新的 bundle。

> 因此：**要能被桌面端插件市场搜到，就要发布到 npm**（npmmirror 会镜像）；本地/git 安装也可用。

---

## 五、适配方案：把 dsh-n8n-lg 做成一个 DSH 插件

> 核心判断：**无需为桌面端单独定制**。做成**标准 DSH bundle 插件**，桌面端与 Web 版共用同一份产物。

### 5.1 打包格式（落地）
1. 仓库产出：`package.json`（声明 `dsh.bundle.patch`）+ `cordis.patch.yml`（insert 我们的插件行）+ 构建后的 `lib/`。
2. 入口用 Cordis 标准形态：`export const name = 'n8n-lg'; export function apply(ctx: Context) { ... }`，用 `ctx.tools.register(...)` 注册工具。
3. **发布到 npm**（`dsh-n8n-lg` 或 `@yourscope/dsh-n8n-lg`）→ 桌面端插件市场可搜到、可一键装。

### 5.2 七个适配点（修正用词后）

| # | 适配点 | 做法 |
|---|---|---|
| 1 | **插件形态** | 标准 Cordis 插件（TS，`apply(ctx)`），打成 npm bundle，不为桌面端分叉 |
| 2 | **安装方式** | 桌面端**插件市场**搜索安装（故需发布 npm）；或 `dsh plugin --profile web add dsh-n8n-lg`；装后**重启 dsh 服务**加载 |
| 3 | **凭据管理** | n8n Base URL + API Key 走 DSH 配置（存 `workspace/data/`）。桌面端同步**明确排除凭据**，天然不泄露；插件不落明文、不打日志 |
| 4 | **UI 面板** | 面板渲染在 **DSH Web UI 内**（桌面端 webview 内嵌）；桌面端**强制 `--no-open` 且拦截新窗口**，不要依赖打开外部浏览器 |
| 5 | **回调端口** | 桌面端 dsh 服务端口**被占自动顺延** → 回调端点**动态取自身 host:port**，不硬编码 |
| 6 | **运行时/依赖** | 桌面端内置便携 Node/pnpm → 插件**编译为纯 JS**、避免原生依赖，产物自带 `lib`，装完即用 |
| 7 | **升级兼容** | 桌面端"动态解析 dsh 入口 + 不覆盖已有配置" → 用**标准 cordis 配置块**，不写死路径 |

### 5.3 适配后的通信矩阵

| 动作 | 通道 | 鉴权 | 备注 |
|---|---|---|---|
| 列工作流 | `GET {n8n}/api/v1/workflows` | `X-N8N-API-KEY` | scope `workflow:list` |
| 查执行 | `GET {n8n}/api/v1/executions/{id}` | `X-N8N-API-KEY` | scope `execution:read` |
| 启停工作流 | `POST {n8n}/api/v1/workflows/{id}/publish` | `X-N8N-API-KEY` | scope `workflow:activate` |
| **触发（同步）** | `POST {n8n}/webhook/{path}` | 可选 Header 认证 | Webhook 节点 `responseMode: lastNode` |
| **触发（异步）** | `POST {n8n}/webhook/{path}` | 可选 Header 认证 | `onReceived` 立即返回，后续查执行 |
| **反向唤醒** | n8n HTTP Request → 插件本地回调 | 自定义 token | 端口动态获取 |

---

## 六、对初版报告的修正

| 位置 | 原稿（错误） | 修正后（源码核验） |
|---|---|---|
| 触发方式 | `POST /api/v1/workflows/{id}/execute?waitTillFinish=true` | **该端点不存在**；改为 `POST {n8n}/webhook/{path}` + `responseMode: lastNode` |
| 鉴权头 | `Authorization: Bearer` | 公开 API 用 **`X-N8N-API-KEY`**（Bearer 是内部 `/rest`） |
| API 能力 | "列出/查看/**触发**工作流" | 公开 API 仅管理类（列表/查询/启停/重试/停止），**不含触发** |
| 插件安装格式 | "待核实" | **已核验**：npm bundle + `dsh.bundle.patch` + `cordis.patch.yml` + `dsh plugin add` |
| 概念用词 | 桌面端"Skill 管理" | 桌面端**只有"插件"**；安装/加载走插件机制 |

其余结论（四层架构、工具划分、路线图、安全策略）**不变**。

---

## 七、仍需你人工确认

1. **是否把 dsh-n8n-lg 发布到 npm**：这决定桌面端插件市场能否搜到它（否则只能本地/git 安装）。
2. **你实际 n8n 实例的版本与 scope 体系**：确认 API Key 可开哪些 scope、Webhook 节点认证方式（None/Basic/Header）——决定 `authHeader` 设计。
3. **DSH 配置是否加密**：插件配置落在 `workspace/data`（已随桌面端同步排除凭据），但 API Key 是明文还是加密存储，建议在桌面端"设置"里确认。

---

## 八、下一步建议

1. **生成插件骨架**：`package.json`（`dsh.bundle`）+ `cordis.patch.yml` + `src/index.ts`，构建产出 `lib/`。
2. MVP 三个工具：`n8n_list_workflows` + `n8n_trigger_workflow`(Webhook, sync) + `n8n_get_execution_status`。
3. 用一个最小 n8n 测试工作流（Webhook `lastNode` 返回 JSON）联调，验证"一次 POST 拿结果"。
4. 按 AGENTS.md 规则补测试并提交。

---

*本方案为适配设计文档，未包含插件代码。n8n 与 DSH-Desktop 源码位于 `third_party/`（已加入 .gitignore，不入库）。*
