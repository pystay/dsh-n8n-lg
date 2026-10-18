/**
 * 可视化搭建相关工具：增量加节点、打开浮窗编辑器、写前校验、快照、恢复。
 *
 * 这一组是「让用户看着 AI 一步步搭」的核心：每次写入都有快照可回滚，
 * 校验在写入前完成，结果会记进搭建会话的时间线。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { setHudFocus } from '../hud/routes.js'
import { validateWorkflow } from '../n8n/editor.js'
import { sessions } from '../n8n/session.js'
import { asJson, jsonOutput } from './common.js'
import type { ToolDeps } from './deps.js'

/** 把写入结果记进当前活跃的搭建会话（时间线数据来源）。 */
type StepResult = {
  added?: number
  skipped?: string[]
  nodeCount?: number
  verified?: boolean
  snapshotId?: string
  issues?: Array<{ level: string; message: string }>
  error?: string
}

function recordStep(workflowId: string, stepId: string | undefined, result: StepResult): void {
  if (!stepId) return
  const session = sessions.activeFor(workflowId)
  if (!session) return
  sessions.recordResult(session.id, stepId, result)
}

export function registerBuildTools({ ctx, manager, editor }: ToolDeps): void {
  // 增量加节点 —— 可视化搭建（幂等 + 校验 + 读回验证 + 自动快照）
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
        // 让时间线知道这一步开始了
        if (args.stepId) {
          const session = sessions.activeFor(args.workflowId)
          if (session) sessions.beginStep(session.id, args.stepId)
        }
        const result = await editor.addNodes({
          workflowId: args.workflowId,
          nodes: args.nodes,
          connections: args.connections,
          stepId: args.stepId,
          knownTypes
        })
        recordStep(args.workflowId, args.stepId, result)
        return asJson(result)
      }
    })
  )

  // 打开编辑器 —— 让玻璃浮窗自动打开内嵌 n8n 编辑器
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

  // 校验工作流 —— 写之前先体检
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

  // 记录快照 —— 回滚点
  ctx.tools.register(
    defineTool({
      name: 'n8n_snapshot_workflow',
      description:
        'Take a snapshot of a workflow (rollback point) before risky edits. ' +
        'Keeps the last 5 snapshots per workflow; they are persisted to disk, so they survive a restart.',
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

  // 恢复快照 —— 一步撤销
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
