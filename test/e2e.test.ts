/**
 * 端到端联调测试。
 *
 * 起一个忠实复刻 n8n 公开 API 契约的本地 HTTP 服务（路径 / 鉴权头 / 响应体结构
 * 均与 n8n 2.44.0 一致），再通过 registerTools 注册真实工具定义，
 * 直接调用工具 execute，跑通「工具 → ConnectionManager → N8nClient → HTTP → 响应」全链路。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { ConnectionManager } from '../src/connection'
import { registerTools } from '../src/tools/index'
import type { Config } from '../src/config'

const API_KEY = 'e2e-secret'
const WORKFLOW = { id: '1', name: 'deploy', active: true, activeVersionId: 'v1' }
const EXECUTION = {
  id: '100',
  status: 'success',
  finished: true,
  mode: 'webhook',
  workflowId: '1'
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(text)
}

let server: Server
let baseUrl: string
/** 记录 webhook 收到的请求体，供断言。 */
const webhookReceived: unknown[] = []
/** 内存工作流存储（让 PUT/GET 有真实状态，add_nodes 才能被验证）。 */
const store = new Map<string, Record<string, unknown>>()
let nextId = 1

function seed(id: string, name: string, nodes: unknown[] = []): void {
  store.set(id, { id, name, active: false, nodes, connections: {}, settings: {} })
}

beforeAll(async () => {
  seed('w-new', 'new-wf')
  seed('w-build', 'build-wf')
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')

    // Webhook 触发（n8n 公开 API 无触发端点，触发走这里）
    if (req.method === 'POST' && url.pathname === '/webhook/deploy') {
      const body = await readBody(req)
      const parsed = body ? JSON.parse(body) : {}
      webhookReceived.push(parsed)
      return sendJson(res, 200, { executionId: '100', status: 'success', received: parsed })
    }

    // 公开 API 鉴权：n8n 用 X-N8N-API-KEY
    if (url.pathname.startsWith('/api/v1')) {
      if (req.headers['x-n8n-api-key'] !== API_KEY) {
        return sendJson(res, 401, { message: 'unauthorized' })
      }

      const wfMatch = /^\/api\/v1\/workflows\/([^/]+)$/.exec(url.pathname)
      if (wfMatch) {
        const id = decodeURIComponent(wfMatch[1] as string)
        if (req.method === 'GET') {
          if (id === '1') return sendJson(res, 200, WORKFLOW)
          const found = store.get(id)
          return found ? sendJson(res, 200, found) : sendJson(res, 404, { message: 'not found' })
        }
        if (req.method === 'PUT') {
          const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>
          const prev = store.get(id) ?? { id }
          const next = { ...prev, ...body, id }
          store.set(id, next)
          return sendJson(res, 200, next)
        }
        if (req.method === 'DELETE') {
          store.delete(id)
          return sendJson(res, 200, {})
        }
      }

      if (req.method === 'GET' && url.pathname === '/api/v1/workflows') {
        return sendJson(res, 200, { data: [WORKFLOW, ...store.values()], nextCursor: null })
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/credentials') {
        return sendJson(res, 200, {
          data: [{ id: 'c1', name: 'OpenAI account', type: 'openAiApi' }],
          nextCursor: null
        })
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/executions') {
        return sendJson(res, 200, { data: [EXECUTION], nextCursor: null })
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/executions/100') {
        return sendJson(res, 200, EXECUTION)
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/workflows') {
        const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>
        const id = `w-${nextId++}`
        store.set(id, { id, active: false, connections: {}, settings: {}, ...body })
        return sendJson(res, 201, store.get(id))
      }
      const publishMatch = /^\/api\/v1\/workflows\/([^/]+)\/(publish|deactivate)$/.exec(url.pathname)
      if (publishMatch && req.method === 'POST') {
        const id = decodeURIComponent(publishMatch[1] as string)
        const found = store.get(id)
        if (found) found.active = publishMatch[2] === 'publish'
        return sendJson(res, 200, found ?? { id, active: publishMatch[2] === 'publish' })
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/executions/100/retry') {
        return sendJson(res, 200, { id: '101', status: 'new' })
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/executions/100/stop') {
        return sendJson(res, 200, { id: '100', status: 'canceled' })
      }
    }

    sendJson(res, 404, { message: 'not found' })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    baseUrl,
    apiKey: API_KEY,
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

/** 构造一个只捕获工具定义的假 Context + 真实连接管理器。 */
function collectTools(config: Config) {
  const tools = new Map<string, { execute: (args: unknown, exec: unknown) => Promise<unknown> }>()
  const ctx = {
    tools: {
      register: (def: { name: string }) => {
        tools.set(def.name, def as never)
      }
    }
  }
  const manager = new ConnectionManager(config, {})
  registerTools(ctx as never, manager, config)
  const exec = { signal: new AbortController().signal, deferContext() {}, concludeTurn() {} }
  return { tools, exec, manager }
}

const node = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [0, 0],
  parameters: {},
  ...extra
})

