/**
 * 工具注册层：把 n8n 公开 API 能力以「完全照搬 n8n」的方式暴露给 Agent。
 *
 * 参数名、取值语义、响应体均与 n8n 公开 API（2.44.0）保持一致，不做改名或裁剪。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from '../config.js'
import { N8nClient } from '../n8n/client.js'
import { isWebhookPathAllowed } from '../n8n/guard.js'
import { asJson, jsonOutput } from './common.js'

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

  // 6) 创建工作流 —— POST /api/v1/workflows
  ctx.tools.register(
    defineTool({
      name: 'n8n_create_workflow',
      description:
        'Create an n8n workflow (POST /api/v1/workflows). Pass the full n8n workflow JSON (name, nodes, connections, settings).',
      parameters: {
        workflow: { type: 'json', required: true, description: 'Full workflow JSON object.' }
      },
      output: jsonOutput,
      async execute(args) {
        const wf = args.workflow as { name?: unknown }
        if (!wf || typeof wf !== 'object' || typeof wf.name !== 'string') {
          throw new Error('workflow 必须是含 name 的 JSON 对象')
        }
        return asJson(await client.createWorkflow(wf as never))
      }
    })
  )

  // 7) 更新工作流 —— PUT /api/v1/workflows/{id}
  ctx.tools.register(
    defineTool({
      name: 'n8n_update_workflow',
      description: 'Update an n8n workflow (PUT /api/v1/workflows/{id}).',
      parameters: {
        workflowId: { type: 'string', required: true, description: 'The workflow ID.' },
        workflow: { type: 'json', required: true, description: 'Fields to update (e.g. name/nodes/connections).' }
      },
      output: jsonOutput,
      async execute(args) {
        return asJson(await client.updateWorkflow(args.workflowId, args.workflow as never))
      }
    })
  )

  // 8) 删除工作流 —— DELETE /api/v1/workflows/{id}（需先停用）
  ctx.tools.register(
    defineTool({
      name: 'n8n_delete_workflow',
      description:
        'Delete an n8n workflow (DELETE /api/v1/workflows/{id}). An active workflow must be deactivated first.',
      parameters: {
        workflowId: { type: 'string', required: true, description: 'The workflow ID.' }
      },
      output: jsonOutput,
      async execute(args) {
        await client.deleteWorkflow(args.workflowId)
        return asJson({ deleted: true, workflowId: args.workflowId })
      }
    })
  )

  // 9) 启用工作流 —— POST /api/v1/workflows/{id}/publish（回退 /activate）
  ctx.tools.register(
    defineTool({
      name: 'n8n_activate_workflow',
      description: 'Activate (publish) an n8n workflow so its triggers/webhooks become live.',
      parameters: {
        workflowId: { type: 'string', required: true, description: 'The workflow ID.' }
      },
      output: jsonOutput,
      async execute(args) {
        return asJson(await client.activateWorkflow(args.workflowId))
      }
    })
  )

  // 10) 停用工作流 —— POST /api/v1/workflows/{id}/deactivate
  ctx.tools.register(
    defineTool({
      name: 'n8n_deactivate_workflow',
      description: 'Deactivate an n8n workflow.',
      parameters: {
        workflowId: { type: 'string', required: true, description: 'The workflow ID.' }
      },
      output: jsonOutput,
      async execute(args) {
        return asJson(await client.deactivateWorkflow(args.workflowId))
      }
    })
  )

  // 11) 重试执行 —— POST /api/v1/executions/{id}/retry
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
        return asJson(await client.retryExecution(args.executionId, args.loadWorkflow ?? false))
      }
    })
  )

  // 12) 停止执行 —— POST /api/v1/executions/{id}/stop
  ctx.tools.register(
    defineTool({
      name: 'n8n_stop_execution',
      description: 'Stop a running n8n execution (POST /api/v1/executions/{id}/stop).',
      parameters: {
        executionId: { type: 'string', required: true, description: 'The execution ID.' }
      },
      output: jsonOutput,
      async execute(args) {
        return asJson(await client.stopExecution(args.executionId))
      }
    })
  )
}
