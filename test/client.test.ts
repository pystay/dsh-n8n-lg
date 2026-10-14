import { describe, it, expect, vi } from 'vitest'
import { N8nClient, N8nApiError } from '../src/n8n/client'

interface CapturedCall {
  url: string
  init: { method?: string; headers: Record<string, string>; body?: string }
}

function jsonResponse(body: unknown, status = 200) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text
  }
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

describe('N8nClient.listWorkflows', () => {
  it('拼接查询参数、带 X-N8N-API-KEY 头、解析 data/nextCursor', async () => {
    const { client, calls } = makeClient(() =>
      jsonResponse({ data: [{ id: '1', name: 'wf', active: true }], nextCursor: 'c1' })
    )
    const res = await client.listWorkflows({ active: true, limit: 10 })
    expect(res.workflows).toHaveLength(1)
    expect(res.workflows[0]?.name).toBe('wf')
    expect(res.nextCursor).toBe('c1')
    expect(calls[0]?.url).toBe('https://n8n.test/api/v1/workflows?active=true&limit=10')
    expect(calls[0]?.init.headers['X-N8N-API-KEY']).toBe('secret-key')
    expect(calls[0]?.init.method).toBe('GET')
  })

  it('data 非数组时返回空列表', async () => {
    const { client } = makeClient(() => jsonResponse({}))
    const res = await client.listWorkflows()
    expect(res.workflows).toEqual([])
    expect(res.nextCursor).toBeUndefined()
  })
})

describe('N8nClient.getExecution', () => {
  it('映射执行字段，includeData 控制查询参数', async () => {
    const { client, calls } = makeClient(() =>
      jsonResponse({
        id: 42,
        status: 'success',
        finished: true,
        mode: 'webhook',
        workflowId: 'wf1',
        startedAt: '2026-01-01T00:00:00.000Z',
        data: { resultData: {} }
      })
    )
    const res = await client.getExecution('42', true)
    expect(res.executionId).toBe('42')
    expect(res.status).toBe('success')
    expect(res.finished).toBe(true)
    expect(res.workflowId).toBe('wf1')
    expect(res.data).toEqual({ resultData: {} })
    expect(calls[0]?.url).toBe('https://n8n.test/api/v1/executions/42?includeData=true')
  })
})

describe('N8nClient.triggerWebhook', () => {
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

  it('test=true 时走 /webhook-test/', async () => {
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