describe('E2E：工具 → ConnectionManager → N8nClient → n8n(本地复刻)', () => {
  it('注册了全部 21 个 n8n 工具', () => {
    const { tools } = collectTools(makeConfig())
    expect([...tools.keys()].sort()).toEqual([
      'n8n_activate_workflow',
      'n8n_add_nodes',
      'n8n_begin_build_session',
      'n8n_check_credentials',
      'n8n_create_workflow',
      'n8n_deactivate_workflow',
      'n8n_delete_workflow',
      'n8n_get_build_session',
      'n8n_get_execution_status',
      'n8n_get_workflow',
      'n8n_list_executions',
      'n8n_list_workflows',
      'n8n_open_editor',
      'n8n_restore_workflow',
      'n8n_retry_execution',
      'n8n_set_build_session_state',
      'n8n_snapshot_workflow',
      'n8n_stop_execution',
      'n8n_trigger_workflow',
      'n8n_update_workflow',
      'n8n_validate_workflow'
    ])
  })

  it('未配置连接时工具仍然注册，调用时才报可读错误', async () => {
    const { tools } = collectTools(makeConfig({ baseUrl: '', apiKey: '' }))
    expect(tools.size).toBe(21)
    await expect(tools.get('n8n_list_workflows')!.execute({}, {})).rejects.toThrow(/尚未配置 n8n 连接/)
  })

  it('n8n_list_workflows 返回 n8n 原始 {data,nextCursor}', async () => {
    const { tools, exec } = collectTools(makeConfig())
    const out = (await tools.get('n8n_list_workflows')!.execute({ active: true }, exec)) as {
      data: unknown[]
      nextCursor: null
    }
    expect(out.data.length).toBeGreaterThan(0)
    expect(out.nextCursor).toBeNull()
  })

  it('n8n_get_workflow 返回单个工作流', async () => {
    const { tools, exec } = collectTools(makeConfig())
    const out = (await tools.get('n8n_get_workflow')!.execute({ workflowId: '1' }, exec)) as { name: string }
    expect(out.name).toBe('deploy')
  })

  it('n8n_trigger_workflow 触发 webhook 并拿到执行结果', async () => {
    webhookReceived.length = 0
    const { tools, exec } = collectTools(makeConfig())
    const out = (await tools
      .get('n8n_trigger_workflow')!
      .execute({ webhookPath: 'deploy', payload: { env: 'prod' } }, exec)) as {
      ok: boolean
      status: number
      result: { status: string; received: { env: string } }
    }
    expect(out.ok).toBe(true)
    expect(out.status).toBe(200)
    expect(out.result.status).toBe('success')
    expect(out.result.received).toEqual({ env: 'prod' })
    expect(webhookReceived[0]).toEqual({ env: 'prod' })
  })

  it('n8n_get_execution_status / n8n_list_executions 正常返回', async () => {
    const { tools, exec } = collectTools(makeConfig())
    const one = (await tools.get('n8n_get_execution_status')!.execute({ executionId: '100' }, exec)) as {
      status: string
    }
    expect(one.status).toBe('success')
    const list = (await tools.get('n8n_list_executions')!.execute({ status: 'success' }, exec)) as {
      data: unknown[]
    }
    expect(list.data).toEqual([EXECUTION])
  })

  it('白名单拒绝未授权 webhook 路径', async () => {
    const { tools, exec } = collectTools(makeConfig({ allowedWebhookPaths: ['deploy'] }))
    await expect(
      tools.get('n8n_trigger_workflow')!.execute({ webhookPath: 'danger' }, exec)
    ).rejects.toThrow(/白名单/)
  })

  it('白名单无法被点段绕过（回归）', async () => {
    const { tools, exec } = collectTools(makeConfig({ allowedWebhookPaths: ['deploy/*'] }))
    await expect(
      tools.get('n8n_trigger_workflow')!.execute({ webhookPath: 'deploy/../healthz' }, exec)
    ).rejects.toThrow(/白名单|不安全/)
  })

  it('API Key 错误时公开 API 抛错（服务端 401）', async () => {
    const { tools, exec } = collectTools(makeConfig({ apiKey: 'wrong-key' }))
    await expect(tools.get('n8n_list_workflows')!.execute({}, exec)).rejects.toThrow(/401/)
  })

  it('工作流生命周期：create → activate → deactivate → delete', async () => {
    const { tools, exec } = collectTools(makeConfig())
    const created = (await tools
      .get('n8n_create_workflow')!
      .execute({ workflow: { name: 'new-wf', nodes: [], connections: {} } }, exec)) as {
      ok: boolean
      workflow: { id: string }
    }
    expect(created.ok).toBe(true)
    const id = created.workflow.id
    expect(id).toBeTruthy()

    const act = (await tools.get('n8n_activate_workflow')!.execute({ workflowId: id }, exec)) as {
      active: boolean
    }
    expect(act.active).toBe(true)

    const deact = (await tools.get('n8n_deactivate_workflow')!.execute({ workflowId: id }, exec)) as {
      active: boolean
    }
    expect(deact.active).toBe(false)

    const del = (await tools.get('n8n_delete_workflow')!.execute({ workflowId: id }, exec)) as {
      deleted: boolean
    }
    expect(del.deleted).toBe(true)
  })

  it('n8n_retry_execution / n8n_stop_execution 正常返回', async () => {
    const { tools, exec } = collectTools(makeConfig())
    const r = (await tools.get('n8n_retry_execution')!.execute({ executionId: '100' }, exec)) as { id: string }
    expect(r.id).toBe('101')
    const s = (await tools.get('n8n_stop_execution')!.execute({ executionId: '100' }, exec)) as {
      status: string
    }
    expect(s.status).toBe('canceled')
  })
})

