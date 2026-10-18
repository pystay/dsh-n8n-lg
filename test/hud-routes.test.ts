import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectionManager } from '../src/connection'
import { registerHudRoutes, HUD_ROUTE_PREFIX, type WebServerLike } from '../src/hud/routes'
import { sessions } from '../src/n8n/session'
import type { Config } from '../src/config'

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    baseUrl: 'http://n8n.test',
    apiKey: 'test-key',
    allowedWebhookPaths: [],
    timeoutMs: 5000,
    useTestWebhook: false,
    persistState: false,
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

/** 用空 env 构造，避免测试环境变量干扰「未配置」用例。 */
function makeManager(overrides: Partial<Config> = {}) {
  return new ConnectionManager(makeConfig(overrides), {})
}

/** 捕获注册的路由，便于直接调用 handler。 */
function captureRoute(manager = makeManager()) {
  let route: { kind: string; path: string; handler: (req: unknown, res: unknown) => unknown } | undefined
  const webServer: WebServerLike = {
    register(r) {
      route = r as never
      return () => {}
    }
  }
  registerHudRoutes(webServer, { manager })
  return { webServer, manager, getRoute: () => route! }
}

function fakeReq(opts: { method?: string; url?: string; headers?: Record<string, string>; body?: string }) {
  const req = new EventEmitter() as EventEmitter & {
    method: string
    url: string
    headers: Record<string, string>
    destroy: () => void
  }
  req.method = opts.method ?? 'GET'
  req.url = opts.url ?? '/'
  req.headers = opts.headers ?? {}
  req.destroy = () => {}
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
    const { getRoute } = captureRoute()
    expect(getRoute().kind).toBe('prefix')
    expect(getRoute().path).toBe(HUD_ROUTE_PREFIX)
  })

  it('未配置连接信息时 /workflows 返回 configured:false（不报 500）', async () => {
    const { getRoute } = captureRoute(makeManager({ baseUrl: '', apiKey: '' }))
    const res = fakeRes()
    await getRoute().handler(fakeReq({ url: `${HUD_ROUTE_PREFIX}/workflows` }), res)
    const body = JSON.parse(res.body)
    expect(body.ok).toBe(false)
    expect(body.configured).toBe(false)
  })

  it('/health 返回脱敏的连接状态', async () => {
    const { getRoute } = captureRoute(makeManager({ baseUrl: '', apiKey: '' }))
    const res = fakeRes()
    await getRoute().handler(fakeReq({ url: `${HUD_ROUTE_PREFIX}/health` }), res)
    expect(JSON.parse(res.body)).toMatchObject({
      ok: true,
      configured: false,
      baseUrl: null,
      // 未启用落盘时不该报「持久化坏了」；这个字段用来区分「真落盘了」和「以为落盘了」
      persistenceBroken: false
    })
  })

  it('/health 只暴露 origin 供展示，并单独给出编辑器基址，不泄漏密钥', async () => {
    const { getRoute } = captureRoute(makeManager({ baseUrl: 'http://n8n.test/internal/secret' }))
    const res = fakeRes()
    await getRoute().handler(fakeReq({ url: `${HUD_ROUTE_PREFIX}/health` }), res)
    const body = JSON.parse(res.body)
    // 展示用地址脱敏到 origin
    expect(body.baseUrl).toBe('http://n8n.test')
    // 编辑器必须打开宿主实际连接的实例（含子路径）
    expect(body.editorBaseUrl).toBe('http://n8n.test/internal/secret')
    expect(JSON.stringify(body)).not.toContain('test-key')
  })

  it('/workflows 代理并提取 webhook 路径与方法', async () => {
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
                { type: 'n8n-nodes-base.webhook', parameters: { path: 'deploy', httpMethod: 'POST' } },
                { type: 'n8n-nodes-base.code', parameters: {} }
              ]
            }
          ],
          nextCursor: null
        })
      )
    )
    const { getRoute } = captureRoute()
    const res = fakeRes()
    await getRoute().handler(fakeReq({ url: `${HUD_ROUTE_PREFIX}/workflows` }), res)
    const body = JSON.parse(res.body)
    expect(body.ok).toBe(true)
    expect(body.data[0]).toMatchObject({
      id: 'w1',
      name: 'deploy',
      active: true,
      nodeCount: 2,
      webhooks: [{ path: 'deploy', method: 'POST' }]
    })
  })

  it('/workflows 支持 cursor 分页', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [], nextCursor: 'next-page' }))
    vi.stubGlobal('fetch', fetchMock)
    const { getRoute } = captureRoute()
    const res = fakeRes()
    await getRoute().handler(fakeReq({ url: `${HUD_ROUTE_PREFIX}/workflows?limit=50&cursor=abc` }), res)
    expect(JSON.parse(res.body).nextCursor).toBe('next-page')
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toContain('cursor=abc')
  })

  it('/trigger 白名单拒绝返回 403', async () => {
    const { getRoute } = captureRoute(makeManager({ allowedWebhookPaths: ['deploy'] }))
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

  it('/trigger 拒绝越界的点段路径', async () => {
    const { getRoute } = captureRoute()
    const res = fakeRes()
    await getRoute().handler(
      fakeReq({
        method: 'POST',
        url: `${HUD_ROUTE_PREFIX}/trigger`,
        body: JSON.stringify({ webhookPath: 'deploy/../healthz' })
      }),
      res
    )
    expect(res.statusCode).toBe(403)
  })

  it('/trigger 允许时触发 webhook', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, echo: { a: 1 } }))
    vi.stubGlobal('fetch', fetchMock)
    const { getRoute } = captureRoute()
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

  it('/trigger 支持 method 与 query', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const { getRoute } = captureRoute()
    const res = fakeRes()
    await getRoute().handler(
      fakeReq({
        method: 'POST',
        url: `${HUD_ROUTE_PREFIX}/trigger`,
        body: JSON.stringify({ webhookPath: 'deploy', method: 'GET', query: { name: 'world' } })
      }),
      res
    )
    const call = fetchMock.mock.calls[0] as unknown as [string, { method: string; body?: string }]
    expect(call[0]).toBe('http://n8n.test/webhook/deploy?name=world')
    expect(call[1].method).toBe('GET')
    expect(call[1].body).toBeUndefined()
  })

  it('/trigger 应用配置的 Webhook Header 鉴权（回归：此前 HUD 侧遗漏）', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const { getRoute } = captureRoute(
      makeManager({ webhookAuthHeader: 'X-Hook-Token', webhookAuthValue: 'secret-token' })
    )
    const res = fakeRes()
    await getRoute().handler(
      fakeReq({
        method: 'POST',
        url: `${HUD_ROUTE_PREFIX}/trigger`,
        body: JSON.stringify({ webhookPath: 'deploy' })
      }),
      res
    )
    const call = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }]
    expect(call[1].headers['X-Hook-Token']).toBe('secret-token')
  })

  it('/workflows/:id/activate 调用 publish', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ active: true }))
    vi.stubGlobal('fetch', fetchMock)
    const { getRoute } = captureRoute()
    const res = fakeRes()
    await getRoute().handler(fakeReq({ method: 'POST', url: `${HUD_ROUTE_PREFIX}/workflows/w1/activate` }), res)
    expect(JSON.parse(res.body).ok).toBe(true)
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('http://n8n.test/api/v1/workflows/w1/publish')
  })

  it('未知路由返回 404', async () => {
    const { getRoute } = captureRoute()
    const res = fakeRes()
    await getRoute().handler(fakeReq({ url: `${HUD_ROUTE_PREFIX}/nope` }), res)
    expect(res.statusCode).toBe(404)
  })

  it('激活失败时把 n8n 的具体原因带出来（如 409 冲突）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ message: 'webhook path conflict' }, 409))
    )
    const { getRoute } = captureRoute()
    const res = fakeRes()
    await getRoute().handler(fakeReq({ method: 'POST', url: `${HUD_ROUTE_PREFIX}/workflows/w1/activate` }), res)
    const body = JSON.parse(res.body)
    expect(body.ok).toBe(false)
    expect(body.status).toBe(409)
    expect(body.error).toContain('webhook path conflict')
  })
})

