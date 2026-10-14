import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerHudRoutes, HUD_ROUTE_PREFIX, type WebServerLike } from '../src/hud/routes'
import type { Config } from '../src/config'

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    baseUrl: 'http://n8n.test',
    apiKey: 'test-key',
    allowedWebhookPaths: [],
    timeoutMs: 5000,
    useTestWebhook: false,
    sandbox: {
      enabled: false,
      image: '',
      containerName: '',
      hostPort: 5679,
      containerPort: 5678,
      dataVolume: '',
      timezone: ''
    },
    ...overrides
  }
}

/** 捕获注册的路由，便于直接调用 handler。 */
function captureRoute() {
  let route: { kind: string; path: string; handler: (req: unknown, res: unknown) => unknown } | undefined
  const webServer: WebServerLike = {
    register(r) {
      route = r as never
      return () => {}
    }
  }
  return { webServer, getRoute: () => route! }
}

function fakeReq(opts: { method?: string; url?: string; headers?: Record<string, string>; body?: string }) {
  const req = new EventEmitter() as EventEmitter & {
    method: string
    url: string
    headers: Record<string, string>
  }
  req.method = opts.method ?? 'GET'
  req.url = opts.url ?? '/'
  req.headers = opts.headers ?? {}
  setImmediate(() => {
    if (opts.body) req.emit('data', Buffer.from(opts.body))
    req.emit('end')
  })
  return req
}

function fakeRes() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: '',
    writeHead(code: number, h?: Record<string, string>) {
      res.statusCode = code
      res.headers = h ?? {}
    },
    end(chunk?: string) {
      if (chunk) res.body += chunk
    }
  }
  return res
}

function jsonResponse(body: unknown, status = 200) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return { ok: status >= 200 && status < 300, status, text: async () => text }
}

afterEach(() => vi.unstubAllGlobals())

describe('registerHudRoutes', () => {
  it('注册前缀路由 /api/dsh-n8n-lg', () => {
    const { webServer, getRoute } = captureRoute()
    registerHudRoutes(webServer, { getConfig: () => makeConfig() })
    expect(getRoute().kind).toBe('prefix')
    expect(getRoute().path).toBe(HUD_ROUTE_PREFIX)
  })

  it('未配置连接信息时 /workflows 返回 configured:false（不报 500）', async () => {
    const { webServer, getRoute } = captureRoute()
    registerHudRoutes(webServer, { getConfig: () => makeConfig({ baseUrl: '', apiKey: '' }) })
    const res = fakeRes()
    await getRoute().handler(fakeReq({ url: `${HUD_ROUTE_PREFIX}/workflows` }), res)
    const body = JSON.parse(res.body)
    expect(body.ok).toBe(false)
    expect(body.configured).toBe(false)
  })

  it('/health 返回配置状态', async () => {
    const { webServer, getRoute } = captureRoute()
    registerHudRoutes(webServer, { getConfig: () => makeConfig({ baseUrl: '', apiKey: '' }) })
    const res = fakeRes()
    await getRoute().handler(fakeReq({ url: `${HUD_ROUTE_PREFIX}/health` }), res)
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, configured: false })
  })

  it('/workflows 代理并提取 webhook 路径', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            {
              id: 'w1',
              name: 'deploy',
              active: true,
              nodes: [
                { type: 'n8n-nodes-base.webhook', parameters: { path: 'deploy' } },
                { type: 'n8n-nodes-base.code', parameters: {} }
              ]
            }
          ],
          nextCursor: null
        })
      )
    )
    const { webServer, getRoute } = captureRoute()
    registerHudRoutes(webServer, { getConfig: () => makeConfig() })
    const res = fakeRes()
    await getRoute().handler(fakeReq({ url: `${HUD_ROUTE_PREFIX}/workflows` }), res)
    const body = JSON.parse(res.body)
    expect(body.ok).toBe(true)
    expect(body.data[0]).toMatchObject({ id: 'w1', name: 'deploy', active: true, webhookPaths: ['deploy'] })
  })

  it('请求头可覆盖 baseUrl/apiKey（UI 里填的优先）', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [], nextCursor: null }))
    vi.stubGlobal('fetch', fetchMock)
    const { webServer, getRoute } = captureRoute()
    registerHudRoutes(webServer, { getConfig: () => makeConfig({ baseUrl: '', apiKey: '' }) })
    const res = fakeRes()
    await getRoute().handler(
      fakeReq({
        url: `${HUD_ROUTE_PREFIX}/workflows`,
        headers: { 'x-n8n-base-url': 'http://127.0.0.1:5678', 'x-n8n-api-key': 'ui-key' }
      }),
      res
    )
    expect(JSON.parse(res.body).ok).toBe(true)
    const call = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }]
    expect(call[0]).toBe('http://127.0.0.1:5678/api/v1/workflows?limit=100')
    expect(call[1].headers['X-N8N-API-KEY']).toBe('ui-key')
  })

  it('/trigger 白名单拒绝返回 403', async () => {
    const { webServer, getRoute } = captureRoute()
    registerHudRoutes(webServer, { getConfig: () => makeConfig({ allowedWebhookPaths: ['deploy'] }) })
    const res = fakeRes()
    await getRoute().handler(
      fakeReq({
        method: 'POST',
        url: `${HUD_ROUTE_PREFIX}/trigger`,
        body: JSON.stringify({ webhookPath: 'danger' })
      }),
      res
    )
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).ok).toBe(false)
  })

  it('/trigger 允许时触发 webhook', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, echo: { a: 1 } }))
    vi.stubGlobal('fetch', fetchMock)
    const { webServer, getRoute } = captureRoute()
    registerHudRoutes(webServer, { getConfig: () => makeConfig() })
    const res = fakeRes()
    await getRoute().handler(
      fakeReq({
        method: 'POST',
        url: `${HUD_ROUTE_PREFIX}/trigger`,
        body: JSON.stringify({ webhookPath: 'deploy', payload: { a: 1 } })
      }),
      res
    )
    const body = JSON.parse(res.body)
    expect(body.ok).toBe(true)
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('http://n8n.test/webhook/deploy')
  })

  it('/workflows/:id/activate 调用 publish', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ active: true }))
    vi.stubGlobal('fetch', fetchMock)
    const { webServer, getRoute } = captureRoute()
    registerHudRoutes(webServer, { getConfig: () => makeConfig() })
    const res = fakeRes()
    await getRoute().handler(
      fakeReq({ method: 'POST', url: `${HUD_ROUTE_PREFIX}/workflows/w1/activate` }),
      res
    )
    expect(JSON.parse(res.body).ok).toBe(true)
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('http://n8n.test/api/v1/workflows/w1/publish')
  })

  it('未知路由返回 404', async () => {
    const { webServer, getRoute } = captureRoute()
    registerHudRoutes(webServer, { getConfig: () => makeConfig() })
    const res = fakeRes()
    await getRoute().handler(fakeReq({ url: `${HUD_ROUTE_PREFIX}/nope` }), res)
    expect(res.statusCode).toBe(404)
  })
})