describe('E2E：可视化搭建（n8n_add_nodes / open_editor / validate / 回滚）', () => {
  it('n8n_add_nodes 追加节点、合并连接，并能读回验证', async () => {
    const { tools, exec } = collectTools(makeConfig())
    seed('w-build', 'build-wf')
    const out = (await tools.get('n8n_add_nodes')!.execute(
      {
        workflowId: 'w-build',
        nodes: [node('h1', 'Webhook', { type: 'n8n-nodes-base.webhook', parameters: { path: 'hook' } })],
        connections: {},
        stepId: 'step-webhook'
      },
      exec
    )) as { ok: boolean; added: number; nodeCount: number; verified: boolean; snapshotId: string }
    expect(out.ok).toBe(true)
    expect(out.added).toBe(1)
    expect(out.nodeCount).toBe(1)
    expect(out.verified).toBe(true)
    expect(out.snapshotId).toBeTruthy()
    expect((store.get('w-build')!.nodes as unknown[]).length).toBe(1)
  })

  it('同一步骤重复调用不会重复写入（幂等）', async () => {
    const { tools, exec } = collectTools(makeConfig())
    seed('w-build', 'build-wf')
    const args = {
      workflowId: 'w-build',
      nodes: [node('n1', 'OnlyOnce')],
      stepId: 'step-idempotent'
    }
    await tools.get('n8n_add_nodes')!.execute(args, exec)
    const second = (await tools.get('n8n_add_nodes')!.execute(args, exec)) as { added: number }
    expect(second.added).toBe(0)
    expect((store.get('w-build')!.nodes as unknown[]).length).toBe(1)
  })

  it('AI 连线（非 main 通道）不会被覆盖', async () => {
    const { tools, exec } = collectTools(makeConfig())
    // 真实 n8n 要求连线两端都存在于节点列表中，因此这里把 Agent 也建出来
    seed('w-build', 'build-wf', [node('m1', 'Model'), node('a1', 'Agent1')])
    store.get('w-build')!.connections = {
      Model: { ai_languageModel: [[{ node: 'Agent1', type: 'ai_languageModel', index: 0 }]] }
    }
    const out = (await tools.get('n8n_add_nodes')!.execute(
      {
        workflowId: 'w-build',
        nodes: [node('m2', 'Model2'), node('a2', 'Agent2')],
        connections: {
          Model: { ai_languageModel: [[{ node: 'Agent2', type: 'ai_languageModel', index: 0 }]] }
        }
      },
      exec
    )) as { ok: boolean }
    expect(out.ok).toBe(true)
    const conn = store.get('w-build')!.connections as Record<string, Record<string, unknown[][]>>
    const links = conn.Model!.ai_languageModel![0] as Array<{ node: string }>
    expect(links.map((l) => l.node)).toEqual(['Agent1', 'Agent2'])
  })

  it('n8n_add_nodes 拒绝指向不存在节点的连线（实测 n8n 会 400）', async () => {
    const { tools, exec } = collectTools(makeConfig())
    seed('w-build', 'build-wf', [node('m1', 'Model')])
    const out = (await tools.get('n8n_add_nodes')!.execute(
      {
        workflowId: 'w-build',
        nodes: [node('m2', 'Model2')],
        connections: { Model: { ai_languageModel: [[{ node: 'Ghost', type: 'ai_languageModel', index: 0 }]] } }
      },
      exec
    )) as { ok: boolean; issues: Array<{ level: string; message: string }> }
    expect(out.ok).toBe(false)
    expect(out.issues.some((i) => i.level === 'error' && i.message.includes('指向不存在的节点'))).toBe(true)
    expect((store.get('w-build')!.nodes as unknown[]).length).toBe(1)
  })

  it('n8n_add_nodes 拒绝编造的节点类型（knownTypes）', async () => {
    const { tools, exec } = collectTools(makeConfig())
    seed('w-build', 'build-wf')
    const out = (await tools.get('n8n_add_nodes')!.execute(
      {
        workflowId: 'w-build',
        nodes: [node('bad1', 'Fake', { type: 'n8n-nodes-base.deepseekChatModel' })],
        knownTypes: ['n8n-nodes-base.code']
      },
      exec
    )) as { ok: boolean; issues: Array<{ level: string; message: string }> }
    expect(out.ok).toBe(false)
    expect(out.issues.some((i) => i.message.includes('不支持该节点类型'))).toBe(true)
    expect((store.get('w-build')!.nodes as unknown[]).length).toBe(0)
  })

  it('n8n_validate_workflow 能查出重复 Webhook 路径', async () => {
    const { tools, exec } = collectTools(makeConfig())
    const out = (await tools.get('n8n_validate_workflow')!.execute(
      {
        nodes: [
          node('w1', 'H1', { type: 'n8n-nodes-base.webhook', parameters: { path: 'same' } }),
          node('w2', 'H2', { type: 'n8n-nodes-base.webhook', parameters: { path: 'same' } })
        ],
        connections: {}
      },
      exec
    )) as { ok: boolean; errors: number; issues: Array<{ message: string }> }
    expect(out.ok).toBe(false)
    expect(out.issues.some((i) => i.message.includes('Webhook 路径重复'))).toBe(true)
  })

  it('n8n_snapshot_workflow + n8n_restore_workflow 可以回滚', async () => {
    const { tools, exec } = collectTools(makeConfig())
    seed('w-undo', 'undo-wf', [node('n1', 'A')])
    const snap = (await tools.get('n8n_snapshot_workflow')!.execute({ workflowId: 'w-undo' }, exec)) as {
      snapshotId: string
    }
    expect(snap.snapshotId).toBeTruthy()

    await tools.get('n8n_add_nodes')!.execute({ workflowId: 'w-undo', nodes: [node('n2', 'B')] }, exec)
    expect((store.get('w-undo')!.nodes as unknown[]).length).toBe(2)

    const restored = (await tools.get('n8n_restore_workflow')!.execute({ workflowId: 'w-undo' }, exec)) as {
      ok: boolean
      nodeCount: number
    }
    expect(restored.ok).toBe(true)
    expect(restored.nodeCount).toBe(1)
    expect((store.get('w-undo')!.nodes as unknown[]).length).toBe(1)
  })

  it('n8n_open_editor 返回编辑器链接与 rev', async () => {
    const { tools, exec } = collectTools(makeConfig())
    const out = (await tools.get('n8n_open_editor')!.execute({ workflowId: 'w1', note: '搭建中' }, exec)) as {
      ok: boolean
      editorUrl: string
      rev: number
    }
    expect(out.ok).toBe(true)
    expect(out.editorUrl).toBe(`${baseUrl}/workflow/w1`)
    expect(out.rev).toBeGreaterThan(0)
  })

  it('n8n_update_workflow 自动补全 n8n 要求的必填字段', async () => {
    const { tools, exec } = collectTools(makeConfig())
    seed('w-upd', 'orig', [node('n1', 'A')])
    const out = (await tools.get('n8n_update_workflow')!.execute(
      { workflowId: 'w-upd', workflow: { name: 'renamed' } },
      exec
    )) as { ok: boolean; verified: boolean }
    expect(out.ok).toBe(true)
    const stored = store.get('w-upd')!
    expect(stored.name).toBe('renamed')
    expect(Array.isArray(stored.nodes)).toBe(true)
    expect(stored.connections).toBeDefined()
    expect(stored.settings).toBeDefined()
  })
})