describe('连接配置路由（统一连接来源）', () => {
  it('POST /config 保存后 /health 显示来源 runtime 与脱敏地址', async () => {
    const { getRoute, manager } = captureRoute(makeManager({ baseUrl: '', apiKey: '' }))

    const post = fakeRes()
    await getRoute().handler(
      fakeReq({
        method: 'POST',
        url: `${HUD_ROUTE_PREFIX}/config`,
        body: JSON.stringify({ baseUrl: 'http://127.0.0.1:5678/', apiKey: 'runtime-key' })
      }),
      post
    )
    expect(post.statusCode).toBe(200)
    expect(JSON.parse(post.body)).toMatchObject({ ok: true, configured: true, source: 'runtime' })
    // 地址与密钥成对保存（去掉结尾斜杠）
    expect(manager.require()).toEqual({ baseUrl: 'http://127.0.0.1:5678', apiKey: 'runtime-key' })

    const health = fakeRes()
    await getRoute().handler(fakeReq({ url: `${HUD_ROUTE_PREFIX}/health` }), health)
    expect(JSON.parse(health.body)).toMatchObject({ configured: true, source: 'runtime' })
  })

  it('POST /config 缺少 apiKey 时 400，不会产生「新地址 + 旧密钥」组合', async () => {
    const { getRoute, manager } = captureRoute()
    const res = fakeRes()
    await getRoute().handler(
      fakeReq({
        method: 'POST',
        url: `${HUD_ROUTE_PREFIX}/config`,
        body: JSON.stringify({ baseUrl: 'http://other.test' })
      }),
      res
    )
    expect(res.statusCode).toBe(400)
    // 仍然是原配置，没有被改掉
    expect(manager.require().baseUrl).toBe('http://n8n.test')
  })

  it('POST /config 非法地址时 400', async () => {
    const { getRoute } = captureRoute()
    const res = fakeRes()
    await getRoute().handler(
      fakeReq({
        method: 'POST',
        url: `${HUD_ROUTE_PREFIX}/config`,
        body: JSON.stringify({ baseUrl: 'ftp://nope', apiKey: 'k' })
      }),
      res
    )
    expect(res.statusCode).toBe(400)
  })

  it('DELETE /config 回落到配置文件', async () => {
    const { getRoute } = captureRoute()
    const post = fakeRes()
    await getRoute().handler(
      fakeReq({
        method: 'POST',
        url: `${HUD_ROUTE_PREFIX}/config`,
        body: JSON.stringify({ baseUrl: 'http://runtime.test', apiKey: 'k' })
      }),
      post
    )
    const del = fakeRes()
    await getRoute().handler(fakeReq({ method: 'DELETE', url: `${HUD_ROUTE_PREFIX}/config` }), del)
    expect(JSON.parse(del.body)).toMatchObject({ configured: true, source: 'config' })
  })

  it('GET /config 不返回密钥', async () => {
    const { getRoute } = captureRoute()
    const res = fakeRes()
    await getRoute().handler(fakeReq({ url: `${HUD_ROUTE_PREFIX}/config` }), res)
    expect(res.body).not.toContain('test-key')
  })
})

