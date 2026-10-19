/**
 * 「右键节点 → 提需求 → 交给 AI」这条链路。
 *
 * 重点不是 UI，而是三件事：
 *  1. 发给 Agent 的指令必须**约束边界**（只改这个节点、先读后改、改完校验），
 *     否则 Agent 很容易顺手把整个工作流重写；
 *  2. 会话要挑**能用**的（agentAvailable 为真），没有就明确报错而不是静默失败；
 *  3. 宿主没提供 sessionController 时要能降级报错，而不是抛异常。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildNodeEditPrompt, markAiBridge, promptAgent, sessionShape } from '../src/hud/bridge'

/** 造一个假的 sessionController。 */
function fakeController(items: Array<Record<string, unknown>>) {
  const sent: unknown[] = []
  return {
    sent,
    controller: {
      async list() {
        return { items }
      },
      async prompt(request: unknown) {
        sent.push(request)
        return { accepted: true }
      }
    }
  }
}

afterEach(() => {
  // 每个用例后清空模块级状态，避免互相污染
  markAiBridge(undefined)
})

describe('buildNodeEditPrompt', () => {
  it('带上工作流、节点名与用户原话', () => {
    const text = buildNodeEditPrompt({
      workflowId: 'wf-1',
      nodeName: 'HTTP Request',
      requirement: '把 URL 改成 https://api.example.com'
    })
    expect(text).toContain('wf-1')
    expect(text).toContain('HTTP Request')
    expect(text).toContain('把 URL 改成 https://api.example.com')
  })

  it('明确约束「只改这一个节点」，并给出先读后改的步骤', () => {
    const text = buildNodeEditPrompt({ workflowId: 'w', nodeName: 'n', requirement: 'r' })
    expect(text).toContain('不要改动其他节点')
    expect(text).toContain('n8n_get_workflow')
    expect(text).toContain('n8n_validate_workflow')
  })
})

describe('promptAgent', () => {
  it('宿主没有 sessionController 时返回可读错误，不抛异常', async () => {
    markAiBridge(undefined)
    const r = await promptAgent('改一下')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('不支持')
  })

  it('挑最近更新且 agentAvailable 的会话投递', async () => {
    const { controller, sent } = fakeController([
      { sessionId: 'old', updatedAt: '2026-01-01T00:00:00Z', agentAvailable: true },
      { sessionId: 'new', updatedAt: '2026-10-19T00:00:00Z', agentAvailable: true }
    ])
    markAiBridge(controller)

    const r = await promptAgent('把 URL 换掉')
    expect(r.ok).toBe(true)
    expect(r.sessionId).toBe('new')
    expect(sent).toHaveLength(1)
    const req = sent[0] as { sessionId: string; requestId: string; content: unknown[] }
    expect(req.sessionId).toBe('new')
    expect(req.requestId).toBeTruthy()
    expect(req.content).toEqual([{ type: 'text', text: '把 URL 换掉' }])
  })

  it('跳过 agentAvailable 为 false 的会话', async () => {
    const { controller, sent } = fakeController([
      { sessionId: 'busy', updatedAt: '2026-10-19T00:00:00Z', agentAvailable: false },
      { sessionId: 'idle', updatedAt: '2026-01-01T00:00:00Z', agentAvailable: true }
    ])
    markAiBridge(controller)

    const r = await promptAgent('x')
    expect(r.sessionId).toBe('idle')
    expect(sent).toHaveLength(1)
  })

  it('同时间优先非空会话（能接上原有上下文）', async () => {
    const { controller } = fakeController([
      { sessionId: 'blank', updatedAt: '2026-10-19T00:00:00Z', agentAvailable: true, blank: true },
      { sessionId: 'used', updatedAt: '2026-10-18T00:00:00Z', agentAvailable: true, blank: false }
    ])
    markAiBridge(controller)
    expect((await promptAgent('x')).sessionId).toBe('used')
  })

  it('没有可用会话时明确报错', async () => {
    const { controller } = fakeController([{ sessionId: 'a', agentAvailable: false }])
    markAiBridge(controller)
    const r = await promptAgent('x')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('没有可用的会话')
  })

  it('prompt 抛错时把原因带出来', async () => {
    markAiBridge({
      async list() {
        return { items: [{ sessionId: 's', agentAvailable: true }] }
      },
      async prompt() {
        throw new Error('agent disposed')
      }
    })
    const r = await promptAgent('x')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('agent disposed')
  })

  it('list() 返回非预期结构时按「没有可用会话」处理', async () => {
    markAiBridge({
      async list() {
        return { items: 'nope' }
      },
      async prompt() {
        return {}
      }
    })
    const r = await promptAgent('x')
    expect(r.ok).toBe(false)
  })
})

describe('sessionShape（排障用，不含内容）', () => {
  it('只记录键名与数量', async () => {
    markAiBridge({
      async list() {
        return {
          items: [{ sessionId: 'a', updatedAt: 't', agentAvailable: true, projections: {} }]
        }
      }
    })
    const { probeSessionShape } = await import('../src/hud/bridge')
    await probeSessionShape()
    const shape = sessionShape()
    expect(shape?.kind).toBe('object')
    expect(shape?.count).toBe(1)
    expect(shape?.itemKeys).toContain('sessionId')
    // 结构里只有形状字段 —— 没有任何会话内容（标题、消息、projections 的值）
    expect(Object.keys(shape!).sort()).toEqual(['count', 'itemKeys', 'keys', 'kind'])
  })
})
