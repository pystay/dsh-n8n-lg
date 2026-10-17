import { describe, it, expect, vi } from 'vitest'
import { N8nClient, N8nApiError } from '../src/n8n/client'

interface CapturedCall {
  url: string
  init: { method?: string; headers: Record<string, string>; body?: string }
}

function jsonResponse(body: unknown, status = 200) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return { ok: status >= 200 && status < 300, status, text: async () => text }
}

function makeClient(
  responder: (url: string, init: CapturedCall['init']) => unknown,
  options: Partial<ConstructorParameters<typeof N8nClient>[0]> = {}
) {
  const calls: CapturedCall[] = []
  const fetchImpl = vi.fn(async (url: string, init: CapturedCall['init']) => {
    calls.push({ url, init })
    return responder(url, init)
  })
  const client = new N8nClient({
    baseUrl: 'https://n8n.test/',
    apiKey: 'secret-key',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    ...options
  })
  return { client, calls }
}

describe('N8nClient 构造校验', () => {
  it('baseUrl 为空时抛错', () => {
    expect(() => new N8nClient({ baseUrl: '', apiKey: 'k' })).toThrow()
  })
  it('apiKey 为空时抛错', () => {
    expect(() => new N8nClient({ baseUrl: 'https://x', apiKey: '' })).toThrow()
  })
})

describe('N8nClient.listWorkflows（照搬 n8n GET /api/v1/workflows）', () => {
  it('拼接全部查询参数、带 X-N8N-API-KEY 头、原样返回 data/nextCursor', async () => {
    const { client, calls } = makeClient(() =>
      jsonResponse({ data: [{ id: '1', name: 'wf', active: true }], nextCursor: 'c1' })
    )
    const res = await client.listWorkflows({
      active: true,
      name: 'wf',
      tags: 'a,b',
      limit: 10,
      cursor: 'c0',
      projectId: 'p1',
      excludePinnedData: true
    })
    expect(res.data).toHaveLength(1)
    expect(res.data[0]?.name).toBe('wf')
    expect(res.nextCursor).toBe('c1')
    expect(calls[0]?.url).toBe(
      'https://n8n.test/api/v1/workflows?active=true&tags=a%2Cb&name=wf&limit=10&cursor=c0&projectId=p1&excludePinnedData=true'
    )
    expect(calls[0]?.init.headers['X-N8N-API-KEY']).toBe('secret-key')
    expect(calls[0]?.init.method).toBe('GET')
  })

  it('无参数时不带查询串', async () => {
    const { client, calls } = makeClient(() => jsonResponse({ data: [] }))
    await client.listWorkflows()
    expect(calls[0]?.url).toBe('https://n8n.test/api/v1/workflows')
  })
})

describe('N8nClient.getExecution（照搬 n8n GET /api/v1/executions/{id}）', () => {
  it('原样返回执行对象，includeData 等参数正确编码', async () => {
    const { client, calls } = makeClient(() =>
      jsonResponse({
        id: '42',
        status: 'success',
        finished: true,
        mode: 'webhook',
        workflowId: 'wf1',
        data: { resultData: {} }
      })
    )
    const res = await client.getExecution('42', { includeData: true, redactExecutionData: false })
    expect(res.id).toBe('42')
    expect(res.status).toBe('success')
    expect(res.workflowId).toBe('wf1')
    expect(res.data).toEqual({ resultData: {} })
    expect(calls[0]?.url).toBe(
      'https://n8n.test/api/v1/executions/42?includeData=true&redactExecutionData=false'
    )
  })
})

describe('N8nClient.listExecutions（照搬 n8n GET /api/v1/executions）', () => {
  it('拼接 workflowId/status/limit 等参数', async () => {
    const { client, calls } = makeClient(() => jsonResponse({ data: [], nextCursor: null }))
    await client.listExecutions({ workflowId: 'wf1', status: 'error', limit: 5 })
    expect(calls[0]?.url).toBe(
      'https://n8n.test/api/v1/executions?workflowId=wf1&status=error&limit=5'
    )
  })
})