describe('HUD focus 路由（驱动浮窗自动打开内嵌编辑器）', () => {
  it('POST /focus 更新 rev / workflowId，GET 读回', async () => {
    const { getRoute } = captureRoute()

    const before = JSON.parse(
      (await (async () => {
        const r = fakeRes()
        await getRoute().handler(fakeReq({ url: `${HUD_ROUTE_PREFIX}/focus` }), r)
        return r
      })()).body
    ) as { rev: number }

    const postRes = fakeRes()
    await getRoute().handler(
      fakeReq({
        method: 'POST',
        url: `${HUD_ROUTE_PREFIX}/focus`,
        body: JSON.stringify({ workflowId: 'wf-42', note: '正在搭建' })
      }),
      postRes
    )
    const posted = JSON.parse(postRes.body)
    expect(posted.ok).toBe(true)
    expect(posted.workflowId).toBe('wf-42')
    expect(posted.note).toBe('正在搭建')
    expect(posted.rev).toBe(before.rev + 1)

    const getRes = fakeRes()
    await getRoute().handler(fakeReq({ url: `${HUD_ROUTE_PREFIX}/focus` }), getRes)
    const got = JSON.parse(getRes.body)
    expect(got.workflowId).toBe('wf-42')
    expect(got.rev).toBe(posted.rev)
  })

  it('/focus 不依赖 n8n 连接配置', async () => {
    const { getRoute } = captureRoute(makeManager({ baseUrl: '', apiKey: '' }))
    const res = fakeRes()
    await getRoute().handler(fakeReq({ url: `${HUD_ROUTE_PREFIX}/focus` }), res)
    expect(JSON.parse(res.body).ok).toBe(true)
  })

  it('非法 JSON 返回 400 而不是把 handler 打挂（回归：此前请求悬挂）', async () => {
    const { getRoute } = captureRoute()
    const res = fakeRes()
    await getRoute().handler(fakeReq({ method: 'POST', url: `${HUD_ROUTE_PREFIX}/focus`, body: '{' }), res)
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).ok).toBe(false)
  })

  it('workflowId 为 null 时也返回 ok（表示打开工作流列表）', async () => {
    const { getRoute } = captureRoute()
    const res = fakeRes()
    await getRoute().handler(
      fakeReq({ method: 'POST', url: `${HUD_ROUTE_PREFIX}/focus`, body: JSON.stringify({ workflowId: null }) }),
      res
    )
    const body = JSON.parse(res.body)
    expect(body.ok).toBe(true)
    expect(body.workflowId).toBeNull()
  })
})

