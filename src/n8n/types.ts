/**
 * n8n 数据类型（基于 n8n 2.44.0 公开 API 核验后的最小子集）。
 */

/** `GET /api/v1/workflows` 返回的单条工作流（只保留插件需要的字段）。 */
export interface WorkflowSummary {
  id: string
  name: string
  /** 是否启用。注意：新版本 n8n 已弃用，改用 activeVersionId !== null。 */
  active: boolean
  activeVersionId?: string | null
  tags?: string[]
  updatedAt?: string
}

export interface ListWorkflowsResult {
  workflows: WorkflowSummary[]
  /** 分页游标，传给下一次请求的 cursor。 */
  nextCursor?: string
}

/** 执行状态（n8n `status` 枚举）。 */
export type ExecutionStatus =
  | 'new'
  | 'running'
  | 'success'
  | 'error'
  | 'canceled'
  | 'crashed'
  | 'waiting'
  | 'unknown'

export interface ExecutionDetail {
  executionId: string
  status: ExecutionStatus
  finished?: boolean
  mode?: string
  workflowId?: string
  startedAt?: string
  stoppedAt?: string
  /** 仅当 includeData=true 时返回。 */
  data?: unknown
}

/** Webhook 触发结果。 */
export interface TriggerResult {
  ok: boolean
  /** HTTP 状态码。 */
  status: number
  /**
   * 工作流返回体。仅当 Webhook 节点 responseMode 为 `lastNode` 或
   * `responseNode`（配合 Respond to Webhook）时才有执行结果；
   * `onReceived` 模式下通常为空。
   */
  result?: unknown
}
