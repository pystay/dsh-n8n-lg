/**
 * HUD 服务端路由：把 n8n 请求代理给浏览器端 UI。
 *
 * 为什么需要中转：n8n 的 API 不返回 CORS 头，浏览器（DSH Web UI）不能直接 fetch。
 * 因此由本插件的 node 半在 DSH 的 webServer 上注册一个前缀路由
 * `/api/dsh-n8n-lg/*`，同源请求即可，服务端再去访问 n8n。
 *
 * 连接信息（baseUrl / apiKey）优先取请求头（浏览器 UI 里用户填的），
 * 回退到插件 cordis 配置。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { N8nApiError, N8nClient } from '../n8n/client.js'
import { isWebhookPathAllowed } from '../n8n/guard.js'
import type { Config } from '../config.js'

/** webServer 服务的最小结构（避免依赖 dsh-host-webserver 的类型包）。 */
export interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

export const HUD_ROUTE_PREFIX = '/api/dsh-n8n-lg'

export interface HudDeps {
  getConfig: () => Config
}

/** 从节点列表里提取 Webhook 路径（用于 UI 的"快速触发"按钮）。 */
function extractWebhookPaths(nodes: unknown): string[] {
  if (!Array.isArray(nodes)) return []
  const out: string[] = []
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    const n = node as { type?: unknown; parameters?: { path?: unknown } }
    if (n.type === 'n8n-nodes-base.webhook' && typeof n.parameters?.path === 'string' && n.parameters.path) {
      out.push(n.parameters.path)
    }
  }
  return out
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(text)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
  })
}

/** 解析本次请求使用的连接信息：请求头优先，其次插件配置。 */
function resolveConn(req: IncomingMessage, config: Config) {
  const header = (name: string): string | undefined => {
    const v = req.headers[name]
    return typeof v === 'string' && v.trim() ? v.trim() : undefined
  }
  const baseUrl = header('x-n8n-base-url') ?? config.baseUrl ?? ''
  const apiKey = header('x-n8n-api-key') ?? config.apiKey ?? ''
  return { baseUrl, apiKey }
}

/**
 * 注册 HUD 路由；返回 disposer（插件卸载时移除路由）。
 */
export function registerHudRoutes(webServer: WebServerLike, deps: HudDeps): () => void {
  return webServer.register({
    kind: 'prefix',
    path: HUD_ROUTE_PREFIX,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const sub = url.pathname.slice(HUD_ROUTE_PREFIX.length) || '/'
      const config = deps.getConfig()
      const { baseUrl, apiKey } = resolveConn(req, config)

      // 健康检查：不依赖连接信息，始终可用
      if (sub === '/health') {
        return sendJson(res, 200, { ok: true, configured: Boolean(baseUrl && apiKey), baseUrl })
      }

      // 未配置连接信息：明确告知 UI（不抛 500）
      if (!baseUrl || !apiKey) {
        return sendJson(res, 200, { ok: false, configured: false, error: '尚未配置 n8n 地址或 API Key' })
      }

      const client = new N8nClient({ baseUrl, apiKey, timeoutMs: config.timeoutMs })

      try {
        // 工作流列表（附带 webhook 路径，供快速触发）
        if (sub === '/workflows' && req.method === 'GET') {
          const list = await client.listWorkflows({ limit: 100 })
          const data = (list.data ?? []).map((w) => ({
            id: w.id,
            name: w.name,
            active: w.active,
            activeVersionId: w.activeVersionId ?? null,
            updatedAt: w.updatedAt,
            webhookPaths: extractWebhookPaths((w as { nodes?: unknown }).nodes)
          }))
          return sendJson(res, 200, { ok: true, data, nextCursor: list.nextCursor ?? null })
        }

        // 执行列表
        if (sub === '/executions' && req.method === 'GET') {
          const limit = Number(url.searchParams.get('limit') ?? '8')
          const list = await client.listExecutions({
            limit: Number.isFinite(limit) ? limit : 8,
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

        // 触发（快速启动）
        if (sub === '/trigger' && req.method === 'POST') {
          const body = JSON.parse((await readBody(req)) || '{}') as {
            webhookPath?: string
            payload?: unknown
            test?: boolean
          }
          const path = body.webhookPath ?? ''
          if (!path) return sendJson(res, 400, { ok: false, error: '缺少 webhookPath' })
          if (!isWebhookPathAllowed(path, config.allowedWebhookPaths)) {
            return sendJson(res, 403, { ok: false, error: `Webhook 路径不在白名单内：${path}` })
          }
          const result = await client.triggerWebhook(path, body.payload ?? {}, {
            test: body.test ?? config.useTestWebhook
          })
          return sendJson(res, 200, { ok: true, result })
        }

        // 启用 / 停用工作流
        const toggle = /^\/workflows\/([^/]+)\/(activate|deactivate)$/.exec(sub)
        if (toggle && req.method === 'POST') {
          const id = decodeURIComponent(toggle[1] as string)
          const action = toggle[2]
          const out = action === 'activate' ? await client.activateWorkflow(id) : await client.deactivateWorkflow(id)
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
        return sendJson(res, 200, { ok: false, error: message })
      }
    }
  })
}
