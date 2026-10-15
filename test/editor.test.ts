/**
 * WorkflowEditor 单测：验证「安全、可验证、可回滚」的四条承诺。
 *  - 幂等：同一步骤重试不会重复写入
 *  - 串行：并发调用不会互相覆盖（丢更新）
 *  - 全通道合并：ai_languageModel 等非 main 连线不被浅覆盖
 *  - 可回滚：快照能恢复
 */
import { describe, expect, it, vi } from 'vitest'
import type { ClientProvider } from '../src/connection'
import type { N8nClient } from '../src/n8n/client'
import { WorkflowEditor, mergeConnections, validateWorkflow } from '../src/n8n/editor'

interface StoredWorkflow {
  id: string
  name: string
  nodes: Array<Record<string, unknown>>
  connections: Record<string, unknown>
  settings: Record<string, unknown>
}

/** 内存版假客户端：记录写入并按串行顺序返回最新状态。 */
function makeProvider(initial: StoredWorkflow, opts: { delayMs?: number } = {}) {
  const state: StoredWorkflow = JSON.parse(JSON.stringify(initial))
  const writes: Array<Record<string, unknown>> = []
  let inFlight = 0
  let maxInFlight = 0

  const client = {
    async getWorkflow() {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
      const copy = JSON.parse(JSON.stringify(state)) as StoredWorkflow
      inFlight -= 1
      return copy
    },
    async updateWorkflow(_id: string, body: Record<string, unknown>) {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
      writes.push(JSON.parse(JSON.stringify(body)))
      state.name = body.name as string
      state.nodes = body.nodes as Array<Record<string, unknown>>
      state.connections = body.connections as Record<string, unknown>
      state.settings = (body.settings ?? {}) as Record<string, unknown>
      inFlight -= 1
      return { ...state }
    }
  } as unknown as N8nClient

  const provider: ClientProvider = { client: () => client }
  return { provider, writes, state, stats: () => ({ maxInFlight }) }
}

function node(id: string, name: string, extra: Record<string, unknown> = {}) {
  return { id, name, type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0], parameters: {}, ...extra }
}

describe('validateWorkflow', () => {
  it('干净的工作流没有 error', () => {
    const issues = validateWorkflow([node('n1', 'A')], {})
    expect(issues.filter((i) => i.level === 'error')).toEqual([])
  })

  it('捕获缺失字段、重复 id/name 与重复 webhook 路径', () => {
    const issues = validateWorkflow(
      [
        { id: 'n1', name: 'A' },
        { id: 'n1', name: 'A', type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0] },
        {
          id: 'w1',
          name: 'Hook1',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          position: [0, 0],
          parameters: { path: 'same' }
        },
        {
          id: 'w2',
          name: 'Hook2',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          position: [0, 0],
          parameters: { path: 'same' }
        }
      ],
      {}
    )
    const messages = issues.map((i) => i.message).join(' | ')
    expect(messages).toContain('缺少 type')
    expect(messages).toContain('节点 id 重复')
    expect(messages).toContain('节点 name 重复')
    expect(messages).toContain('Webhook 路径重复')
  })

  it('knownTypes 能拦下不存在的节点类型（AI 编造类型）', () => {
    const issues = validateWorkflow([node('n1', 'A', { type: 'n8n-nodes-base.notReal' })], {}, {
      knownTypes: ['n8n-nodes-base.code']
    })
    expect(issues.some((i) => i.level === 'error' && i.message.includes('不支持该节点类型'))).toBe(true)
  })

  it('连线指向不存在的节点会给出 warning', () => {
    const issues = validateWorkflow([node('n1', 'A')], {
      A: { main: [[{ node: 'Ghost', type: 'main', index: 0 }]] }
    })
    expect(issues.some((i) => i.message.includes('指向不存在的节点'))).toBe(true)
  })
})

describe('mergeConnections', () => {
  it('保留非 main 通道的已有连线（回归：此前会被浅覆盖）', () => {
    const merged = mergeConnections(
      { Model: { ai_languageModel: [[{ node: 'OldAgent', type: 'ai_languageModel', index: 0 }]] } },
      { Model: { ai_languageModel: [[{ node: 'NewAgent', type: 'ai_languageModel', index: 0 }]] } }
    )
    const links = (merged.Model as Record<string, Array<Array<{ node: string }>>>).ai_languageModel![0]!
    expect(links.map((l) => l.node)).toEqual(['OldAgent', 'NewAgent'])
  })

  it('按 (node,type,index) 去重', () => {
    const merged = mergeConnections(
      { A: { main: [[{ node: 'B', type: 'main', index: 0 }]] } },
      { A: { main: [[{ node: 'B', type: 'main', index: 0 }]] } }
    )
    expect((merged.A as Record<string, unknown[][]>).main![0]).toHaveLength(1)
  })

  it('不同通道互不干扰', () => {
    const merged = mergeConnections(
      { A: { main: [[{ node: 'B', type: 'main', index: 0 }]] } },
      { A: { ai_tool: [[{ node: 'T', type: 'ai_tool', index: 0 }]] } }
    )
    expect(Object.keys(merged.A as Record<string, unknown>).sort()).toEqual(['ai_tool', 'main'])
  })
})

