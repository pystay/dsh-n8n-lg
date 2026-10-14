/**
 * 工具注册层：把 n8n 公开 API 能力以「完全照搬 n8n」的方式暴露给 Agent。
 *
 * 参数名、取值语义、响应体均与 n8n 公开 API（2.44.0）保持一致，不做改名或裁剪。
 */
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from '../config.js'
import { N8nClient } from '../n8n/client.js'
import { isWebhookPathAllowed } from '../n8n/guard.js'

/** 输出为原样 JSON（DSH 要求 execute 返回 canonical lossless-JSON 值）。 */
const jsonOutput = {
  schema: { type: 'json' as const },
  render: (_args: unknown, value: JsonValue): Array<{ type: 'text'; text: string }> => [
    { type: 'text', text: JSON.stringify(value, null, 2) }
  ]
}

/** 把 n8n 原始响应转为 DSH 要求的 JSON 值。 */
function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

export function registerTools(ctx: Context, client: N8nClient, config: Config): void {
  // 1) 列出工作流 —— 对应 GET /api/v1/workflows
  ctx.tools.register(
    defineTool({
      name: 'n8n_list_workflows',
      description:
        'List n8n workflows (GET /api/v1/workflows). Returns the raw n8n response ({ data, nextCursor }).',
      parameters: {
        active: { type: 'boolean', description: 'Filter by active (published) state.' },
        name: { type: 'string', description: 'Filter by workflow name.' },
        tags: { type: 'string', description: 'Filter by tags (comma-separated).' },
        limit: { type: 'number', description: 'Max items to return.' },
        cursor: { type: 'string', description: 'Pagination cursor from a previous response.' },
        projectId: { type: 'string', description: 'Filter by project ID.' },
        excludePinnedData: { type: 'boolean', description: 'Exclude pinned data from the result.' }
      },
      output: jsonOutput,
      async execute(args) {
        const result = await client.listWorkflows({
          active: args.active,
          name: args.name,
          tags: args.tags,
          limit: args.limit,
          cursor: args.cursor,
          projectId: args.projectId,
          excludePinnedData: args.excludePinnedData
        })
        return asJson(result)
      }
    })
  )

  // 2) 取工作流详情 —— 对应 GET /api/v1/workflows/{id}
  ctx.tools.register(
    defineTool({
      name: 'n8n_get_workflow',
      description: 'Get one n8n workflow by ID (GET /api/v1/workflows/{id}).',
      parameters: {
        workflowId: { type: 'string', required: true, description: 'The workflow ID.' }
      },
      output: jsonOutput,
      async execute(args) {
        return asJson(await client.getWorkflow(args.workflowId))
      }
    })
  )

  // 3) 触发工作流 —— POST 工作流 Webhook URL（n8n 公开 API 无触发端点）
  ctx.tools.register(
    defineTool({
      name: 'n8n_trigger_workflow',
      description:
        'Trigger an n8n workflow by POSTing to its Webhook URL ({base}/webhook/{path}). ' +
        'Returns the workflow response as-is; with responseMode "lastNode"/"responseNode" this is the execution result.',
      parameters: {
        webhookPath: {
          type: 'string',
          required: true,
          description: 'Webhook path configured on the workflow Webhook node (without the leading /webhook).'
        },
        payload: {
          type: 'json',
          description: 'JSON body sent to the webhook. Defaults to {}.'
        },
        test: {
          type: 'boolean',
          description: 'Use the test webhook URL (/webhook-test/) instead of production.'
        }
      },
      output: jsonOutput,
      async execute(args) {
        if (!isWebhookPathAllowed(args.webhookPath, config.allowedWebhookPaths)) {
          throw new Error(`Webhook 路径不在白名单内：${args.webhookPath}`)
        }
        const result = await client.triggerWebhook(args.webhookPath, args.payload ?? {}, {
          test: args.test ?? config.useTestWebhook
        })
        return asJson(result)
      }
    })
  )

  // 4) 查询执行 —— 对应 GET /api/v1/executions/{id}
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
        const result = await client.getExecution(args.executionId, {
          includeData: args.includeData,
          ignoreDataSizeLimit: args.ignoreDataSizeLimit,
          redactExecutionData: args.redactExecutionData
        })
        return asJson(result)
      }
    })
  )

  // 5) 列出执行 —— 对应 GET /api/v1/executions
  ctx.tools.register(
    defineTool({
      name: 'n8n_list_executions',
      description: 'List n8n executions (GET /api/v1/executions). Returns the raw n8n response.',
      parameters: {
        workflowId: { type: 'string', description: 'Filter by workflow ID.' },
        projectId: { type: 'string', description: 'Filter by project ID.' },
        status: {
          type: 'string',
          description:
            'Filter by status: new | running | success | error | canceled | crashed | waiting.'
        },
        limit: { type: 'number', description: 'Max items to return.' },
        cursor: { type: 'string', description: 'Pagination cursor from a previous response.' },
        includeData: { type: 'boolean', description: 'Include detailed execution data.' },
        startedAfter: { type: 'string', description: 'Only executions started after this ISO date-time.' },
        startedBefore: { type: 'string', description: 'Only executions started before this ISO date-time.' }
      },
      output: jsonOutput,
      async execute(args) {
        const result = await client.listExecutions({
          workflowId: args.workflowId,
          projectId: args.projectId,
          status: args.status,
          limit: args.limit,
          cursor: args.cursor,
          includeData: args.includeData,
          startedAfter: args.startedAfter,
          startedBefore: args.startedBefore
        })
        return asJson(result)
      }
    })
  )
}