describe('N8nClient.triggerWebhook（n8n 无触发端点 → 走 Webhook）', () => {
  it('POST 到生产 /webhook/{path}，发送 JSON body 并解析结果', async () => {
    const { client, calls } = makeClient(() => jsonResponse({ ok: true, value: 7 }))
    const res = await client.triggerWebhook('my/hook', { a: 1 })
    expect(res.ok).toBe(true)
    expect(res.status).toBe(200)
    expect(res.result).toEqual({ ok: true, value: 7 })
    expect(calls[0]?.url).toBe('https://n8n.test/webhook/my/hook')
    expect(calls[0]?.init.method).toBe('POST')
    expect(calls[0]?.init.body).toBe(JSON.stringify({ a: 1 }))
    expect(calls[0]?.init.headers['Content-Type']).toBe('application/json')
  })

  it('test=true 时走 /webhook-test/ 且去除首尾斜杠', async () => {
    const { client, calls } = makeClient(() => jsonResponse({ ok: true }))
    await client.triggerWebhook('/leading/slash/', {}, { test: true })
    expect(calls[0]?.url).toBe('https://n8n.test/webhook-test/leading/slash')
  })

  it('配置了 webhookAuth 时附带自定义头', async () => {
    const { client, calls } = makeClient(() => jsonResponse({}), {
      webhookAuth: { header: 'X-Hook-Token', value: 'tok' }
    })
    await client.triggerWebhook('h', {})
    expect(calls[0]?.init.headers['X-Hook-Token']).toBe('tok')
  })

  it('payload 缺省时发送 {}', async () => {
    const { client, calls } = makeClient(() => jsonResponse({}))
    await client.triggerWebhook('h')
    expect(calls[0]?.init.body).toBe('{}')
  })

  it('非 2xx 抛 N8nApiError', async () => {
    const { client } = makeClient(() => jsonResponse({ message: 'not found' }, 404))
    await expect(client.triggerWebhook('missing', {})).rejects.toBeInstanceOf(N8nApiError)
  })

  it('空响应体返回 undefined 结果', async () => {
    const { client } = makeClient(() => jsonResponse('', 200))
    const res = await client.triggerWebhook('h', {})
    expect(res.result).toBeUndefined()
  })
})

describe('N8nClient 错误处理', () => {
  it('listWorkflows 非 2xx 抛 N8nApiError 且带状态码', async () => {
    const { client } = makeClient(() => jsonResponse({ message: 'unauthorized' }, 401))
    await expect(client.listWorkflows()).rejects.toMatchObject({ status: 401 })
  })

  it('响应非合法 JSON 时抛 N8nApiError', async () => {
    const { client } = makeClient(() => jsonResponse('not-json', 200))
    await expect(client.listWorkflows()).rejects.toBeInstanceOf(N8nApiError)
  })
})

