# dsh-n8n-lg：DSH 内置「n8n 容器沙箱」设计

> 生成时间：2026-10-14
> 依据：DSH 源码（`@deepseek-ai/dsh-sandbox` 契约）+ n8n 2.44.0 + 本机环境勘察
> 状态：设计 + 第一版实现（已实现 `src/sandbox/docker.ts` 与 4 个沙箱工具，42 个测试通过）

---

## 一、目标

在 DSH 里内置一个**独立的沙箱**，用它作为容器来运行 n8n——即：

- n8n 跑在**隔离的容器**里，与宿主环境解耦；
- 由 DSH 插件统一**启停 / 查看状态 / 读日志 / 健康检查**；
- 插件的 n8n 工具（触发、查询等）指向这个沙箱实例。

---

## 二、为什么不用 DSH 自带的 `ctx.sandbox`

DSH 确实有沙箱子系统（`dsh-sandbox` + `dsh-sandbox-local` / `dsh-sandbox-windows-acl` / `dsh-bash-sandbox` / `dsh-sandbox-policy`），但读其服务定义可知：

> "Service Definition for the **same-world process-confinement** capability seam … **Containers, microVMs, and remote execution replace the surrounding capability seam instead**; this service shares the host kernel and filesystem."
> —— `@deepseek-ai/dsh-sandbox/lib/types/index.d.ts`

也就是说，`ctx.sandbox` 是**同宿主进程沙箱**（bwrap / Landlock / Seatbelt / Windows ACL 的文件策略约束），**容器/微VM 是另一套能力**。

**结论**：要实现"用容器跑 n8n"，需要新建一个**容器沙箱能力**，而不是复用 `ctx.sandbox`。本设计即实现该能力（当前以模块形式内置于 dsh-n8n-lg，见第六节可提升为独立 Service）。

---

## 三、架构

```
dsh-n8n-lg 插件
├── src/sandbox/docker.ts      ← 容器沙箱能力（DockerSandbox）
│     ├─ buildRunArgs()         构造 docker run argv（纯函数，可测）
│     ├─ start/stop/status()    生命周期（docker inspect / run / start / stop）
│     ├─ logs()                 读日志
│     └─ health()               GET {endpoint}/healthz
├── src/tools/sandbox.ts       ← 沙箱工具（n8n_sandbox_*）
└── src/n8n/client.ts          ← 指向沙箱实例的 n8n 客户端（baseUrl = 沙箱 endpoint）
```

关键设计：
- **命令执行器可注入**（`CommandRunner`）——`DockerSandbox` 只构造 `docker` argv，实际执行可替换，因此在**没有 Docker 守护进程**时也能完整单测（已覆盖 13 个用例）。
- **仅绑定回环地址** `127.0.0.1`，不暴露到局域网/公网。
- **数据落命名卷**（`dsh-n8n-lg-data:/home/node/.n8n`），容器重建不丢数据。

---

## 四、容器规格（`docker run` 参数）

插件自动生成如下 argv（节选）：