describe('HUD 校验与回滚路由', () => {
  it('GET /workflows/:id/validate 返回校验结论', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          id: 'w1',
          name: 'x',
          nodes: [{ id: 'n1', name: 'A', type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0] }],
          connections: {}
        })
      )
    )
    const { getRoute } = captureRoute()
    const res = fakeRes()
    await getRoute().handler(fakeReq({ url: `${HUD_ROUTE_PREFIX}/workflows/w1/validate` }), res)
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, errors: 0 })
  })

  it('POST 快照 → GET 列出 → POST 恢复', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          id: 'w9',
          name: 'snap',
          nodes: [{ id: 'n1', name: 'A', type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0] }],
          connections: {},
          settings: {}
        })
      )
    )
    const { getRoute } = captureRoute()

    const created = fakeRes()
    await getRoute().handler(fakeReq({ method: 'POST', url: `${HUD_ROUTE_PREFIX}/workflows/w9/snapshots` }), created)
    const snapshotId = JSON.parse(created.body).snapshotId as string
    expect(snapshotId).toBeTruthy()

    const listed = fakeRes()
    await getRoute().handler(fakeReq({ url: `${HUD_ROUTE_PREFIX}/workflows/w9/snapshots` }), listed)
    expect(JSON.parse(listed.body).snapshots.map((s: { id: string }) => s.id)).toContain(snapshotId)

    const restored = fakeRes()
    await getRoute().handler(
      fakeReq({
        method: 'POST',
        url: `${HUD_ROUTE_PREFIX}/workflows/w9/restore`,
        body: JSON.stringify({ snapshotId })
      }),
      restored
    )
    expect(JSON.parse(restored.body)).toMatchObject({ ok: true, restoredFrom: snapshotId })
  })

  it('没有快照时恢复返回可读错误', async () => {
    const { getRoute } = captureRoute()
    const res = fakeRes()
    await getRoute().handler(
      fakeReq({ method: 'POST', url: `${HUD_ROUTE_PREFIX}/workflows/never-seen/restore`, body: '{}' }),
      res
    )
    expect(JSON.parse(res.body).ok).toBe(false)
    expect(JSON.parse(res.body).error).toContain('快照')
  })
})

describe('HUD 内嵌可行性探测（iframe 空白问题的根因）', () => {
  it('n8n 返回 X-Frame-Options 时判定为不可内嵌，并说明原因', async () => {
    const seen: Array<{ url: string; method: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { method?: string }) => {
        seen.push({ url: String(url), method: init?.method ?? 'GET' })
        return {
          ok: true,
          status: 200,
          headers: { get: (k: string) => (k.toLowerCase() === 'x-frame-options' ? 'SAMEORIGIN' : null) }
        }
      })
    )
    const { getRoute } = captureRoute()
    const res = fakeRes()
    await getRoute().handler(
      fakeReq({ url: `${HUD_ROUTE_PREFIX}/embed-check?workflowId=w1` }),
      res
    )
    const body = JSON.parse(res.body)
    expect(body.embeddable).toBe(false)
    expect(body.reason).toContain('X-Frame-Options')
    expect(body.reason).toContain('SAMEORIGIN')
    // 关键：必须用 GET 探测 —— n8n 对 HEAD 返回 404，那种响应没有安全头（曾因此误判）
    expect(seen[0]?.method).toBe('GET')
    expect(seen[0]?.url).toBe('http://n8n.test/workflow/w1')
  })

  it('CSP 限制 frame-ancestors 时也判定为不可内嵌', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: {
          get: (k: string) =>
            k.toLowerCase() === 'content-security-policy' ? "frame-ancestors 'self'" : null
        }
      }))
    )
    const { getRoute } = captureRoute()
    const res = fakeRes()
    await getRoute().handler(fakeReq({ url: `${HUD_ROUTE_PREFIX}/embed-check` }), res)
    const body = JSON.parse(res.body)
    expect(body.embeddable).toBe(false)
    expect(body.reason).toContain('frame-ancestors')
  })

  it('没有任何限制头时判定为可内嵌', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null } }))
    )
    const { getRoute } = captureRoute()
    const res = fakeRes()
    await getRoute().handler(fakeReq({ url: `${HUD_ROUTE_PREFIX}/embed-check` }), res)
    const body = JSON.parse(res.body)
    expect(body.embeddable).toBe(true)
    expect(body.reason).toBeUndefined()
  })

  it('探测失败时降级为不可内嵌（宁可给外部入口，也不留空白）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      })
    )
    const { getRoute } = captureRoute()
    const res = fakeRes()
    await getRoute().handler(fakeReq({ url: `${HUD_ROUTE_PREFIX}/embed-check` }), res)
    const body = JSON.parse(res.body)
    expect(body.embeddable).toBe(false)
    expect(body.reason).toContain('无法探测')
  })
})

