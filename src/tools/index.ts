/**
 * 工具注册层：把 n8n 能力暴露给 Agent。
 * MVP 三个工具：list / trigger / getExecution。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from '../config.js'
import { N8nClient } from '../n8n/client.js'
import { isWebhookPathAllowed } from '../n8n/guard.js'

/** 统一的字符串输出渲染。 */
const renderText = (_args: unknown, value: string): Array<{ type: 'text'; text: string }> => [
  { type: 'text', text: value }
]

const textOutput = { schema: { type: 'string' as const }, render: renderText }

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export function registerTools(ctx: Context, client: N8nClient, config: Config): void {
  // T1 —— 列出工作流
  ctx.tools.register(
    defineTool({
      name: 'n8n_list_workflows',
      description:
        'List n8n workflows on the configured instance. Use this to discover workflow IDs/names before triggering.',
      parameters: {
        active: { type: 'boolean', description: 'Only return active (published) workflows.' },
        name: { type: 'string', description: 'Filter by workflow name (partial match).' },
        limit: { type: 'number', description: 'Max number of workflows to return.' },
        cursor: { type: 'string', description: 'Pagination cursor from a previous call.' }
      },
      output: textOutput,
      async execute(args) {
        const result = await client.listWorkflows({
          active: args.active,
          name: args.name,
          limit: args.limit,
          cursor: args.cursor
        })
        return pretty(result)
      }
    })
  )

  // T2 —— 触发工作流（走 Webhook）
  ctx.tools.register(
    defineTool({
      name: 'n8n_trigger_workflow',
      description:
        'Trigger an n8n workflow by POSTing to its Webhook URL. ' +
        'If the workflow Webhook node uses responseMode "lastNode"/"responseNode", the execution result is returned directly.',
      parameters: {
        webhookPath: {
          type: 'string',
          required: true,
          description: 'The webhook path configured on the workflow Webhook node (without the leading /webhook).'
        },
        payload: {
          type: 'string',
          description: 'Optional JSON string sent as the request body. Defaults to "{}".'
        },
        test: {
          type: 'boolean',
          description: 'Use the test webhook URL (/webhook-test/) instead of production.'
        }
      },
      output: textOutput,
      async execute(args) {
        if (!isWebhookPathAllowed(args.webhookPath, config.allowedWebhookPaths)) {
          throw new Error(`Webhook 路径不在白名单内：${args.webhookPath}`)
        }
        let payload: unknown = {}
        if (args.payload && args.payload.trim()) {
          try {
            payload = JSON.parse(args.payload)
          } catch {
            throw new Error('payload 不是合法 JSON 字符串')
          }
        }
        const result = await client.triggerWebhook(args.webhookPath, payload, {
          test: args.test ?? config.useTestWebhook
        })
        return pretty(result)
      }
    })
  )

  // T3 —— 查询执行状态
  ctx.tools.register(
    defineTool({
      name: 'n8n_get_execution_status',
      description: 'Get the status/details of a specific n8n execution by its ID.',
      parameters: {
        executionId: { type: 'string', required: true, description: 'The n8n execution ID.' },
        includeData: { type: 'boolean', description: 'Include detailed execution data in the response.' }
      },
      output: textOutput,
      async execute(args) {
        const result = await client.getExecution(args.executionId, args.includeData ?? false)
        return pretty(result)
      }
    })
  )
}
