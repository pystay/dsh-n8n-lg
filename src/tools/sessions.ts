/**
 * 搭建会话相关工具：开始 / 查看 / 暂停-恢复-结束。
 *
 * 会话把「AI 一步步搭工作流」变成可观察、可控制的过程：
 * 先声明计划 → 用户在浮窗时间线看到进度 → 可随时暂停（暂停期间写入真的会被拦下）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { sessions, summarizeSession } from '../n8n/session.js'
import { asJson, jsonOutput } from './common.js'
import type { ToolDeps } from './deps.js'

export function registerSessionTools({ ctx }: ToolDeps): void {
  // 开始搭建会话 —— 先声明计划，用户在浮窗时间线上看到全过程
  ctx.tools.register(
    defineTool({
      name: 'n8n_begin_build_session',
      description:
        'Start a build session: declare the plan (goal + ordered steps) BEFORE building. ' +
        'The user then watches a progress timeline in the glass panel, and can pause/resume/cancel it. ' +
        'While a session is paused, every write is refused — so pausing really stops the build. ' +
        'Use the same step ids here and as the `stepId` of n8n_add_nodes so results attach to the timeline.',
      parameters: {
        workflowId: { type: 'string', required: true, description: 'The workflow being built.' },
        goal: {
          type: 'string',
          required: true,
          description: 'What the user asked for, in one sentence (shown on the timeline).'
        },
        steps: {
          type: 'json',
          required: true,
          description: 'Ordered steps: [{"id":"add-webhook","title":"加 Webhook 触发器","detail":"可选说明"}].'
        }
      },
      output: jsonOutput,
      async execute(args) {
        const raw = Array.isArray(args.steps) ? (args.steps as unknown[]) : []
        const steps: Array<{ id: string; title: string; detail?: string }> = []
        for (const s of raw) {
          if (!s || typeof s !== 'object') continue
          const item = s as { id?: unknown; title?: unknown; detail?: unknown }
          if (typeof item.id !== 'string' || !item.id) continue
          steps.push({
            id: item.id,
            title: typeof item.title === 'string' && item.title ? item.title : item.id,
            ...(typeof item.detail === 'string' ? { detail: item.detail } : {})
          })
        }
        if (steps.length === 0) throw new Error('steps 必须是非空数组，且每项含 id')

        const session = sessions.start({ workflowId: args.workflowId, goal: args.goal, steps })
        return asJson({
          ok: true,
          sessionId: session.id,
          workflowId: session.workflowId,
          status: session.status,
          progress: summarizeSession(session),
          hint: '计划已开始。请在浮窗里打开该工作流（n8n_open_editor），逐步执行并在每步带上相同的 stepId。'
        })
      }
    })
  )

  // 查看搭建会话 —— 进度与每一步的结果
  ctx.tools.register(
    defineTool({
      name: 'n8n_get_build_session',
      description:
        'Read the build session for a workflow (or a specific sessionId): status, per-step results ' +
        '(added / verified / snapshotId / error) and overall progress.',
      parameters: {
        workflowId: { type: 'string', description: 'Read the latest/active session of this workflow.' },
        sessionId: { type: 'string', description: 'Read this session by id.' }
      },
      output: jsonOutput,
      async execute(args) {
        const session = args.sessionId
          ? sessions.get(args.sessionId)
          : args.workflowId
            ? (sessions.activeFor(args.workflowId) ?? sessions.latest(args.workflowId))
            : undefined
        if (!session) {
          return asJson({ ok: false, error: '没有找到搭建会话（可能尚未开始）' })
        }
        return asJson({ ok: true, session, progress: summarizeSession(session) })
      }
    })
  )

  // 暂停 / 恢复 / 结束会话 —— 用户对搭建过程的控制权
  ctx.tools.register(
    defineTool({
      name: 'n8n_set_build_session_state',
      description:
        'Control a build session: running (resume), paused (BLOCKS all writes until resumed), ' +
        'completed, cancelled or failed. Use this to honour a user asking to pause or stop the build.',
      parameters: {
        sessionId: { type: 'string', required: true, description: 'The session id.' },
        state: {
          type: 'string',
          required: true,
          description: 'running | paused | completed | cancelled | failed'
        },
        note: { type: 'string', description: 'Optional note shown on the timeline.' }
      },
      output: jsonOutput,
      async execute(args) {
        const allowed = ['running', 'paused', 'completed', 'cancelled', 'failed'] as const
        const state = args.state as (typeof allowed)[number]
        if (!allowed.includes(state)) {
          throw new Error(`state 必须是 ${allowed.join(' / ')} 之一`)
        }
        const session = sessions.setStatus(args.sessionId, state, args.note)
        if (state === 'cancelled' || state === 'failed') sessions.skipPending(args.sessionId, args.note)
        return asJson({ ok: true, session, progress: summarizeSession(session) })
      }
    })
  )
}