describe('HUD 搭建会话路由（时间线 + 暂停控制）', () => {
  it('没有会话时返回 session:null（前端据此隐藏时间线）', async () => {
    const { getRoute } = captureRoute()
    const res = fakeRes()
    await getRoute().handler(fakeReq({ url: `${HUD_ROUTE_PREFIX}/session?workflowId=none` }), res)
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, session: null })
  })

  it('会话状态可读、可切换，非法 state 返回 400', async () => {
    const { getRoute } = captureRoute()
    const session = sessions.start({
      workflowId: 'w-hud-session',
      goal: 'HUD 时间线测试',
      steps: [
        { id: 's1', title: '第一步' },
        { id: 's2', title: '第二步' }
      ]
    })

    const read = fakeRes()
    await getRoute().handler(
      fakeReq({ url: `${HUD_ROUTE_PREFIX}/session?workflowId=w-hud-session` }),
      read
    )
    const body = JSON.parse(read.body)
    expect(body.session.id).toBe(session.id)
    expect(body.progress).toMatchObject({ total: 2, percent: 0 })

    const paused = fakeRes()
    await getRoute().handler(
      fakeReq({
        method: 'POST',
        url: `${HUD_ROUTE_PREFIX}/session/state`,
        body: JSON.stringify({ sessionId: session.id, state: 'paused' })
      }),
      paused
    )
    expect(JSON.parse(paused.body).session.status).toBe('paused')

    const bad = fakeRes()
    await getRoute().handler(
      fakeReq({
        method: 'POST',
        url: `${HUD_ROUTE_PREFIX}/session/state`,
        body: JSON.stringify({ sessionId: session.id, state: 'nope' })
      }),
      bad
    )
    expect(bad.statusCode).toBe(400)
    expect(JSON.parse(bad.body).error).toContain('state 必须是')

    sessions.setStatus(session.id, 'completed')
  })

  it('会话暂停时，HUD 触发的启用也被拦下（暂停是真生效的）', async () => {
    const { getRoute } = captureRoute()
    const session = sessions.start({
      workflowId: 'w-hud-paused',
      goal: 'g',
      steps: [{ id: 's1', title: 'step' }]
    })
    sessions.setStatus(session.id, 'paused')

    const fetchMock = vi.fn(async () => jsonResponse({ active: true }))
    vi.stubGlobal('fetch', fetchMock)

    const res = fakeRes()
    await getRoute().handler(
      fakeReq({ method: 'POST', url: `${HUD_ROUTE_PREFIX}/workflows/w-hud-paused/activate` }),
      res
    )
    const body = JSON.parse(res.body)
    expect(body.ok).toBe(false)
    expect(body.blocked).toBe(true)
    expect(body.error).toContain('暂停')
    expect(fetchMock).not.toHaveBeenCalled()

    sessions.setStatus(session.id, 'completed')
  })
})