describe('E2E：搭建会话（计划 → 进度 → 暂停生效）', () => {
  it('声明计划后，add_nodes 的结果会落到对应步骤上', async () => {
    const { tools, exec } = collectTools(makeConfig())
    seed('w-sess', 'sess-wf')

    const begun = (await tools.get('n8n_begin_build_session')!.execute(
      {
        workflowId: 'w-sess',
        goal: '收到 POST 返回问候语',
        steps: [
          { id: 's1', title: '加 Webhook 触发器' },
          { id: 's2', title: '加 Code 节点' }
        ]
      },
      exec
    )) as { ok: boolean; sessionId: string; progress: { total: number; percent: number } }
    expect(begun.ok).toBe(true)
    expect(begun.sessionId).toBeTruthy()
    expect(begun.progress).toMatchObject({ total: 2, percent: 0 })

    await tools.get('n8n_add_nodes')!.execute(
      { workflowId: 'w-sess', nodes: [node('n1', 'Hook')], stepId: 's1' },
      exec
    )

    const got = (await tools.get('n8n_get_build_session')!.execute({ workflowId: 'w-sess' }, exec)) as {
      ok: boolean
      session: { steps: Array<{ id: string; status: string; added?: number; verified?: boolean }> }
      progress: { done: number; percent: number }
    }
    expect(got.ok).toBe(true)
    expect(got.session.steps[0]).toMatchObject({ id: 's1', status: 'done', added: 1, verified: true })
    expect(got.session.steps[1]?.status).toBe('pending')
    expect(got.progress.percent).toBe(50)
  })

  it('暂停期间写操作被拦下，恢复后继续', async () => {
    const { tools, exec } = collectTools(makeConfig())
    seed('w-pause', 'pause-wf')
    const begun = (await tools.get('n8n_begin_build_session')!.execute(
      { workflowId: 'w-pause', goal: 'g', steps: [{ id: 's1', title: 'step' }] },
      exec
    )) as { sessionId: string }

    const paused = (await tools.get('n8n_set_build_session_state')!.execute(
      { sessionId: begun.sessionId, state: 'paused' },
      exec
    )) as { session: { status: string } }
    expect(paused.session.status).toBe('paused')

    const blocked = (await tools.get('n8n_add_nodes')!.execute(
      { workflowId: 'w-pause', nodes: [node('x1', 'X')], stepId: 's1' },
      exec
    )) as { ok: boolean; blocked?: boolean; error?: string }
    expect(blocked.ok).toBe(false)
    expect(blocked.blocked).toBe(true)
    expect(blocked.error).toContain('暂停')
    expect((store.get('w-pause')!.nodes as unknown[]).length).toBe(0)

    await tools.get('n8n_set_build_session_state')!.execute(
      { sessionId: begun.sessionId, state: 'running' },
      exec
    )
    const ok = (await tools.get('n8n_add_nodes')!.execute(
      { workflowId: 'w-pause', nodes: [node('x1', 'X')], stepId: 's1' },
      exec
    )) as { ok: boolean }
    expect(ok.ok).toBe(true)
    expect((store.get('w-pause')!.nodes as unknown[]).length).toBe(1)
  })

  it('取消会话会把未完成的步骤标为 skipped', async () => {
    const { tools, exec } = collectTools(makeConfig())
    seed('w-cancel', 'cancel-wf')
    const begun = (await tools.get('n8n_begin_build_session')!.execute(
      {
        workflowId: 'w-cancel',
        goal: 'g',
        steps: [
          { id: 'a', title: 'A' },
          { id: 'b', title: 'B' }
        ]
      },
      exec
    )) as { sessionId: string }
    const out = (await tools.get('n8n_set_build_session_state')!.execute(
      { sessionId: begun.sessionId, state: 'cancelled', note: '用户终止' },
      exec
    )) as { session: { steps: Array<{ status: string }>; status: string } }
    expect(out.session.status).toBe('cancelled')
    expect(out.session.steps.every((s) => s.status === 'skipped')).toBe(true)
  })

  it('查不到会话时返回可读提示而不是抛错', async () => {
    const { tools, exec } = collectTools(makeConfig())
    const out = (await tools.get('n8n_get_build_session')!.execute(
      { workflowId: 'never-started' },
      exec
    )) as { ok: boolean; error?: string }
    expect(out.ok).toBe(false)
    expect(out.error).toContain('没有找到搭建会话')
  })

  it('非法的 state 会被拒绝', async () => {
    const { tools, exec } = collectTools(makeConfig())
    await expect(
      tools.get('n8n_set_build_session_state')!.execute({ sessionId: 'x', state: 'bogus' }, exec)
    ).rejects.toThrow(/state 必须是/)
  })
})

