/**
 * 搭建会话单测：验证「计划可声明、进度可观察、暂停真生效」。
 */
import { describe, expect, it } from 'vitest'
import type { ClientProvider } from '../src/connection'
import type { N8nClient } from '../src/n8n/client'
import { WorkflowEditor } from '../src/n8n/editor'
import { SessionStore, summarizeSession } from '../src/n8n/session'

function makeStore() {
  return new SessionStore(3)
}

const PLAN = [
  { id: 'add-webhook', title: '加 Webhook 触发器' },
  { id: 'add-code', title: '加 Code 节点' },
  { id: 'wire', title: '连线' }
]

describe('SessionStore', () => {
  it('start 会创建计划并标记为 running', () => {
    const store = makeStore()
    const s = store.start({ workflowId: 'w1', goal: '做个问候工作流', steps: PLAN })
    expect(s.status).toBe('running')
    expect(s.steps.map((x) => x.status)).toEqual(['pending', 'pending', 'pending'])
    expect(store.activeFor('w1')?.id).toBe(s.id)
  })

  it('步骤开始与结果会被记录，并推导 done / failed', () => {
    const store = makeStore()
    const s = store.start({ workflowId: 'w1', goal: 'g', steps: PLAN })

    store.beginStep(s.id, 'add-webhook')
    expect(s.steps[0]?.status).toBe('running')
    expect(s.steps[0]?.startedAt).toBeTruthy()

    store.recordResult(s.id, 'add-webhook', {
      added: 1,
      skipped: [],
      nodeCount: 1,
      verified: true,
      snapshotId: 'snap1'
    })
    expect(s.steps[0]).toMatchObject({ status: 'done', added: 1, verified: true, snapshotId: 'snap1' })

    store.recordResult(s.id, 'add-code', { error: 'n8n 拒绝了这次写入：400', verified: false })
    expect(s.steps[1]?.status).toBe('failed')
    expect(s.steps[1]?.error).toContain('400')
  })

  it('校验问题会被摘要进步骤（最多 5 条）', () => {
    const store = makeStore()
    const s = store.start({ workflowId: 'w1', goal: 'g', steps: PLAN })
    store.recordResult(s.id, 'wire', {
      verified: false,
      issues: Array.from({ length: 8 }, (_, i) => ({ level: 'error', message: `问题 ${i}` }))
    })
    expect(s.steps[2]?.issues).toHaveLength(5)
    expect(s.steps[2]?.status).toBe('failed')
  })

  it('暂停时给出拦下写入的理由；恢复后不再拦', () => {
    const store = makeStore()
    const s = store.start({ workflowId: 'w1', goal: 'g', steps: PLAN })
    expect(store.pausedReason('w1')).toBeUndefined()

    store.setStatus(s.id, 'paused')
    const reason = store.pausedReason('w1')
    expect(reason).toContain('暂停')
    expect(reason).toContain(s.id)

    store.setStatus(s.id, 'running')
    expect(store.pausedReason('w1')).toBeUndefined()
  })

  it('结束会话后不再是活跃会话，也不再拦写入', () => {
    const store = makeStore()
    const s = store.start({ workflowId: 'w1', goal: 'g', steps: PLAN })
    store.setStatus(s.id, 'paused')
    store.setStatus(s.id, 'completed')
    expect(store.activeFor('w1')).toBeUndefined()
    expect(store.pausedReason('w1')).toBeUndefined()
    expect(store.latest('w1')?.id).toBe(s.id)
    expect(s.finishedAt).toBeTruthy()
  })

  it('取消/失败会把未完成的步骤标为 skipped', () => {
    const store = makeStore()
    const s = store.start({ workflowId: 'w1', goal: 'g', steps: PLAN })
    store.recordResult(s.id, 'add-webhook', { added: 1, verified: true })
    store.setStatus(s.id, 'cancelled')
    store.skipPending(s.id, '用户终止')
    expect(s.steps[0]?.status).toBe('done')
    expect(s.steps[1]?.status).toBe('skipped')
    expect(s.steps[1]?.error).toBe('用户终止')
  })

  it('新会话会取代同一工作流的旧活跃会话', () => {
    const store = makeStore()
    const first = store.start({ workflowId: 'w1', goal: '第一次', steps: PLAN })
    const second = store.start({ workflowId: 'w1', goal: '第二次', steps: PLAN })
    expect(first.status).toBe('cancelled')
    expect(store.activeFor('w1')?.id).toBe(second.id)
  })

  it('每个工作流只保留最近 N 条会话', () => {
    const store = new SessionStore(2)
    const a = store.start({ workflowId: 'w1', goal: 'a', steps: PLAN })
    const b = store.start({ workflowId: 'w1', goal: 'b', steps: PLAN })
    const c = store.start({ workflowId: 'w1', goal: 'c', steps: PLAN })
    const ids = store.list('w1').map((s) => s.id)
    expect(ids).not.toContain(a.id)
    expect(ids).toEqual([b.id, c.id])
  })

  it('setStatus 对未知会话报错', () => {
    expect(() => makeStore().setStatus('nope', 'running')).toThrow(/找不到搭建会话/)
  })

  it('summarizeSession 统计 done/failed/skipped 与百分比', () => {
    const store = makeStore()
    const s = store.start({ workflowId: 'w1', goal: 'g', steps: PLAN })
    store.recordResult(s.id, 'add-webhook', { added: 1, verified: true })
    store.recordResult(s.id, 'add-code', { error: 'x' })
    const p = summarizeSession(s)
    expect(p).toMatchObject({ total: 3, done: 1, failed: 1, skipped: 0 })
    expect(p.percent).toBe(67)
  })

  it('空计划的进度是 0%', () => {
    expect(summarizeSession({ steps: [] } as never).percent).toBe(0)
  })
})

describe('WorkflowEditor 与搭建会话联动', () => {
  function provider() {
    const state = { name: 'wf', nodes: [] as unknown[], connections: {}, settings: {} }
    const client = {
      getWorkflow: async () => JSON.parse(JSON.stringify(state)),
      updateWorkflow: async (_id: string, body: Record<string, unknown>) => {
        state.nodes = body.nodes as unknown[]
        return body
      }
    } as unknown as N8nClient
    return { provider: { client: () => client } as ClientProvider, state }
  }

  it('会话暂停时写入被拦下，且不产生任何写入', async () => {
    const store = makeStore()
    const { provider: p, state } = provider()
    const editor = new WorkflowEditor(p, { blockReason: (id) => store.pausedReason(id) })

    const session = store.start({ workflowId: 'wf', goal: 'g', steps: PLAN })
    store.setStatus(session.id, 'paused')

    const result = await editor.addNodes({
      workflowId: 'wf',
      nodes: [{ id: 'n1', name: 'A', type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0] }]
    })
    expect(result.ok).toBe(false)
    expect(result.blocked).toBe(true)
    expect(result.error).toContain('暂停')
    expect(state.nodes).toHaveLength(0)
  })

  it('恢复后写入正常进行', async () => {
    const store = makeStore()
    const { provider: p, state } = provider()
    const editor = new WorkflowEditor(p, { blockReason: (id) => store.pausedReason(id) })
    const session = store.start({ workflowId: 'wf', goal: 'g', steps: PLAN })
    store.setStatus(session.id, 'paused')
    store.setStatus(session.id, 'running')

    const result = await editor.addNodes({
      workflowId: 'wf',
      nodes: [{ id: 'n1', name: 'A', type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0] }]
    })
    expect(result.ok).toBe(true)
    expect(state.nodes).toHaveLength(1)
  })
})
