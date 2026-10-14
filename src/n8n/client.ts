/**
 * n8n 客户端（通信层）。
 *
 * 基于 n8n 2.44.0 公开 API 核验：
 * - 公开 API 基址 `/api/v1`，鉴权头为 `X-N8N-API-KEY`（不是 Bearer）。
 * - 公开 API **没有触发工作流的端点**，触发一律 POST 工作流自身的 Webhook URL：
 *   生产 `{base}/webhook/{path}`，测试 `{base}/webhook-test/{path}`。
 *
 * 本模块是纯逻辑（仅依赖全局 fetch），不 import DSH 运行时，便于单元测试。
 */
import { normalizeWebhookPath } from './guard.js'
import type {
  ExecutionDetail,
  ExecutionStatus,
  ListWorkflowsResult,
  TriggerResult,
  WorkflowSummary
} from './types.js'

export interface N8nClientOptions {
  /** n8n 实例基址，如 https://n8n.example.com（可带/不带结尾斜杠）。 */
  baseUrl: string
  /** 公开 API Key，放入 `X-N8N-API-KEY` 头。 */
  apiKey: string
  /** 可选：Webhook 节点开启 Header 认证时的头名与值。 */
  webhookAuth?: { header: string; value: string }
  /** 请求超时（毫秒），默认 30000。 */
  timeoutMs?: number
  /** 可注入的 fetch 实现（测试用）。 */
  fetchImpl?: typeof fetch
}

export interface ListWorkflowsParams {
  active?: boolean
  tags?: string
  name?: string
  limit?: number
  cursor?: string
}

/** n8n API 返回非 2xx 时抛出。 */
export class N8nApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string
  ) {
    super(`n8n API ${status} on ${path}: ${body.slice(0, 300)}`)
    this.name = 'N8nApiError'
  }
}

const DEFAULT_TIMEOUT_MS = 30_000

export class N8nClient {
  private readonly base: string
  private readonly apiKey: string
  private readonly webhookAuth?: { header: string; value: string }
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: N8nClientOptions) {
    if (!options.baseUrl) throw new Error('n8n baseUrl 不能为空')
    if (!options.apiKey) throw new Error('n8n apiKey 不能为空')
    this.base = options.baseUrl.replace(/\/+$/, '')
    this.apiKey = options.apiKey
    this.webhookAuth = options.webhookAuth
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  /** 列出工作流。GET /api/v1/workflows */
  async listWorkflows(params: ListWorkflowsParams = {}): Promise<ListWorkflowsResult> {
    const query = new URLSearchParams()
    if (params.active !== undefined) query.set('active', String(params.active))
    if (params.tags) query.set('tags', params.tags)
    if (params.name) query.set('name', params.name)
    if (params.limit !== undefined) query.set('limit', String(params.limit))
    if (params.cursor) query.set('cursor', params.cursor)

    const qs = query.toString()
    const body = await this.request<{ data?: WorkflowSummary[]; nextCursor?: string }>(
      `/api/v1/workflows${qs ? `?${qs}` : ''}`
    )
    return {
      workflows: Array.isArray(body.data) ? body.data : [],
      nextCursor: body.nextCursor
    }
  }

  /** 取单个工作流详情。GET /api/v1/workflows/{id} */
  async getWorkflow(workflowId: string): Promise<WorkflowSummary> {
    return this.request<WorkflowSummary>(`/api/v1/workflows/${encodeURIComponent(workflowId)}`)
  }

  /** 查询执行状态。GET /api/v1/executions/{id} */
  async getExecution(executionId: string, includeData = false): Promise<ExecutionDetail> {
    const qs = includeData ? '?includeData=true' : ''
    const raw = await this.request<Record<string, unknown>>(
      `/api/v1/executions/${encodeURIComponent(executionId)}${qs}`
    )
    return {
      executionId: String(raw.id ?? executionId),
      status: (raw.status as ExecutionStatus) ?? 'unknown',
      finished: typeof raw.finished === 'boolean' ? raw.finished : undefined,
      mode: typeof raw.mode === 'string' ? raw.mode : undefined,
      workflowId: raw.workflowId !== undefined ? String(raw.workflowId) : undefined,
      startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : undefined,
      stoppedAt: typeof raw.stoppedAt === 'string' ? raw.stoppedAt : undefined,
      data: raw.data
    }
  }

  /**
   * 触发工作流：POST 到 Webhook URL。
   * @param webhookPath Webhook 节点配置的路径（不含前导 /webhook）。
   * @param payload     JSON 请求体。
   * @param options.test 使用 /webhook-test/ 而非 /webhook/。
   */
  async triggerWebhook(
    webhookPath: string,
    payload: unknown = {},
    options: { test?: boolean } = {}
  ): Promise<TriggerResult> {
    const prefix = options.test ? 'webhook-test' : 'webhook'
    const url = `${this.base}/${prefix}/${normalizeWebhookPath(webhookPath)}`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
    if (this.webhookAuth) headers[this.webhookAuth.header] = this.webhookAuth.value

    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload ?? {}),
      signal: AbortSignal.timeout(this.timeoutMs)
    })

    const text = await res.text()
    let result: unknown = text
    if (text) {
      try {
        result = JSON.parse(text)
      } catch {
        result = text
      }
    } else {
      result = undefined
    }

    if (!res.ok) throw new N8nApiError(res.status, `${prefix}/${normalizeWebhookPath(webhookPath)}`, text)
    return { ok: true, status: res.status, result }
  }

  private async request<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method: 'GET',
      headers: {
        'X-N8N-API-KEY': this.apiKey,
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(this.timeoutMs)
    })
    const text = await res.text()
    if (!res.ok) throw new N8nApiError(res.status, path, text)
    try {
      return JSON.parse(text) as T
    } catch {
      throw new N8nApiError(res.status, path, `响应不是合法 JSON: ${text.slice(0, 200)}`)
    }
  }
}