describe('WorkflowEditor.addNodes', () => {
  it('跳过已存在的节点（按 id / name 去重）', async () => {
    const { provider, writes } = makeProvider({
      id: 'wf',
      name: 'wf',
      nodes: [node('n1', 'A')],
      connections: {},
      settings: {}
    })
    const editor = new WorkflowEditor(provider)
    const result = await editor.addNodes({ workflowId: 'wf', nodes: [node('n1', 'A')] })
    expect(result.added).toBe(0)
    expect(result.skipped).toEqual(['A'])
    expect(writes).toHaveLength(0)
  })

  it('同一步骤重复调用是幂等的（stepId）', async () => {
    const { provider, writes } = makeProvider({
      id: 'wf',
      name: 'wf',
      nodes: [],
      connections: {},
      settings: {}
    })
    const editor = new WorkflowEditor(provider)
    const first = await editor.addNodes({ workflowId: 'wf', nodes: [node('n1', 'A')], stepId: 'step-1' })
    const second = await editor.addNodes({ workflowId: 'wf', nodes: [node('n1', 'A')], stepId: 'step-1' })
    expect(first.added).toBe(1)
    expect(second.added).toBe(0)
    expect(writes).toHaveLength(1)
  })

  it('并发写入串行化，不丢更新（回归：此前后写覆盖先写）', async () => {
    const { provider, writes, state, stats } = makeProvider(
      { id: 'wf', name: 'wf', nodes: [], connections: {}, settings: {} },
      { delayMs: 5 }
    )
    const editor = new WorkflowEditor(provider)
    await Promise.all([
      editor.addNodes({ workflowId: 'wf', nodes: [node('a', 'A')] }),
      editor.addNodes({ workflowId: 'wf', nodes: [node('b', 'B')] })
    ])
    expect(writes).toHaveLength(2)
    expect(state.nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
    expect(stats().maxInFlight).toBe(1)
  })

  it('校验失败时不写入，并把问题返回给调用方', async () => {
    const { provider, writes } = makeProvider({
      id: 'wf',
      name: 'wf',
      nodes: [node('n1', 'A')],
      connections: {},
      settings: {}
    })
    const editor = new WorkflowEditor(provider)
    const result = await editor.addNodes({ workflowId: 'wf', nodes: [node('n1', 'Dup')] })
    // n1 已存在 → 被跳过；这里再构造一个真正的错误：未知类型
    const bad = await editor.addNodes({
      workflowId: 'wf',
      nodes: [node('n2', 'B', { type: 'n8n-nodes-base.nope' })],
      knownTypes: ['n8n-nodes-base.code']
    })
    expect(result.added).toBe(0)
    expect(bad.ok).toBe(false)
    expect(bad.verified).toBe(false)
    expect(writes).toHaveLength(0)
  })

  it('写入后读回验证，并留下可回滚的快照 id', async () => {
    const { provider } = makeProvider({
      id: 'wf-verify',
      name: 'wf',
      nodes: [],
      connections: {},
      settings: {}
    })
    const editor = new WorkflowEditor(provider)
    const result = await editor.addNodes({ workflowId: 'wf-verify', nodes: [node('n1', 'A')] })
    expect(result.ok).toBe(true)
    expect(result.verified).toBe(true)
    expect(result.nodeCount).toBe(1)
    expect(result.snapshotId).toBeTruthy()
    expect(editor.listSnapshots('wf-verify').length).toBeGreaterThan(0)
  })
})

describe('WorkflowEditor.restore（一步撤销）', () => {
  it('恢复快照会写回旧节点集合', async () => {
    const { provider, state } = makeProvider({
      id: 'wf-restore',
      name: 'wf',
      nodes: [node('n1', 'A')],
      connections: {},
      settings: {}
    })
    const editor = new WorkflowEditor(provider)
    await editor.addNodes({ workflowId: 'wf-restore', nodes: [node('n2', 'B')] })
    expect(state.nodes).toHaveLength(2)

    const restored = await editor.restore('wf-restore')
    expect(restored.ok).toBe(true)
    expect(state.nodes.map((n) => n.id)).toEqual(['n1'])
  })

  it('没有快照时给出可读错误', async () => {
    const { provider } = makeProvider({ id: 'wf-none', name: 'wf', nodes: [], connections: {}, settings: {} })
    const editor = new WorkflowEditor(provider)
    await expect(editor.restore('wf-none')).rejects.toThrow(/找不到可恢复的快照/)
  })
})

describe('WorkflowEditor.updateWorkflow', () => {
  it('补全 n8n 要求的必填字段（name/nodes/connections/settings）', async () => {
    const { provider, writes } = makeProvider({
      id: 'wf-upd',
      name: 'orig',
      nodes: [node('n1', 'A')],
      connections: { A: { main: [] } },
      settings: { executionOrder: 'v1' }
    })
    const editor = new WorkflowEditor(provider)
    await editor.updateWorkflow('wf-upd', { name: 'renamed' })
    expect(Object.keys(writes[0] ?? {}).sort()).toEqual(['connections', 'name', 'nodes', 'settings'])
    expect(writes[0]?.name).toBe('renamed')
    expect(writes[0]?.nodes).toHaveLength(1)
  })

  it('默认以草稿方式保存（不自动重新发布）', async () => {
    const update = vi.fn(async () => ({}))
    const provider: ClientProvider = {
      client: () =>
        ({
          getWorkflow: async () => ({ name: 'x', nodes: [], connections: {}, settings: {} }),
          updateWorkflow: update
        }) as unknown as N8nClient
    }
    const editor = new WorkflowEditor(provider)
    await editor.updateWorkflow('wf-draft', { name: 'y' })
    expect(update).toHaveBeenCalledWith('wf-draft', expect.anything(), { publishIfActive: false })
  })
})
