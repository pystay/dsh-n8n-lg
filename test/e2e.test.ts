/**
 * 端到端联调测试。
 *
 * 起一个忠实复刻 n8n 公开 API 契约的本地 HTTP 服务（路径 / 鉴权头 / 响应体结构
 * 均与 n8n 2.44.0 一致），再通过 registerTools 注册真实工具定义，
 * 直接调用工具 execute，跑通「工具 → N8nClient → HTTP → 响应」全链路。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { N8nClient } from '../src/n8n/client'
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

beforeAll(async () => {
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
      if (url.pathname === '/api/v1/workflows') {
        return sendJson(res, 200, { data: [WORKFLOW], nextCursor: null })
      }
      if (url.pathname === '/api/v1/workflows/1') {
        return sendJson(res, 200, WORKFLOW)
      }
      if (url.pathname === '/api/v1/executions') {
        return sendJson(res, 200, { data: [EXECUTION], nextCursor: null })
      }
      if (url.pathname === '/api/v1/executions/100') {
        return sendJson(res, 200, EXECUTION)
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

/** 构造一个只捕获工具定义的假 Context。 */
function collectTools(config: Config) {
  const tools = new Map<string, { execute: (args: unknown, exec: unknown) => Promise<unknown> }>()
  const ctx = {
    tools: {
      register: (def: { name: string }) => {
        tools.set(def.name, def as never)
      }
    }
  }
  const client = new N8nClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs
  })
  registerTools(ctx as never, client, config)
  const exec = { signal: new AbortController().signal, deferContext() {}, concludeTurn() {} }
  return { tools, exec }
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    baseUrl,
    apiKey: API_KEY,
    allowedWebhookPaths: [],
    timeoutMs: 5000,
    useTestWebhook: false,
    ...overrides
  }
}

describe('E2E：工具 → N8nClient → n8n(本地复刻)', () => {
  it('注册了全部 5 个工具', () => {
    const { tools } = collectTools(makeConfig())
    expect([...tools.keys()].sort()).toEqual([
      'n8n_get_execution_status',
      'n8n_get_workflow',
      'n8n_list_executions',
      'n8n_list_workflows',
      'n8n_trigger_workflow'
    ])
  })

  it('n8n_list_workflows 返回 n8n 原始 {data,nextCursor}', async () => {
    const { tools, exec } = collectTools(makeConfig())
    const out = (await tools.get('n8n_list_workflows')!.execute({ active: true }, exec)) as {
      data: unknown[]
      nextCursor: null
    }
    expect(out.data).toEqual([WORKFLOW])
    expect(out.nextCursor).toBeNull()
  })

  it('n8n_get_workflow 返回单个工作流', async () => {
    const { tools, exec } = collectTools(makeConfig())
    const out = (await tools.get('n8n_get_workflow')!.execute({ workflowId: '1' }, exec)) as {
      name: string
    }
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

  it('n8n_get_execution_status 返回执行对象', async () => {
    const { tools, exec } = collectTools(makeConfig())
    const out = (await tools
      .get('n8n_get_execution_status')!
      .execute({ executionId: '100' }, exec)) as { status: string }
    expect(out.status).toBe('success')
  })

  it('n8n_list_executions 返回执行列表', async () => {
    const { tools, exec } = collectTools(makeConfig())
    const out = (await tools.get('n8n_list_executions')!.execute({ status: 'success' }, exec)) as {
      data: unknown[]
    }
    expect(out.data).toEqual([EXECUTION])
  })

  it('白名单拒绝未授权 webhook 路径', async () => {
    const { tools, exec } = collectTools(makeConfig({ allowedWebhookPaths: ['deploy'] }))
    await expect(
      tools.get('n8n_trigger_workflow')!.execute({ webhookPath: 'danger' }, exec)
    ).rejects.toThrow(/白名单/)
  })

  it('API Key 错误时公开 API 抛错（服务端 401）', async () => {
    const { tools, exec } = collectTools(makeConfig({ apiKey: 'wrong-key' }))
    await expect(tools.get('n8n_list_workflows')!.execute({}, exec)).rejects.toThrow(/401/)
  })
})
