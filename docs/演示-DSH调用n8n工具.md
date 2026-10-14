# 演示：DSH 调用 dsh-n8n-lg 操作本机 n8n

> 时间：2026-10-14
> 目的：核实 dsh-n8n-lg 是否已装在 DSH 桌面端，并**真跑一遍**证明可用。

---

## 一、检查结果：插件已装在桌面端

DSH 桌面端（Electron）启动的是 **`$DSH_HOME/profiles/desktop`** 这个 profile（源码 `resources/extracted-app/lib/main.js` 中写死 `profiles/desktop`，且该 profile 被 Electron 独占）。该 profile 中插件四要素齐全：

| 项 | 状态 |
|---|---|
| `package.json` dependencies | ✅ `dsh-n8n-lg: link:D:/dsh-n8n-lg` |
| `dsh.profile.bundles` | ✅ 含 `dsh-n8n-lg` |
| `node_modules/dsh-n8n-lg` | ✅ 软链 → `D:/dsh-n8n-lg` |
| `cordis.patch.yml` 配置 | ✅ 已写入 `baseUrl` + `apiKey` |

---

## 二、实测：无头任务真实调用成功

用**桌面端自带的运行时**（dsh 0.2.0-rc.2 + 其内置 node）跑了一次一次性任务：

```
"$NODE" "$DSHBIN" --profile headless \
  "调用 n8n_list_workflows 工具列出我的 n8n 工作流，并用一句话告诉我总共有几个"
```

（`$NODE` = 桌面端内置 node；`$DSHBIN` = 桌面端内置 dsh 的 `lib/bin.js`；
凭据通过环境变量 `N8N_BASE_URL` / `N8N_API_KEY` 注入，未落文件。）

**Agent 输出（节选）**：

> 你的 n8n 里共有 **3 个工作流**，全部处于未激活状态：
> `MythSleep 助眠神话视频生产线 v1.1（Agnes AI Agent 全程控制）`、
> `MVMaker Pipeline (DSH + n8n, no-UI)`、`MythSleep Story Video v2`
> （返回的 `nextCursor` 为 null，说明没有更多分页数据）。

即：DSH 的 agent 成功调用插件工具 → 插件请求本机 n8n 公开 API → 拿到真实数据并作答。**端到端打通。**

---

## 三、关键发现：本机存在两个 dsh 版本

| | 版本 | 凭据文件格式 | 位置 |
|---|---|---|---|
| **DSH 桌面端内置** | `0.2.0-rc.2` | 嵌套：`version: 1`(数字) + `refs:` + `records:` | `D:\DeepSeek_Harness\resources\extracted-app\dsh` |
| **全局 npm `dsh`** | `0.1.0-rc.7` | 扁平：直接 `KEY: value` | `%APPDATA%\npm\node_modules\@deepseek-ai\dsh` |

**影响**：`~/.dsh/.credentials.yaml` 是桌面端（新版）写的嵌套格式，**旧的全局 dsh 读不了**（会报 `version must be a string`）。因此：
- 用全局 `dsh` 只能做 `plugin add` 等不需要凭据的操作；
- 要**真实启动/运行**（跑 agent），必须用**桌面端内置的运行时**。

复现命令（用桌面端运行时）：
```
NODE="D:/DeepSeek_Harness/resources/runtime/primary-runtime/dependencies/node/bin/node.exe"
DSHBIN="D:/DeepSeek_Harness/resources/extracted-app/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js"
N8N_BASE_URL=http://127.0.0.1:5678 N8N_API_KEY=<key> \
NO_PROXY=127.0.0.1,localhost \
"$NODE" "$DSHBIN" --profile headless "<你的任务>"
```

---

## 四、注意事项

1. **依赖版本差异（低风险，实测兼容）**：桌面端 `@deepseek-ai/dsh-tools` 为 `0.2.0-rc.2`，插件本地 devDep 为 `0.0.1-rc.1`；`cordis`/`schemastery` 一致。实测工具注册与调用均正常。后续可考虑对齐 devDep 版本。
2. **`NO_PROXY` 必须设**：本机环境 `http_proxy` 会拦截 localhost，否则插件请求 `127.0.0.1:5678` 会失败。
3. **GUI 无法从本会话启动**：桌面端窗口需你手动双击 `D:\DeepSeek_Harness\DeepSeek Harness.exe`；本会话的沙箱不允许起 GUI 进程。
4. **演示用的 `headless` profile**：为跑演示，向 `~/.dsh/profiles/headless` 装了本插件（附加，不影响 `desktop`）。如不需要可 `dsh plugin --profile headless remove dsh-n8n-lg`。