describe('N8nClient 工作流 CRUD（照搬 n8n）', () => {
  it('createWorkflow → POST /api/v1/workflows', async () => {
    const { client, calls } = makeClient(() => jsonResponse({ id: 'w1', name: 'x' }))
    const body = { name: 'x', nodes: [], connections: {} }
    const res = await client.createWorkflow(body)
    expect(res.id).toBe('w1')
    expect(calls[0]?.init.method).toBe('POST')
    expect(calls[0]?.url).toBe('https://n8n.test/api/v1/workflows')
    expect(calls[0]?.init.headers['Content-Type']).toBe('application/json')
    expect(calls[0]?.init.body).toBe(JSON.stringify(body))
  })

  it('updateWorkflow → PUT /api/v1/workflows/{id}', async () => {
    const { client, calls } = makeClient(() => jsonResponse({ id: 'w1' }))
    await client.updateWorkflow('w1', { name: 'y' })
    expect(calls[0]?.init.method).toBe('PUT')
    expect(calls[0]?.url).toBe('https://n8n.test/api/v1/workflows/w1')
  })

  it('deleteWorkflow → DELETE（空响应体不报错）', async () => {
    const { client, calls } = makeClient(() => jsonResponse('', 200))
    await client.deleteWorkflow('w1')
    expect(calls[0]?.init.method).toBe('DELETE')
    expect(calls[0]?.url).toBe('https://n8n.test/api/v1/workflows/w1')
  })

  it('activateWorkflow 优先 POST /publish', async () => {
    const { client, calls } = makeClient(() => jsonResponse({ active: true }))
    await client.activateWorkflow('w1')
    expect(calls[0]?.url).toBe('https://n8n.test/api/v1/workflows/w1/publish')
  })

  it('activateWorkflow 在 /publish 404 时回退 /activate', async () => {
    const { client, calls } = makeClient((url) =>
      url.includes('/publish') ? jsonResponse({ message: 'nf' }, 404) : jsonResponse({ active: true })
    )
    await client.activateWorkflow('w1')
    expect(calls).toHaveLength(2)
    expect(calls[1]?.url).toBe('https://n8n.test/api/v1/workflows/w1/activate')
  })

  it('deactivateWorkflow → POST /deactivate', async () => {
    const { client, calls } = makeClient(() => jsonResponse({ active: false }))
    await client.deactivateWorkflow('w1')
    expect(calls[0]?.url).toBe('https://n8n.test/api/v1/workflows/w1/deactivate')
  })

  it('retryExecution → POST /retry 带 loadWorkflow', async () => {
    const { client, calls } = makeClient(() => jsonResponse({ id: '100' }))
    await client.retryExecution('100', true)
    expect(calls[0]?.url).toBe('https://n8n.test/api/v1/executions/100/retry')
    expect(calls[0]?.init.body).toBe(JSON.stringify({ loadWorkflow: true }))
  })

  it('stopExecution → POST /stop', async () => {
    const { client, calls } = makeClient(() => jsonResponse({ id: '100', status: 'canceled' }))
    await client.stopExecution('100')
    expect(calls[0]?.url).toBe('https://n8n.test/api/v1/executions/100/stop')
  })
})

describe('N8nClient 重试策略', () => {
  // 退避设为 0，避免测试里真的等待
  const retryOpts = { maxAttempts: 3, retryBackoffMs: 0 }

  it('GET 遇 503 会重试，后续成功则正常返回', async () => {
    let n = 0
    const { client, calls } = makeClient(() => {
      n += 1
      return n === 1 ? jsonResponse('temporarily down', 503) : jsonResponse({ data: [], nextCursor: null })
    }, retryOpts)

    const res = await client.listWorkflows()
    expect(res.data).toEqual([])
    expect(calls).toHaveLength(2)
  })

  it('GET 遇 404 不重试（4xx 是调用方问题，重试无意义）', async () => {
    const { client, calls } = makeClient(() => jsonResponse('nope', 404), retryOpts)
    await expect(client.getWorkflow('missing')).rejects.toThrow(/404/)
    expect(calls).toHaveLength(1)
  })

  it('POST 遇 503 不重试 —— 创建工作流重发会产生两份', async () => {
    const { client, calls } = makeClient(() => jsonResponse('down', 503), retryOpts)
    await expect(client.createWorkflow({ name: 'w', nodes: [], connections: {} })).rejects.toThrow(/503/)
    expect(calls).toHaveLength(1)
  })

  it('DELETE 幂等，遇 5xx 会重试', async () => {
    let n = 0
    const { client, calls } = makeClient(() => {
      n += 1
      return n === 1 ? jsonResponse('down', 502) : jsonResponse('', 200)
    }, retryOpts)
    await client.deleteWorkflow('w1')
    expect(calls).toHaveLength(2)
  })

  it('网络错误会重试，用尽次数后抛出原始错误', async () => {
    const { client, calls } = makeClient(() => {
      throw new TypeError('fetch failed')
    }, retryOpts)
    await expect(client.listWorkflows()).rejects.toThrow(/fetch failed/)
    expect(calls).toHaveLength(3)
  })

  it('maxAttempts: 1 可完全关闭重试', async () => {
    const { client, calls } = makeClient(() => jsonResponse('down', 503), { maxAttempts: 1 })
    await expect(client.listWorkflows()).rejects.toThrow(/503/)
    expect(calls).toHaveLength(1)
  })
})
