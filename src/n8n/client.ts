/**
 * n8n 客户端（通信层）—— 完全照搬 n8n 公开 API。
 *
 * 依据 n8n 2.44.0 源码（packages/cli/src/public-api/v1/handlers/<resource>/spec/paths）：
 * - 基址 `/api/v1`，鉴权头 `X-N8N-API-KEY`（不是 Bearer）。
 * - 公开 API **没有触发端点**；触发一律 POST 工作流自身的 Webhook：
 *   生产 `{base}/webhook/{path}`，测试 `{base}/webhook-test/{path}`。
 * - 响应体原样透传，不做字段改名/裁剪。
 *
 * 纯逻辑（仅依赖全局 fetch），不 import DSH 运行时，便于单元/集成测试。
 */
import { normalizeWebhookPath } from './guard.js'
import type {
  ExecutionResponse,
  ExecutionsListResponse,
  TriggerResult,
  WorkflowSummary,
  WorkflowsListResponse
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

/** `GET /api/v1/workflows` 查询参数（与 n8n 一一对应）。 */
export interface ListWorkflowsParams {
  active?: boolean
  tags?: string
  name?: string
  limit?: number
  cursor?: string
  projectId?: string
  excludePinnedData?: boolean
}

/** `GET /api/v1/executions` 查询参数（与 n8n 一一对应）。 */
export interface ListExecutionsParams {
  workflowId?: string
  projectId?: string
  status?: string
  limit?: number
  cursor?: string
  includeData?: boolean
  startedAfter?: string
  startedBefore?: string
}

/** `GET /api/v1/executions/{id}` 查询参数（与 n8n 一一对应）。 */
export interface GetExecutionParams {
  includeData?: boolean
  ignoreDataSizeLimit?: boolean
  redactExecutionData?: boolean
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

/** 把布尔值序列化为 n8n 期望的 'true'/'false' 字符串。 */
function boolParam(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : String(value)
}

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

  /** 列出工作流。GET /api/v1/workflows（响应原样返回）。 */
  async listWorkflows(params: ListWorkflowsParams = {}): Promise<WorkflowsListResponse> {
    const query = new URLSearchParams()
    const set = (k: string, v: string | undefined) => {
      if (v !== undefined) query.set(k, v)
    }
    set('active', boolParam(params.active))
    set('tags', params.tags)
    set('name', params.name)
    set('limit', params.limit === undefined ? undefined : String(params.limit))
    set('cursor', params.cursor)
    set('projectId', params.projectId)
    set('excludePinnedData', boolParam(params.excludePinnedData))
    const qs = query.toString()
    return this.request<WorkflowsListResponse>(`/api/v1/workflows${qs ? `?${qs}` : ''}`)
  }

  /** 取单个工作流。GET /api/v1/workflows/{id} */
  async getWorkflow(workflowId: string): Promise<WorkflowSummary> {
    return this.request<WorkflowSummary>(`/api/v1/workflows/${encodeURIComponent(workflowId)}`)
  }

  /** 列出执行。GET /api/v1/executions */
  async listExecutions(params: ListExecutionsParams = {}): Promise<ExecutionsListResponse> {
    const query = new URLSearchParams()
    const set = (k: string, v: string | undefined) => {
      if (v !== undefined) query.set(k, v)
    }
    set('workflowId', params.workflowId)
    set('projectId', params.projectId)
    set('status', params.status)
    set('limit', params.limit === undefined ? undefined : String(params.limit))
    set('cursor', params.cursor)
    set('includeData', boolParam(params.includeData))
    set('startedAfter', params.startedAfter)
    set('startedBefore', params.startedBefore)
    const qs = query.toString()
    return this.request<ExecutionsListResponse>(`/api/v1/executions${qs ? `?${qs}` : ''}`)
  }

  /** 查询单个执行。GET /api/v1/executions/{id}（响应原样返回）。 */
  async getExecution(
    executionId: string,
    params: GetExecutionParams = {}
  ): Promise<ExecutionResponse> {
    const query = new URLSearchParams()
    const set = (k: string, v: string | undefined) => {
      if (v !== undefined) query.set(k, v)
    }
    set('includeData', boolParam(params.includeData))
    set('ignoreDataSizeLimit', boolParam(params.ignoreDataSizeLimit))
    set('redactExecutionData', boolParam(params.redactExecutionData))
    const qs = query.toString()
    return this.request<ExecutionResponse>(
      `/api/v1/executions/${encodeURIComponent(executionId)}${qs ? `?${qs}` : ''}`
    )
  }

  /**
   * 触发工作流：POST 到 Webhook URL。
   * @param webhookPath Webhook 节点配置的路径（不含前导 /webhook）。
   * @param payload     JSON 请求体（任意 JSON）。
   * @param options.test 使用 /webhook-test/ 而非 /webhook/。
   */
  async triggerWebhook(
    webhookPath: string,
    payload: unknown = {},
    options: { test?: boolean } = {}
  ): Promise<TriggerResult> {
    const prefix = options.test ? 'webhook-test' : 'webhook'
    const path = normalizeWebhookPath(webhookPath)
    const url = `${this.base}/${prefix}/${path}`

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
    let result: unknown
    if (!text) {
      result = undefined
    } else {
      try {
        result = JSON.parse(text)
      } catch {
        result = text
      }
    }

    if (!res.ok) throw new N8nApiError(res.status, `${prefix}/${path}`, text)
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
