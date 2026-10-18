/**
 * HUD 服务端路由：把 n8n 请求代理给浏览器端 UI。
 *
 * 为什么需要中转：n8n 的 API 不返回 CORS 头，浏览器（DSH Web UI）不能直接 fetch。
 * 因此由本插件的 node 半在 DSH 的 webServer 上注册一个前缀路由
 * `/api/dsh-n8n-lg/*`，同源请求即可，服务端再去访问 n8n。
 *
 * 连接信息**只有一份来源**（{@link ConnectionManager}）：浮窗保存的连接会写进
 * 运行时覆盖，AI 工具与浮窗因此永远指向同一个 n8n 实例。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ConnectionManager } from '../connection.js'
import { normalizeBaseUrl } from '../connection.js'
import { N8nApiError } from '../n8n/client.js'
import { buildCanvas } from '../n8n/canvas.js'
import { analyzeCredentials } from '../n8n/credentials.js'
import { WorkflowEditor, validateWorkflow } from '../n8n/editor.js'
import { isWebhookPathAllowed } from '../n8n/guard.js'
import { sessions, summarizeSession, type SessionStatus } from '../n8n/session.js'
import { snapshots } from '../n8n/snapshots.js'

/** webServer 服务的最小结构（避免依赖 dsh-host-webserver 的类型包）。 */
export interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

export const HUD_ROUTE_PREFIX = '/api/dsh-n8n-lg'

/** 请求体上限：HUD 只会发小 JSON，超出的直接拒绝。 */
const MAX_BODY_BYTES = 256 * 1024

/** HUD 当前"聚焦"的工作流（AI 搭建时用它让浮窗自动打开内嵌编辑器）。 */
export interface HudFocus {
  workflowId: string | null
  /** 每次设置都自增，客户端据此判断"有新指令"。 */
  rev: number
  /** 提示语（可选），例如"正在搭建：Webhook → 过滤 → 回复"。 */
  note?: string
}

export interface HudDeps {
  manager: ConnectionManager
}

/**
 * HUD 的"聚焦"状态（模块级单例）。
 * 工具侧调用 {@link setHudFocus} 让浮窗自动打开内嵌编辑器；浮窗轮询 GET /focus 感知变化。
 */
export const hudFocus: HudFocus = { workflowId: null, rev: 0 }

export function setHudFocus(workflowId: string | null, note?: string): HudFocus {
  hudFocus.workflowId = workflowId
  if (note !== undefined) hudFocus.note = note
  hudFocus.rev += 1
  return hudFocus
}

/** 工作流的节点数量（n8n 列表响应里带 nodes）。 */
function nodeCountOf(w: unknown): number {
  const nodes = (w as { nodes?: unknown }).nodes
  return Array.isArray(nodes) ? nodes.length : 0
}

/** 从节点列表里提取 Webhook 路径（用于 UI 的"快速触发"按钮）。 */
function extractWebhooks(nodes: unknown): Array<{ path: string; method: string }> {
  if (!Array.isArray(nodes)) return []
  const out: Array<{ path: string; method: string }> = []
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    const n = node as { type?: unknown; parameters?: { path?: unknown; httpMethod?: unknown } }
    if (n.type !== 'n8n-nodes-base.webhook') continue
    const path = typeof n.parameters?.path === 'string' ? n.parameters.path : ''
    if (!path) continue
    const method = typeof n.parameters?.httpMethod === 'string' ? n.parameters.httpMethod.toUpperCase() : 'POST'
    out.push({ path, method })
  }
  return out
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(text)
}

/** 读取请求体；超过上限时中断连接并抛出可识别错误。 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', (err) => reject(err))
  })
}

/** 解析 JSON 请求体；非法 JSON 抛错（由外层统一转成 400）。 */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req)
  if (!raw.trim()) return {}
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('请求体必须是 JSON 对象')
  }
  return parsed as Record<string, unknown>
}

/**
 * 注册 HUD 路由；返回 disposer（插件卸载时移除路由）。
 */
