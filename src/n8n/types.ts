/**
 * n8n 数据类型 —— 与 n8n 公开 API（2.44.0 源码核验）保持一致的字段。
 * 说明：为「完完全全照搬 n8n」，这里只声明已知字段，其余字段用索引签名原样透传。
 */

/** 单条工作流（`GET /api/v1/workflows` 的 data[] 元素）。 */
export interface WorkflowSummary {
  id: string
  name: string
  /** 已弃用：改用 activeVersionId !== null。 */
  active: boolean
  activeVersionId?: string | null
  tags?: unknown
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

/** `GET /api/v1/workflows` 响应（n8n 原始结构）。 */
export interface WorkflowsListResponse {
  data: WorkflowSummary[]
  nextCursor?: string | null
  [key: string]: unknown
}

/** 单条执行（`GET /api/v1/executions/{id}`，n8n 原始结构）。 */
export interface ExecutionResponse {
  id: string
  /** 已弃用：改用 status。 */
  finished?: boolean
  mode?: string
  status?: string
  workflowId?: string
  startedAt?: string
  stoppedAt?: string
  data?: unknown
  [key: string]: unknown
}

/** `GET /api/v1/executions` 响应。 */
export interface ExecutionsListResponse {
  data: ExecutionResponse[]
  nextCursor?: string | null
  [key: string]: unknown
}

/** Webhook 触发结果。 */
export interface TriggerResult {
  ok: boolean
  /** HTTP 状态码。 */
  status: number
  /** 工作流返回体原样透传（responseMode=lastNode/responseNode 时才有执行结果）。 */
  result?: unknown
}

/**
 * 凭据元数据（`GET /api/v1/credentials` 的 data[] 元素）。
 * n8n 只返回 id/name/type 这类描述信息，**不包含任何密钥**。
 */
export interface CredentialSummary {
  id: string
  name: string
  type: string
  [key: string]: unknown
}

/** `GET /api/v1/credentials` 响应。 */
export interface CredentialListResponse {
  data: CredentialSummary[]
  nextCursor?: string | null
  [key: string]: unknown
}
