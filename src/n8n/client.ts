/**
 * n8n 客户端（通信层）—— 完全照搬 n8n 公开 API。
 *
 * 依据 n8n 2.44.0 源码（packages/cli/src/public-api/v1/handlers/<resource>/spec/paths）：
 * - 基址 `/api/v1`，鉴权头 `X-N8N-API-KEY`（不是 Bearer）。
 * - 公开 API **没有触发端点**；触发一律请求工作流自身的 Webhook：
 *   生产 `{base}/webhook/{path}`，测试 `{base}/webhook-test/{path}`。
 * - 响应体原样透传，不做字段改名/裁剪。
 *
 * 纯逻辑（仅依赖全局 fetch），不 import DSH 运行时，便于单元/集成测试。
 */
import { buildWebhookUrl, normalizeWebhookPath } from './guard.js'
import type {
  CredentialListResponse,
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

/** 工作流请求体（n8n workflow 结构原样透传）。 */
export interface WorkflowBody {
  name: string
  nodes: unknown[]
  connections: unknown
  settings?: unknown
  [key: string]: unknown
}

/** 触发 Webhook 的可选参数。 */
export interface TriggerOptions {
  /** 使用 /webhook-test/ 而非 /webhook/（调试用）。 */
  test?: boolean
  /** HTTP 方法，默认 POST。GET/HEAD 不发送请求体。 */
  method?: string
  /** 追加到查询串的参数。 */
  query?: Record<string, string>
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
const SAFE_METHOD = /^[A-Z]+$/

/** 把布尔值序列化为 n8n 期望的 'true'/'false' 字符串。 */
function boolParam(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : String(value)
}

interface RequestInitLite {
  method?: string
  body?: unknown
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

  /** 实例基址（供 UI 拼接编辑器链接）。 */
  get baseUrl(): string {
    return this.base
  }

  // ---------------- Workflows ----------------

  /** 列出工作流。GET /api/v1/workflows */
  async listWorkflows(params: ListWorkflowsParams = {}): Promise<WorkflowsListResponse> {
    const query = buildQuery({
      active: boolParam(params.active),
      tags: params.tags,
      name: params.name,
      limit: params.limit === undefined ? undefined : String(params.limit),
      cursor: params.cursor,
      projectId: params.projectId,
      excludePinnedData: boolParam(params.excludePinnedData)
    })
    return this.request<WorkflowsListResponse>(`/api/v1/workflows${query}`)
  }

  /** 取单个工作流。GET /api/v1/workflows/{id} */
  async getWorkflow(workflowId: string): Promise<WorkflowSummary> {
    return this.request<WorkflowSummary>(`/api/v1/workflows/${encodeURIComponent(workflowId)}`)
  }

  /** 创建工作流。POST /api/v1/workflows */
  async createWorkflow(body: WorkflowBody): Promise<WorkflowSummary> {
    return this.request<WorkflowSummary>('/api/v1/workflows', { method: 'POST', body })
  }

  /**
   * 更新工作流。PUT /api/v1/workflows/{id}
   *
   * `publishIfActive=false` 时，已发布的工作流只保存为草稿，不会自动重新发布
   * （n8n 默认 true，会让 AI 的中间状态直接上线）。
   */
  async updateWorkflow(
    workflowId: string,
    body: Partial<WorkflowBody>,
    options: { publishIfActive?: boolean } = {}
  ): Promise<WorkflowSummary> {
    const query =
      options.publishIfActive === undefined ? '' : `?publishIfActive=${String(options.publishIfActive)}`
    return this.request<WorkflowSummary>(`/api/v1/workflows/${encodeURIComponent(workflowId)}${query}`, {
      method: 'PUT',
      body
    })
  }

  /** 删除工作流。DELETE /api/v1/workflows/{id}（激活中的工作流需先停用） */
  async deleteWorkflow(workflowId: string): Promise<void> {
    await this.request<unknown>(`/api/v1/workflows/${encodeURIComponent(workflowId)}`, {
      method: 'DELETE'
    })
  }

  /**
   * 启用工作流。优先 POST /workflows/{id}/publish（新版），404/405 时回退 /activate（旧版）。
   */
  async activateWorkflow(workflowId: string): Promise<unknown> {
    const id = encodeURIComponent(workflowId)
    try {
      return await this.request<unknown>(`/api/v1/workflows/${id}/publish`, {
        method: 'POST',
        body: {}
      })
    } catch (err) {
      if (err instanceof N8nApiError && (err.status === 404 || err.status === 405)) {
        return this.request<unknown>(`/api/v1/workflows/${id}/activate`, { method: 'POST', body: {} })
      }
      throw err
    }
  }

  /** 停用工作流。POST /api/v1/workflows/{id}/deactivate */
  async deactivateWorkflow(workflowId: string): Promise<unknown> {
    return this.request<unknown>(`/api/v1/workflows/${encodeURIComponent(workflowId)}/deactivate`, {
      method: 'POST',
      body: {}
    })
  }

  // ---------------- Credentials ----------------

  /**
   * 列出凭据。GET /api/v1/credentials
   *
   * 只返回 id/name/type 等元数据，**不含任何密钥**，因此可以安全地用于凭据体检。
   */
  async listCredentials(params: { limit?: number; cursor?: string } = {}): Promise<CredentialListResponse> {
    const query = buildQuery({
      limit: params.limit === undefined ? undefined : String(params.limit),
      cursor: params.cursor
    })
    return this.request<CredentialListResponse>(`/api/v1/credentials${query}`)
  }

  // ---------------- Executions ----------------

  /** 列出执行。GET /api/v1/executions */
  async listExecutions(params: ListExecutionsParams = {}): Promise<ExecutionsListResponse> {
    const query = buildQuery({
      workflowId: params.workflowId,
      projectId: params.projectId,
      status: params.status,
      limit: params.limit === undefined ? undefined : String(params.limit),
      cursor: params.cursor,
      includeData: boolParam(params.includeData),
      startedAfter: params.startedAfter,
      startedBefore: params.startedBefore
    })
    return this.request<ExecutionsListResponse>(`/api/v1/executions${query}`)
  }

  /** 查询单个执行。GET /api/v1/executions/{id} */
  async getExecution(executionId: string, params: GetExecutionParams = {}): Promise<ExecutionResponse> {
    const query = buildQuery({
      includeData: boolParam(params.includeData),
      ignoreDataSizeLimit: boolParam(params.ignoreDataSizeLimit),
      redactExecutionData: boolParam(params.redactExecutionData)
    })
    return this.request<ExecutionResponse>(
      `/api/v1/executions/${encodeURIComponent(executionId)}${query}`
    )
  }

  /** 重试执行。POST /api/v1/executions/{id}/retry */
  async retryExecution(executionId: string, loadWorkflow = false): Promise<ExecutionResponse> {
    return this.request<ExecutionResponse>(
      `/api/v1/executions/${encodeURIComponent(executionId)}/retry`,
      { method: 'POST', body: { loadWorkflow } }
    )
  }

  /** 停止执行。POST /api/v1/executions/{id}/stop */
  async stopExecution(executionId: string): Promise<ExecutionResponse> {
    return this.request<ExecutionResponse>(`/api/v1/executions/${encodeURIComponent(executionId)}/stop`, {
      method: 'POST',
      body: {}
    })
  }

  // ---------------- Webhook trigger ----------------

  /**
   * 触发工作流：请求 Webhook URL。
   *
   * @param webhookPath Webhook 节点配置的路径（不含前导 /webhook）。
   * @param payload     JSON 请求体（GET/HEAD 时不发送）。
   * @param options     test / method / query。
   */
  async triggerWebhook(
    webhookPath: string,
    payload: unknown = {},
    options: TriggerOptions = {}
  ): Promise<TriggerResult> {
    const prefix = options.test ? 'webhook-test' : 'webhook'
    const path = normalizeWebhookPath(webhookPath)
    let url = buildWebhookUrl(this.base, webhookPath, { test: options.test })
    if (options.query && Object.keys(options.query).length > 0) {
      const withQuery = new URL(url)
      for (const [k, v] of Object.entries(options.query)) withQuery.searchParams.set(k, v)
      url = withQuery.toString()
    }

    const rawMethod = (options.method ?? 'POST').toUpperCase()
    const method = SAFE_METHOD.test(rawMethod) ? rawMethod : 'POST'
    const sendsBody = method !== 'GET' && method !== 'HEAD'

    const headers: Record<string, string> = { Accept: 'application/json' }
    if (this.webhookAuth) headers[this.webhookAuth.header] = this.webhookAuth.value
    let body: string | undefined
    if (sendsBody) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(payload ?? {})
    }

    const res = await this.fetchImpl(url, {
      method,
      headers,
      body,
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

  // ---------------- internals ----------------

  private async request<T>(path: string, init: RequestInitLite = {}): Promise<T> {
    const headers: Record<string, string> = {
      'X-N8N-API-KEY': this.apiKey,
      Accept: 'application/json'
    }
    let body: string | undefined
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(init.body)
    }
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body,
      signal: AbortSignal.timeout(this.timeoutMs)
    })
    const text = await res.text()
    if (!res.ok) throw new N8nApiError(res.status, path, text)
    if (!text) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      throw new N8nApiError(res.status, path, `响应不是合法 JSON: ${text.slice(0, 200)}`)
    }
  }
}

/** 构造查询串（忽略 undefined，非空时带前导 ?）。 */
function buildQuery(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined) query.set(k, v)
  const qs = query.toString()
  return qs ? `?${qs}` : ''
}
