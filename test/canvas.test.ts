import { describe, expect, it } from 'vitest'
import { buildCanvas, shortType } from '../src/n8n/canvas'

function wf(nodes: unknown[], connections: unknown = {}) {
  return { name: 'wf', nodes, connections }
}

describe('shortType', () => {
  it('去掉包前缀，只留末段', () => {
    expect(shortType('n8n-nodes-base.httpRequest')).toBe('httpRequest')
    expect(shortType('@n8n/n8n-nodes-langchain.agent')).toBe('agent')
  })
  it('没有点号时原样返回', () => {
    expect(shortType('webhook')).toBe('webhook')
  })
})

describe('buildCanvas', () => {
  it('提取节点名、短类型、坐标与禁用状态', () => {
    const g = buildCanvas(
      wf([
        { id: 'n1', name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0] },
        { id: 'n2', name: 'Off', type: 'n8n-nodes-base.noOp', position: [300, 120], disabled: true }
      ])
    )
    expect(g.nodes).toHaveLength(2)
    expect(g.nodes[0]).toEqual({
      id: 'n1',
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      kind: 'webhook',
      x: 0,
      y: 0,
      disabled: false
    })
    expect(g.nodes[1]?.disabled).toBe(true)
    expect(g.nodes[1]?.x).toBe(300)
  })

  it('兼容 {0:x,1:y} 形态的 position', () => {
    const g = buildCanvas(wf([{ name: 'A', type: 't', position: { 0: 12, 1: 34 } }]))
    expect([g.nodes[0]?.x, g.nodes[0]?.y]).toEqual([12, 34])
  })

  it('position 缺失或非法时回落到 0,0（不产生 NaN）', () => {
    const g = buildCanvas(
      wf([
        { name: 'A', type: 't' },
        { name: 'B', type: 't', position: ['x', null] }
      ])
    )
    for (const n of g.nodes) {
      expect(Number.isFinite(n.x)).toBe(true)
      expect(Number.isFinite(n.y)).toBe(true)
      expect(n.x).toBe(0)
    }
  })

  it('展开 main 与非 main 通道的连线', () => {
    const g = buildCanvas(
      wf(
        [{ name: 'A', type: 't' }, { name: 'B', type: 't' }, { name: 'M', type: 'm' }],
        {
          A: { main: [[{ node: 'B', type: 'main', index: 0 }]] },
          M: { ai_languageModel: [[{ node: 'A', type: 'ai_languageModel', index: 0 }]] }
        }
      )
    )
    expect(g.edges).toEqual([
      { from: 'A', to: 'B', channel: 'main' },
      { from: 'M', to: 'A', channel: 'ai_languageModel' }
    ])
    expect(g.danglingEdges).toBe(0)
  })

  it('指向不存在节点的连线被计入 danglingEdges，而不是画一条断线', () => {
    const g = buildCanvas(
      wf([{ name: 'A', type: 't' }], { A: { main: [[{ node: 'Ghost', type: 'main', index: 0 }]] } })
    )
    expect(g.edges).toHaveLength(0)
    expect(g.danglingEdges).toBe(1)
  })

  it('源节点不存在的连线同样计入 danglingEdges', () => {
    const g = buildCanvas(wf([{ name: 'A', type: 't' }], { Ghost: { main: [[{ node: 'A' }]] } }))
    expect(g.danglingEdges).toBe(1)
  })

  it('一个分支里的多条连线都会保留', () => {
    const g = buildCanvas(
      wf([{ name: 'A', type: 't' }, { name: 'B', type: 't' }, { name: 'C', type: 't' }], {
        A: { main: [[{ node: 'B' }, { node: 'C' }]] }
      })
    )
    expect(g.edges.map((e) => e.to)).toEqual(['B', 'C'])
  })

  it('空工作流 / 脏数据不抛异常', () => {
    expect(buildCanvas(null).nodes).toEqual([])
    expect(buildCanvas({}).edges).toEqual([])
    expect(buildCanvas({ nodes: 'nope', connections: 42 }).nodes).toEqual([])
    expect(buildCanvas(wf([null, 1, 'x', {}])).nodes).toEqual([])
  })

  it('不把节点参数带出来（可能含 URL、内联数据）', () => {
    const g = buildCanvas(
      wf([
        {
          name: 'HTTP',
          type: 'n8n-nodes-base.httpRequest',
          position: [0, 0],
          parameters: { url: 'https://secret.example/x?token=abc', jsCode: 'console.log(1)' },
          credentials: { httpHeaderAuth: { id: 'c1', name: 'mine' } }
        }
      ])
    )
    const dumped = JSON.stringify(g)
    expect(dumped).not.toContain('secret.example')
    expect(dumped).not.toContain('jsCode')
    expect(dumped).not.toContain('credentials')
  })

  it('节点缺 name 时跳过（画布上无法标注）', () => {
    const g = buildCanvas(wf([{ type: 't', position: [0, 0] }, { name: 'B', type: 't' }]))
    expect(g.nodes.map((n) => n.name)).toEqual(['B'])
  })
})
