/**
 * 执行相关工具：查询单个执行 / 列出执行 / 重试 / 停止。
 *
 * 全部只读或幂等地作用于 n8n 执行记录，不触碰工作流定义。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { asJson, jsonOutput } from './common.js'
import type { ToolDeps } from './deps.js'

export function registerExecutionTools({ ctx, manager }: ToolDeps): void {
  // 查询执行 —— 对应 GET /api/v1/executions/{id}
  ctx.tools.register(
    defineTool({
      name: 'n8n_get_execution_status',
      description: 'Get one n8n execution by ID (GET /api/v1/executions/{id}).',
      parameters: {
        executionId: { type: 'string', required: true, description: 'The execution ID.' },
        includeData: { type: 'boolean', description: 'Include detailed execution data.' },
        ignoreDataSizeLimit: {
          type: 'boolean',
          description: 'Return full data even if it exceeds the configured size limit.'
        },
        redactExecutionData: {
          type: 'boolean',
          description: 'Force-redact execution output data.'
        }
      },
      output: jsonOutput,
      async execute(args) {
        return asJson(
          await manager.client().getExecution(args.executionId, {
            includeData: args.includeData,
            ignoreDataSizeLimit: args.ignoreDataSizeLimit,
            redactExecutionData: args.redactExecutionData
          })
        )
      }
    })
  )

  // 列出执行 —— 对应 GET /api/v1/executions
  ctx.tools.register(
    defineTool({
      name: 'n8n_list_executions',
      description: 'List n8n executions (GET /api/v1/executions). Returns the raw n8n response.',
      parameters: {
        workflowId: { type: 'string', description: 'Filter by workflow ID.' },
        projectId: { type: 'string', description: 'Filter by project ID.' },
        status: {
          type: 'string',
          description: 'Filter by status: new | running | success | error | canceled | crashed | waiting.'
        },
        limit: { type: 'number', description: 'Max items to return.' },
        cursor: { type: 'string', description: 'Pagination cursor from a previous response.' },
        includeData: { type: 'boolean', description: 'Include detailed execution data.' },
        startedAfter: { type: 'string', description: 'Only executions started after this ISO date-time.' },
        startedBefore: { type: 'string', description: 'Only executions started before this ISO date-time.' }
      },
      output: jsonOutput,
      async execute(args) {
        return asJson(
          await manager.client().listExecutions({
            workflowId: args.workflowId,
            projectId: args.projectId,
            status: args.status,
            limit: args.limit,
            cursor: args.cursor,
            includeData: args.includeData,
            startedAfter: args.startedAfter,
            startedBefore: args.startedBefore
          })
        )
      }
    })
  )

  // 重试执行 —— POST /api/v1/executions/{id}/retry
  ctx.tools.register(
    defineTool({
      name: 'n8n_retry_execution',
      description: 'Retry a failed n8n execution (POST /api/v1/executions/{id}/retry).',
      parameters: {
        executionId: { type: 'string', required: true, description: 'The execution ID.' },
        loadWorkflow: { type: 'boolean', description: 'Load the workflow from DB before retrying.' }
      },
      output: jsonOutput,
      async execute(args) {
        return asJson(await manager.client().retryExecution(args.executionId, args.loadWorkflow ?? false))
      }
    })
  )

  // 停止执行 —— POST /api/v1/executions/{id}/stop
  ctx.tools.register(
    defineTool({
      name: 'n8n_stop_execution',
      description: 'Stop a running n8n execution (POST /api/v1/executions/{id}/stop).',
      parameters: {
        executionId: { type: 'string', required: true, description: 'The execution ID.' }
      },
      output: jsonOutput,
      async execute(args) {
        return asJson(await manager.client().stopExecution(args.executionId))
      }
    })
  )
}
