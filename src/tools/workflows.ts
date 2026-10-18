/**
 * 工作流相关工具：列表 / 详情 / 触发 / 创建 / 更新 / 删除 / 启用 / 停用。
 *
 * 参数与响应体完全照搬 n8n 公开 API，不做改名或裁剪。
 * 写操作（更新）走 {@link ToolDeps.editor}；创建走本地校验后直接 POST（没有既有状态要保护）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { isWebhookPathAllowed } from '../n8n/guard.js'
import { validateWorkflow } from '../n8n/editor.js'
import { asJson, jsonOutput } from './common.js'
import type { ToolDeps } from './deps.js'

export function registerWorkflowTools({ ctx, manager, config, editor }: ToolDeps): void {
  // 列出工作流 —— 对应 GET /api/v1/workflows
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
        return asJson(
          await manager.client().listWorkflows({
            active: args.active,
            name: args.name,
            tags: args.tags,
            limit: args.limit,
            cursor: args.cursor,
            projectId: args.projectId,
            excludePinnedData: args.excludePinnedData
          })
        )
      }
    })
  )

  // 取工作流详情 —— 对应 GET /api/v1/workflows/{id}
  ctx.tools.register(
    defineTool({
      name: 'n8n_get_workflow',
      description: 'Get one n8n workflow by ID (GET /api/v1/workflows/{id}).',
      parameters: {
        workflowId: { type: 'string', required: true, description: 'The workflow ID.' }
      },
      output: jsonOutput,
      async execute(args) {
        return asJson(await manager.client().getWorkflow(args.workflowId))
      }
    })
  )

  // 触发工作流 —— 请求工作流 Webhook（n8n 公开 API 无触发端点）
  ctx.tools.register(
    defineTool({
      name: 'n8n_trigger_workflow',
      description:
        'Trigger an n8n workflow by calling its Webhook URL ({base}/webhook/{path}). ' +
        'Returns the workflow response as-is; with responseMode "lastNode"/"responseNode" this is the execution result. ' +
        'A 200 usually means "received", not "business completed".',
      parameters: {
        webhookPath: {
          type: 'string',
          required: true,
          description: 'Webhook path configured on the workflow Webhook node (without the leading /webhook).'
        },
        payload: {
          type: 'json',
          description: 'JSON body sent to the webhook (ignored for GET/HEAD). Defaults to {}.'
        },
        method: {
          type: 'string',
          description: 'HTTP method: POST (default), GET, PUT, PATCH, DELETE.'
        },
        query: {
          type: 'json',
          description: 'Optional query string parameters, e.g. {"name":"world"}.'
        },
        test: {
          type: 'boolean',
          description: 'Use the test webhook URL (/webhook-test/) instead of production.'
        }
      },
      output: jsonOutput,
      async execute(args) {
        if (!isWebhookPathAllowed(args.webhookPath, config.allowedWebhookPaths)) {
          throw new Error(`Webhook 路径不在白名单内或路径不安全：${args.webhookPath}`)
        }
        const query =
          args.query && typeof args.query === 'object'
            ? Object.fromEntries(
                Object.entries(args.query as Record<string, unknown>).map(([k, v]) => [k, String(v)])
              )
            : undefined
        return asJson(
          await manager.client().triggerWebhook(args.webhookPath, args.payload ?? {}, {
            test: args.test ?? config.useTestWebhook,
            method: args.method,
            query
          })
        )
      }
    })
  )

  // 创建工作流 —— POST /api/v1/workflows
  ctx.tools.register(
    defineTool({
      name: 'n8n_create_workflow',
      description:
        'Create an n8n workflow (POST /api/v1/workflows). Pass the full n8n workflow JSON (name, nodes, connections, settings). ' +
        'Creating an empty workflow (nodes: []) then adding nodes step by step is the recommended way to build.',
      parameters: {
        workflow: { type: 'json', required: true, description: 'Full workflow JSON object.' }
      },
      output: jsonOutput,
      async execute(args) {
        const wf = args.workflow as { name?: unknown; nodes?: unknown; connections?: unknown }
        if (!wf || typeof wf !== 'object' || typeof wf.name !== 'string') {
          throw new Error('workflow 必须是含 name 的 JSON 对象')
        }
        const nodes = Array.isArray(wf.nodes) ? wf.nodes : []
        const connections = wf.connections ?? {}
        const issues = validateWorkflow(nodes, connections)
        if (issues.some((i) => i.level === 'error')) {
          return asJson({ ok: false, issues, hint: '存在错误，未创建；请修正后重试' })
        }
        const body = { settings: {}, ...(wf as Record<string, unknown>) }
        if (body.settings === undefined || body.settings === null) body.settings = {}
        return asJson({ ok: true, workflow: await manager.client().createWorkflow(body as never), issues })
      }
    })
  )

  // 更新工作流 —— PUT /api/v1/workflows/{id}（自动补全必填字段）
  ctx.tools.register(
    defineTool({
      name: 'n8n_update_workflow',
      description:
        'Update an n8n workflow (PUT /api/v1/workflows/{id}). ' +
        'n8n requires name+nodes+connections+settings on every update, so missing fields are ' +
        'automatically filled from the current workflow. Saves as draft (publishIfActive=false).',
      parameters: {
        workflowId: { type: 'string', required: true, description: 'The workflow ID.' },
        workflow: {
          type: 'json',
          required: true,
          description: 'Fields to update (e.g. name/nodes/connections/settings).'
        }
      },
      output: jsonOutput,
      async execute(args) {
        const patch = (args.workflow ?? {}) as {
          name?: string
          nodes?: unknown
          connections?: unknown
          settings?: unknown
        }
        return asJson(
          await editor.updateWorkflow(args.workflowId, patch, { reason: 'update_workflow 前的自动快照' })
        )
      }
    })
  )

  // 删除工作流 —— DELETE /api/v1/workflows/{id}（需先停用）
  ctx.tools.register(
    defineTool({
      name: 'n8n_delete_workflow',
      description:
        'Delete an n8n workflow (DELETE /api/v1/workflows/{id}). An active workflow must be deactivated first. ' +
        'Deletion cannot be undone from here, so `confirm: true` is required. ' +
        'Snapshot it first with n8n_snapshot_workflow if you might need it back — ' +
        'n8n_restore_workflow can rebuild a deleted workflow from a snapshot (with a new id).',
      parameters: {
        workflowId: { type: 'string', required: true, description: 'The workflow ID.' },
        confirm: {
          type: 'boolean',
          required: true,
          description: 'Must be exactly true. A guard against deleting the wrong workflow by accident.'
        }
      },
      output: jsonOutput,
      async execute(args) {
        if (args.confirm !== true) {
          throw new Error(
            'n8n_delete_workflow 需要 confirm: true —— 删除不可撤销。' +
              '如果不确定，先用 n8n_snapshot_workflow 留一份快照。'
          )
        }
        await manager.client().deleteWorkflow(args.workflowId)
        return asJson({ deleted: true, workflowId: args.workflowId })
      }
    })
  )

  // 启用工作流 —— POST /api/v1/workflows/{id}/publish（回退 /activate）
  ctx.tools.register(
    defineTool({
      name: 'n8n_activate_workflow',
      description:
        'Activate (publish) an n8n workflow so its triggers/webhooks become live. ' +
        'NOTE: n8n registers webhooks asynchronously — wait a few seconds before triggering the production URL. ' +
        'Activation validates node config and credentials, so it can fail with 400 even when saving worked.',
      parameters: {
        workflowId: { type: 'string', required: true, description: 'The workflow ID.' }
      },
      output: jsonOutput,
      async execute(args) {
        return asJson(await manager.client().activateWorkflow(args.workflowId))
      }
    })
  )

  // 停用工作流 —— POST /api/v1/workflows/{id}/deactivate
  ctx.tools.register(
    defineTool({
      name: 'n8n_deactivate_workflow',
      description: 'Deactivate an n8n workflow.',
      parameters: {
        workflowId: { type: 'string', required: true, description: 'The workflow ID.' }
      },
      output: jsonOutput,
      async execute(args) {
        return asJson(await manager.client().deactivateWorkflow(args.workflowId))
      }
    })
  )
}