describe('HUD 凭据向导路由', () => {
  it('返回缺失的凭据类型、已有类型与配置入口', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/api/v1/credentials')) {
          return jsonResponse({ data: [{ id: 'c1', name: 'OpenAI', type: 'openAiApi' }], nextCursor: null })
        }
        return jsonResponse({
          id: 'w1',
          name: 'cred',
          nodes: [
            { id: 'g1', name: '写表格', type: 'n8n-nodes-base.googleSheets', typeVersion: 4, position: [0, 0] }
          ],
          connections: {}
        })
      })
    )
    const { getRoute } = captureRoute()
    const res = fakeRes()
    await getRoute().handler(fakeReq({ url: `${HUD_ROUTE_PREFIX}/workflows/w1/credentials` }), res)
    const body = JSON.parse(res.body)
    expect(body.ok).toBe(false)
    expect(body.missing[0].credentialType).toBe('googleSheetsOAuth2Api')
    expect(body.available).toContain('openAiApi')
    expect(body.credentialsUrl).toBe('http://n8n.test/home/credentials')
  })

  it('API Key 缺少 credential:list 权限时降级但仍给出结论', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/api/v1/credentials')) {
          return jsonResponse({ message: 'Forbidden' }, 403)
        }
        return jsonResponse({
          id: 'w1',
          name: 'cred',
          nodes: [{ id: 'g1', name: '写表格', type: 'n8n-nodes-base.googleSheets', typeVersion: 4, position: [0, 0] }],
          connections: {}
        })
      })
    )
    const { getRoute } = captureRoute()
    const res = fakeRes()
    await getRoute().handler(fakeReq({ url: `${HUD_ROUTE_PREFIX}/workflows/w1/credentials` }), res)
    const body = JSON.parse(res.body)
    expect(body.scopeWarning).toContain('credential:list')
    expect(body.missing[0].credentialType).toBe('googleSheetsOAuth2Api')
  })
})

describe('HUD 画布路由（n8n 拒绝内嵌时的替代）', () => {
  it('返回节点坐标与连线，且不泄漏节点参数', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: 'w1',
        name: 'my wf',
        nodes: [
          {
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            position: [0, 0],
            parameters: { path: 'p' }
          },
          {
            name: 'Code',
            type: 'n8n-nodes-base.code',
            position: [220, 0],
            parameters: { jsCode: 'SECRET_JS_SHOULD_NOT_LEAK' }
          }
        ],
        connections: { Webhook: { main: [[{ node: 'Code', type: 'main', index: 0 }]] } }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const { getRoute } = captureRoute()
    const res = fakeRes()
    await getRoute().handler(
      fakeReq({ method: 'GET', url: `${HUD_ROUTE_PREFIX}/workflows/w1/canvas` }),
      res
    )

    const body = JSON.parse(res.body) as {
      ok: boolean
      name: string
      nodes: Array<{ kind: string }>
      edges: unknown[]
    }
    expect(res.statusCode).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.name).toBe('my wf')
    expect(body.nodes).toHaveLength(2)
    expect(body.nodes[0]?.kind).toBe('webhook')
    expect(body.edges).toEqual([{ from: 'Webhook', to: 'Code', channel: 'main' }])
    // 画布只要坐标，节点参数（可能含内联数据）不能带出来
    expect(res.body).not.toContain('SECRET_JS_SHOULD_NOT_LEAK')
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/v1/workflows/w1')
  })

  it('工作流不存在时返回结构化错误（不是 500 崩掉）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'Not Found' }, 404)))
    const { getRoute } = captureRoute()
    const res = fakeRes()
    await getRoute().handler(
      fakeReq({ method: 'GET', url: `${HUD_ROUTE_PREFIX}/workflows/nope/canvas` }),
      res
    )
    const body = JSON.parse(res.body) as { ok: boolean; error?: string }
    expect(body.ok).toBe(false)
    expect(String(body.error)).toMatch(/404|Not Found/)
  })

  it('空工作流返回空图而不是报错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ id: 'w2', name: 'empty', nodes: [], connections: {} }))
    )
    const { getRoute } = captureRoute()
    const res = fakeRes()
    await getRoute().handler(
      fakeReq({ method: 'GET', url: `${HUD_ROUTE_PREFIX}/workflows/w2/canvas` }),
      res
    )
    const body = JSON.parse(res.body) as { ok: boolean; nodes: unknown[]; edges: unknown[] }
    expect(body.ok).toBe(true)
    expect(body.nodes).toEqual([])
    expect(body.edges).toEqual([])
  })
})
