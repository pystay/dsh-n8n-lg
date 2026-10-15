/**
 * 工具注册层：把 n8n 公开 API 能力以「完全照搬 n8n」的方式暴露给 Agent。
 *
 * 参数名、取值语义、响应体均与 n8n 公开 API 保持一致，不做改名或裁剪。
 *
 * 写操作一律经过 {@link WorkflowEditor}：串行、幂等、校验、读回验证、自动快照。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from '../config.js'
import type { ConnectionManager } from '../connection.js'
import { setHudFocus } from '../hud/routes.js'
import { WorkflowEditor, validateWorkflow } from '../n8n/editor.js'
import { isWebhookPathAllowed } from '../n8n/guard.js'
import { asJson, jsonOutput } from './common.js'

export function registerTools(ctx: Context, manager: ConnectionManager, config: Config): void {
  const editor = new WorkflowEditor(manager)

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
        return asJson(await manager.client().getWorkflow(args.workflowId))
      }
    })
  )

  // 3) 触发工作流 —— 请求工作流 Webhook（n8n 公开 API 无触发端点）
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

  // 6) 创建工作流 —— POST /api/v1/workflows
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

  // 7) 更新工作流 —— PUT /api/v1/workflows/{id}（自动补全必填字段）
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

  // 8) 删除工作流 —— DELETE /api/v1/workflows/{id}（需先停用）
  ctx.tools.register(
    defineTool({
      name: 'n8n_delete_workflow',
      description:
        'Delete an n8n workflow (DELETE /api/v1/workflows/{id}). An active workflow must be deactivated first. ' +
        'Consider n8n_snapshot_workflow first — deletion cannot be undone from here.',
      parameters: {
        workflowId: { type: 'string', required: true, description: 'The workflow ID.' }
      },
      output: jsonOutput,
      async execute(args) {
        await manager.client().deleteWorkflow(args.workflowId)
        return asJson({ deleted: true, workflowId: args.workflowId })
      }
    })
  )

  // 9) 启用工作流 —— POST /api/v1/workflows/{id}/publish（回退 /activate）
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
        return asJson(await manager.client().deactivateWorkflow(args.workflowId))
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
        return asJson(await manager.client().retryExecution(args.executionId, args.loadWorkflow ?? false))
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
        return asJson(await manager.client().stopExecution(args.executionId))
      }
    })
  )

  // 13) 增量加节点 —— 可视化搭建（幂等 + 校验 + 读回验证 + 自动快照）
  ctx.tools.register(
    defineTool({
      name: 'n8n_add_nodes',
      description:
        'Append nodes (and optionally connections) to an existing n8n workflow and save it. ' +
        'This is the core of step-by-step building so the user can watch it grow in the editor. ' +
        'Safe by design: duplicate nodes are skipped, connections are merged across ALL channels ' +
        '(main / ai_languageModel / ...), the result is validated before writing, read back after writing, ' +
        'and a snapshot is taken first so the change can be undone. ' +
        'Pass a stable `stepId` per logical step so retries are idempotent.',
      parameters: {
        workflowId: { type: 'string', required: true, description: 'Target workflow ID.' },
        nodes: { type: 'json', required: true, description: 'Array of n8n node objects to append.' },
        connections: {
          type: 'json',
          description: 'Optional n8n connections object; merged into the existing ones (all channels).'
        },
        stepId: {
          type: 'string',
          description: 'Idempotency key for this step, e.g. "add-webhook". Reusing it will not write twice.'
        },
        knownTypes: {
          type: 'json',
          description: 'Optional list of node types the target n8n supports; used to reject invented types.'
        }
      },
      output: jsonOutput,
      async execute(args) {
        const knownTypes = Array.isArray(args.knownTypes)
          ? (args.knownTypes as unknown[]).filter((t): t is string => typeof t === 'string')
          : undefined
        return asJson(
          await editor.addNodes({
            workflowId: args.workflowId,
            nodes: args.nodes,
            connections: args.connections,
            stepId: args.stepId,
            knownTypes
          })
        )
      }
    })
  )

  // 14) 打开编辑器 —— 让玻璃浮窗自动打开内嵌 n8n 编辑器
  ctx.tools.register(
    defineTool({
      name: 'n8n_open_editor',
      description:
        'Open a workflow in the DSH glass HUD embedded n8n editor so the user can watch (and edit) live. ' +
        'Returns the editor URL too. Call it right after creating a workflow and after each build step.',
      parameters: {
        workflowId: { type: 'string', description: 'Workflow ID; omit to open the workflow list.' },
        note: {
          type: 'string',
          description: 'Short status shown in the HUD, e.g. "正在搭建：Webhook → 过滤 → 回复".'
        }
      },
      output: jsonOutput,
      async execute(args) {
        const focus = setHudFocus(args.workflowId ?? null, args.note)
        const base = manager.resolve()?.baseUrl.replace(/\/+$/, '')
        const editorUrl = !base
          ? null
          : args.workflowId
            ? `${base}/workflow/${encodeURIComponent(args.workflowId)}`
            : `${base}/home/workflows`
        return asJson({
          ok: true,
          rev: focus.rev,
          editorUrl,
          hint: editorUrl
            ? '已在 DSH 玻璃浮窗中打开内嵌编辑器（浮窗会随每次保存自动刷新）'
            : '尚未配置 n8n 连接，无法生成编辑器链接；请在玻璃浮窗里填写地址与 API Key'
        })
      }
    })
  )

  // 15) 校验工作流 —— 写之前先体检
  ctx.tools.register(
    defineTool({
      name: 'n8n_validate_workflow',
      description:
        'Validate workflow nodes/connections BEFORE saving: missing id/name/type, duplicate ids or names, ' +
        'duplicate webhook paths (409 on activate), dangling connections, unknown node types. ' +
        'Pass workflowId to check a saved workflow, or nodes+connections to check a draft.',
      parameters: {
        workflowId: { type: 'string', description: 'Validate this saved workflow.' },
        nodes: { type: 'json', description: 'Nodes of a draft workflow.' },
        connections: { type: 'json', description: 'Connections of a draft workflow.' },
        knownTypes: { type: 'json', description: 'Optional list of node types the target n8n supports.' }
      },
      output: jsonOutput,
      async execute(args) {
        let nodes: unknown = args.nodes
        let connections: unknown = args.connections
        if (args.workflowId && nodes === undefined) {
          const wf = (await manager.client().getWorkflow(args.workflowId)) as unknown as {
            nodes?: unknown
            connections?: unknown
          }
          nodes = wf.nodes
          connections = wf.connections
        }
        if (nodes === undefined) throw new Error('请提供 workflowId，或同时提供 nodes')
        const knownTypes = Array.isArray(args.knownTypes)
          ? (args.knownTypes as unknown[]).filter((t): t is string => typeof t === 'string')
          : undefined
        const issues = validateWorkflow(nodes, connections, { knownTypes })
        return asJson({
          ok: issues.every((i) => i.level !== 'error'),
          errors: issues.filter((i) => i.level === 'error').length,
          warnings: issues.filter((i) => i.level === 'warning').length,
          issues
        })
      }
    })
  )

  // 16) 记录快照 —— 回滚点
  ctx.tools.register(
    defineTool({
      name: 'n8n_snapshot_workflow',
      description:
        'Take an in-memory snapshot of a workflow (rollback point) before risky edits. ' +
        'Keeps the last 5 snapshots per workflow. Snapshots live in memory only and are cleared on restart.',
      parameters: {
        workflowId: { type: 'string', required: true, description: 'The workflow ID.' },
        reason: { type: 'string', description: 'Why this snapshot is taken, e.g. "before adding nodes".' }
      },
      output: jsonOutput,
      async execute(args) {
        const snap = await editor.capture(args.workflowId, args.reason ?? 'manual snapshot')
        return asJson({
          ok: true,
          snapshotId: snap.id,
          workflowId: snap.workflowId,
          createdAt: snap.createdAt,
          nodeCount: Array.isArray(snap.nodes) ? snap.nodes.length : 0,
          snapshots: editor
            .listSnapshots(args.workflowId)
            .map((s) => ({ id: s.id, reason: s.reason, createdAt: s.createdAt }))
        })
      }
    })
  )

  // 17) 恢复快照 —— 一步撤销
  ctx.tools.register(
    defineTool({
      name: 'n8n_restore_workflow',
      description:
        'Restore a workflow to a previous snapshot (undo). Omit snapshotId to restore the most recent one. ' +
        'A snapshot of the current state is taken first, so the restore itself can be undone.',
      parameters: {
        workflowId: { type: 'string', required: true, description: 'The workflow ID.' },
        snapshotId: { type: 'string', description: 'Snapshot id from n8n_snapshot_workflow.' }
      },
      output: jsonOutput,
      async execute(args) {
        return asJson(await editor.restore(args.workflowId, args.snapshotId))
      }
    })
  )
}