```
docker run -d --name dsh-n8n-lg \
  -p 127.0.0.1:5678:5678 \
  -v dsh-n8n-lg-data:/home/node/.n8n \
  --restart unless-stopped \
  -e N8N_HOST=127.0.0.1 \
  -e N8N_PORT=5678 \
  -e N8N_PROTOCOL=http \
  -e N8N_SECURE_COOKIE=false \
  -e GENERIC_TIMEZONE=Asia/Shanghai \
  docker.n8n.io/n8nio/n8n:latest
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `image` | `docker.n8n.io/n8nio/n8n:latest` | 可换官方镜像 tag |
| `containerName` | `dsh-n8n-lg` | 容器名 |
| `hostPort` | `5678` | 宿主端口（**仅绑 127.0.0.1**） |
| `containerPort` | `5678` | 容器内 n8n 端口 |
| `dataVolume` | `dsh-n8n-lg-data` | 命名卷 |
| `timezone` | `Asia/Shanghai` | `GENERIC_TIMEZONE` |
| `extraEnv` | — | 额外环境变量（代码级，透传） |

---

## 五、生命周期与工具

| 工具 | 行为 |
|---|---|
| `n8n_sandbox_start` | 不存在→`docker run`；存在但停止→`docker start`；返回 endpoint + 健康探测 |
| `n8n_sandbox_stop` | `docker stop`（保留容器与数据卷） |
| `n8n_sandbox_status` | `docker inspect` 取状态 + `/healthz` 探测 |
| `n8n_sandbox_logs` | `docker logs --tail N` |

状态判定：`docker inspect -f {{.State.Status}}`，退出码非 0 视为"容器不存在"。

---

## 六、前置条件与首次使用流程

**前置条件（本机现状）**：
- ✅ Docker 已安装（Docker 29.7.2）
- ⚠️ **Docker 守护进程当前未启动**（`npipe:////./pipe/dockerDesktopLinuxEngine` 连不上）→ 需先启动 Docker Desktop
- ⚠️ **WSL 被本机安全策略禁用**（`wsl.exe` 在程序黑名单）→ 若 Docker Desktop 用 WSL2 后端会受影响；可改用 Hyper-V 后端，或解除黑名单

**首次使用**：
1. 启动 Docker Desktop（守护进程就绪）；
2. 在插件 config 打开 `sandbox.enabled: true`；
3. 让 Agent 调 `n8n_sandbox_start`（或手动 `docker run`）拉起 n8n；
4. 浏览器打开 `http://127.0.0.1:5678` 完成 owner 初始化，并在 **Settings → API** 创建 API Key；
5. 把 Key 填入插件 config 的 `apiKey`，`baseUrl` 设为 `http://127.0.0.1:5678`；
6. 之后 Agent 即可用 n8n 工具触发/监控沙箱内的工作流。

> 说明：n8n 的公开 API Key 需在 UI 中创建（n8n 不提供纯 CLI 建 Key 的方式），因此第 4 步是必要的人工环节。

---

## 七、安全

- **网络**：容器端口只绑 `127.0.0.1`，不对外暴露。
- **数据**：命名卷持久化；卸载容器不影响卷。
- **凭据**：API Key 存 DSH 配置（不入源码/日志）；Webhook 可开 Header 认证。
- **触发白名单**：`allowedWebhookPaths` 限制 Agent 只能触发指定工作流。
- **隔离**：n8n 及其工作流执行都在容器内，与宿主进程/文件系统解耦。

---

## 八、进阶方向

1. **提升为独立 Cordis Service**：把 `DockerSandbox` 注册为 `ctx.n8nSandbox`（Service Definition/Provider/Consumer 分层），供其他插件复用，并可作为 `dsh-sandbox` 的"容器 Provider"补充。
2. **远程/多实例**：`DOCKER_HOST` 指向远程 Docker，或在同一宿主跑多个命名沙箱。
3. **rootless / 替代运行时**：支持 rootless Docker 或 Podman（需先解除 WSL 限制或改用 Hyper-V）。
4. **自动化 owner 初始化**：探索用 n8n CLI/环境变量预置 owner 与 API Key，减少人工步骤。
5. **沙箱内执行 DSH 侧命令**：把 `docker exec` 暴露为受控工具（谨慎，需白名单）。

---

## 九、现状与下一步

- ✅ 已实现：`DockerSandbox`（构造/生命周期/日志/健康）+ 4 个沙箱工具 + 13 个单测；全套 **42 个测试通过**，`tsc` 构建通过。
- ⏭️ 待做：启动 Docker 守护进程后做一次**真实容器端到端**（`n8n_sandbox_start` → UI 建 Key → 触发一个 Webhook 工作流）。
- ⏭️ 可选：把沙箱提升为 `ctx.n8nSandbox` 服务（第八节第 1 条）。