describe('E2E：凭据向导', () => {
  it('n8n_check_credentials 指出缺失的凭据类型与配置入口', async () => {
    const { tools, exec } = collectTools(makeConfig())
    seed('w-cred', 'cred-wf', [
      { id: 'g1', name: '写入表格', type: 'n8n-nodes-base.googleSheets', typeVersion: 4, position: [0, 0], parameters: {} }
    ])
    const out = (await tools.get('n8n_check_credentials')!.execute({ workflowId: 'w-cred' }, exec)) as {
      ok: boolean
      missing: Array<{ credentialType: string; nodes: string[] }>
      available: string[]
      credentialsUrl?: string
      note: string
    }
    expect(out.ok).toBe(false)
    expect(out.missing.map((m) => m.credentialType)).toContain('googleSheetsOAuth2Api')
    expect(out.available).toContain('openAiApi')
    expect(out.credentialsUrl).toContain('/home/credentials')
    expect(out.note).toContain('不会读取')
  })

  it('凭据齐全时 ok=true', async () => {
    const { tools, exec } = collectTools(makeConfig())
    seed('w-cred2', 'cred-wf2', [
      { id: 'o1', name: 'LLM', type: 'n8n-nodes-base.openAi', typeVersion: 1, position: [0, 0], parameters: {} }
    ])
    const out = (await tools.get('n8n_check_credentials')!.execute({ workflowId: 'w-cred2' }, exec)) as {
      ok: boolean
    }
    expect(out.ok).toBe(true)
  })
})