export function registerHudRoutes(webServer: WebServerLike, deps: HudDeps): () => void {
  const { manager } = deps
  // 与工具层共用同一个闸门：会话暂停时，HUD 触发的写入同样被拦下
  const editor = new WorkflowEditor(manager, {
    blockReason: (workflowId) => sessions.pausedReason(workflowId)
  })

  return webServer.register({
    kind: 'prefix',
    path: HUD_ROUTE_PREFIX,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const sub = url.pathname.slice(HUD_ROUTE_PREFIX.length) || '/'

      try {
        // ---- 不依赖 n8n 连接的路由 ----

        if (sub === '/health' && req.method === 'GET') {
          // 持久化坏掉（目录不可写、磁盘满）时，快照与会话实际只在内存里 ——
          // 让调用方能看出来，而不是以为「落盘了所以重启还在」。
          const persistenceBroken = snapshots.persistenceBroken || sessions.persistenceBroken
          return sendJson(res, 200, { ok: true, ...manager.status(), persistenceBroken })
        }

        // 连接状态（脱敏）与运行时覆盖
        if (sub === '/config' && req.method === 'GET') {
          return sendJson(res, 200, {
            ok: true,
            ...manager.status(),
            overridden: manager.hasRuntime(),
            allowedWebhookPaths: manager.config.allowedWebhookPaths ?? [],
            useTestWebhook: Boolean(manager.config.useTestWebhook)
          })
        }
        if (sub === '/config' && req.method === 'POST') {
          const body = await readJson(req)
          const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl : ''
          const apiKey = typeof body.apiKey === 'string' ? body.apiKey : ''
          if (!apiKey.trim()) {
            return sendJson(res, 400, { ok: false, error: '请填写 n8n API Key' })
          }
          let normalized: string
          try {
            normalized = normalizeBaseUrl(baseUrl)
          } catch (err) {
            return sendJson(res, 400, {
              ok: false,
              error: err instanceof Error ? err.message : String(err)
            })
          }
          // 地址与密钥成对保存：绝不出现「新地址 + 旧密钥」的组合
          manager.setRuntime({ baseUrl: normalized, apiKey: apiKey.trim() })
          return sendJson(res, 200, { ok: true, ...manager.status(), overridden: true })
        }
        if (sub === '/config' && req.method === 'DELETE') {
          manager.clearRuntime()
          return sendJson(res, 200, { ok: true, ...manager.status(), overridden: false })
        }

        // 聚焦状态：让浮窗自动打开某个工作流的内嵌编辑器（无需 n8n 连接）
        if (sub === '/focus' && req.method === 'GET') {
          return sendJson(res, 200, { ok: true, ...hudFocus })
        }
        if (sub === '/focus' && req.method === 'POST') {
          const body = await readJson(req)
          const workflowId = typeof body.workflowId === 'string' ? body.workflowId : null
          const note = typeof body.note === 'string' ? body.note : undefined
          return sendJson(res, 200, { ok: true, ...setHudFocus(workflowId, note) })
        }

        // ---- 以下都需要 n8n 连接 ----

        if (!manager.status().configured) {
          return sendJson(res, 200, {
            ok: false,
            configured: false,
            error: '尚未配置 n8n 地址或 API Key'
          })
        }

        // 探测 n8n 是否允许被内嵌（iframe 的 X-Frame-Options / CSP frame-ancestors）
        //
        // 为什么要在服务端探测：浮窗页面跑在自定义协议（桌面端是 dsh-app://app）上，
        // 与 n8n 不同源；若 n8n 返回 X-Frame-Options 或限制 frame-ancestors，
        // 浏览器会直接拒绝渲染 → 用户只会看到一片空白，且前端**无法**读取跨域响应头来判断原因。
        if (sub === '/embed-check' && req.method === 'GET') {
          const conn = manager.resolve()
          if (!conn) {
            return sendJson(res, 200, {
              ok: false,
              configured: false,
              embeddable: false,
              reason: '尚未配置 n8n 连接'
            })
          }
          const workflowId = url.searchParams.get('workflowId')
          const base = conn.baseUrl.replace(/\/+$/, '')
          const target = workflowId
            ? `${base}/workflow/${encodeURIComponent(workflowId)}`
            : `${base}/home/workflows`
          try {
            // 必须用 GET：n8n 对 HEAD 返回 404，那种响应里没有安全头（曾因此误判为可内嵌）
            const probe = await fetch(target, {
              method: 'GET',
              redirect: 'manual',
              headers: { Accept: 'text/html' },
              signal: AbortSignal.timeout(8000)
            })
            const xfo = probe.headers.get('x-frame-options') ?? ''
            const csp = probe.headers.get('content-security-policy') ?? ''
            const ancestors = /frame-ancestors([^;]*)/i.exec(csp)?.[1]?.trim() ?? ''

            let reason: string | undefined
            if (xfo) {
              reason = `n8n 返回 X-Frame-Options: ${xfo}，浏览器会拒绝在浮窗里渲染它`
            } else if (ancestors && ancestors !== '*' && !ancestors.split(/\s+/).includes('*')) {
              reason = `n8n 的 CSP 限制了 frame-ancestors：${ancestors}`
            }
            return sendJson(res, 200, {
              ok: true,
              embeddable: !reason,
              reason,
              url: target,
              status: probe.status
            })
          } catch (err) {
            return sendJson(res, 200, {
              ok: true,
              embeddable: false,
              reason: `无法探测 n8n 页面：${err instanceof Error ? err.message : String(err)}`,
              url: target
            })
          }
        }

        // 工作流列表（分页 + webhook 元数据）
        if (sub === '/workflows' && req.method === 'GET') {
          const limitRaw = Number(url.searchParams.get('limit') ?? '100')
          const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 250) : 100
          const list = await manager.client().listWorkflows({
            limit,
            cursor: url.searchParams.get('cursor') ?? undefined
          })
          const data = (list.data ?? []).map((w) => ({
            id: w.id,
            name: w.name,
            active: w.active,
            activeVersionId: w.activeVersionId ?? null,
            updatedAt: w.updatedAt,
            nodeCount: nodeCountOf(w),
            webhooks: extractWebhooks((w as { nodes?: unknown }).nodes)
          }))
          return sendJson(res, 200, { ok: true, data, nextCursor: list.nextCursor ?? null })
        }

        // 执行列表
        if (sub === '/executions' && req.method === 'GET') {
          const limitRaw = Number(url.searchParams.get('limit') ?? '8')
          const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100) : 8
          const list = await manager.client().listExecutions({
            limit,
            workflowId: url.searchParams.get('workflowId') ?? undefined
          })
          const data = (list.data ?? []).map((e) => ({
            id: e.id,
            status: e.status,
            workflowId: e.workflowId,
            startedAt: e.startedAt,
            stoppedAt: e.stoppedAt
          }))
          return sendJson(res, 200, { ok: true, data })
        }

        // 触发（快速启动）：支持方法、查询串与自定义 payload
        if (sub === '/trigger' && req.method === 'POST') {
          const body = await readJson(req)
          const path = typeof body.webhookPath === 'string' ? body.webhookPath : ''
          if (!path) return sendJson(res, 400, { ok: false, error: '缺少 webhookPath' })
          if (!isWebhookPathAllowed(path, manager.config.allowedWebhookPaths)) {
            return sendJson(res, 403, { ok: false, error: `Webhook 路径不在白名单内或路径不安全：${path}` })
          }
          const query =
            body.query && typeof body.query === 'object' && !Array.isArray(body.query)
              ? Object.fromEntries(
                  Object.entries(body.query as Record<string, unknown>).map(([k, v]) => [k, String(v)])
                )
              : undefined
          const result = await manager.client().triggerWebhook(path, body.payload ?? {}, {
            test: typeof body.test === 'boolean' ? body.test : manager.config.useTestWebhook,
            method: typeof body.method === 'string' ? body.method : undefined,
            query
          })
          return sendJson(res, 200, { ok: true, result })
        }

        // 校验工作流（写之前体检）
        const validateMatch = /^\/workflows\/([^/]+)\/validate$/.exec(sub)
        if (validateMatch && req.method === 'GET') {
          const id = decodeURIComponent(validateMatch[1] as string)
          const wf = (await manager.client().getWorkflow(id)) as unknown as {
            nodes?: unknown
            connections?: unknown
          }
          const issues = validateWorkflow(wf.nodes, wf.connections)
          return sendJson(res, 200, {
            ok: issues.every((i) => i.level !== 'error'),
            errors: issues.filter((i) => i.level === 'error').length,
            warnings: issues.filter((i) => i.level === 'warning').length,
            issues
          })
        }

        // 快照：列出 / 记录 / 恢复（回滚）
        const snapshotMatch = /^\/workflows\/([^/]+)\/snapshots$/.exec(sub)
        if (snapshotMatch && req.method === 'GET') {
          const id = decodeURIComponent(snapshotMatch[1] as string)
          return sendJson(res, 200, {
            ok: true,
            snapshots: editor.listSnapshots(id).map((s) => ({
              id: s.id,
              reason: s.reason,
              createdAt: s.createdAt,
              nodeCount: Array.isArray(s.nodes) ? s.nodes.length : 0
            }))
          })
        }
        if (snapshotMatch && req.method === 'POST') {
          const id = decodeURIComponent(snapshotMatch[1] as string)
          const snap = await editor.capture(id, 'HUD 手动快照')
          return sendJson(res, 200, { ok: true, snapshotId: snap.id, createdAt: snap.createdAt })
        }
        const restoreMatch = /^\/workflows\/([^/]+)\/restore$/.exec(sub)
        if (restoreMatch && req.method === 'POST') {
          const id = decodeURIComponent(restoreMatch[1] as string)
          const body = await readJson(req)
          const snapshotId = typeof body.snapshotId === 'string' ? body.snapshotId : undefined
          return sendJson(res, 200, await editor.restore(id, snapshotId))
        }

        // 搭建会话：时间线数据 + 暂停/恢复控制
        if (sub === '/session' && req.method === 'GET') {
          const workflowId = url.searchParams.get('workflowId') ?? undefined
          const session = workflowId
            ? sessions.activeFor(workflowId) ?? sessions.latest(workflowId)
            : sessions.list().at(-1)
          if (!session) return sendJson(res, 200, { ok: true, session: null })
          return sendJson(res, 200, { ok: true, session, progress: summarizeSession(session) })
        }
        if (sub === '/session/state' && req.method === 'POST') {
          const body = await readJson(req)
          const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
          const state = body.state as SessionStatus
          const allowed: SessionStatus[] = ['running', 'paused', 'completed', 'cancelled', 'failed']
          if (!sessionId) return sendJson(res, 400, { ok: false, error: '缺少 sessionId' })
          if (!allowed.includes(state)) {
            return sendJson(res, 400, { ok: false, error: `state 必须是 ${allowed.join(' / ')} 之一` })
          }
          const note = typeof body.note === 'string' ? body.note : undefined
          const session = sessions.setStatus(sessionId, state, note)
          if (state === 'cancelled' || state === 'failed') sessions.skipPending(sessionId, note)
          return sendJson(res, 200, { ok: true, session, progress: summarizeSession(session) })
        }

        // 凭据向导：激活前看看还缺什么（只读元数据，不涉及任何密钥）
        const credMatch = /^\/workflows\/([^/]+)\/credentials$/.exec(sub)
        if (credMatch && req.method === 'GET') {
          const id = decodeURIComponent(credMatch[1] as string)
          const wf = (await manager.client().getWorkflow(id)) as unknown as { nodes?: unknown }
          let available: string[] = []
          let scopeWarning: string | undefined
          try {
            const list = await manager.client().listCredentials({ limit: 100 })
            available = (list.data ?? []).map((c) => c.type).filter(Boolean)
          } catch (err) {
            scopeWarning =
              '无法列出已有凭据（API Key 可能缺少 credential:list 权限）：' +
              (err instanceof Error ? err.message : String(err))
          }
          const base = manager.resolve()?.baseUrl.replace(/\/+$/, '')
          const report = analyzeCredentials(wf.nodes, available, base ? `${base}/home/credentials` : undefined)
          return sendJson(res, 200, { ...report, scopeWarning })
        }

        // 画布数据：n8n 拒绝被 iframe 内嵌（X-Frame-Options），浮窗改为自绘。
        // 只回节点坐标/短类型/连线，不带节点参数（可能含 URL、内联数据）。
        const canvasMatch = /^\/workflows\/([^/]+)\/canvas$/.exec(sub)
        if (canvasMatch && req.method === 'GET') {
          const id = decodeURIComponent(canvasMatch[1] as string)
          const wf = await manager.client().getWorkflow(id)
          const graph = buildCanvas(wf)
          const name = (wf as unknown as { name?: unknown }).name
          return sendJson(res, 200, {
            ok: true,
            workflowId: id,
            name: typeof name === 'string' ? name : '',
            ...graph
          })
        }

        // 启用 / 停用工作流
        const toggle = /^\/workflows\/([^/]+)\/(activate|deactivate)$/.exec(sub)
        if (toggle && req.method === 'POST') {
          const id = decodeURIComponent(toggle[1] as string)
          const blocked = sessions.pausedReason(id)
          if (blocked) return sendJson(res, 200, { ok: false, blocked: true, error: blocked })
          const out =
            toggle[2] === 'activate'
              ? await manager.client().activateWorkflow(id)
              : await manager.client().deactivateWorkflow(id)
          return sendJson(res, 200, { ok: true, data: out })
        }

        return sendJson(res, 404, { ok: false, error: `未知路由：${sub}` })
      } catch (err) {
        if (err instanceof N8nApiError) {
          // 把 n8n 返回的具体原因带出来（例如 409 的 webhook 路径冲突 reason）
          let detail = ''
          try {
            const parsed = JSON.parse(err.body) as { message?: unknown; reason?: unknown }
            const raw = parsed.message ?? parsed.reason
            if (typeof raw === 'string') detail = raw
          } catch {
            /* 忽略非 JSON 错误体 */
          }
          return sendJson(res, 200, {
            ok: false,
            status: err.status,
            error: `n8n 返回 ${err.status}${detail ? '：' + detail : ''}`
          })
        }
        const message = err instanceof Error ? err.message : String(err)
        const status = /请求体|JSON/.test(message) ? 400 : 200
        return sendJson(res, status, { ok: false, error: message })
      }
    }
  })
}
