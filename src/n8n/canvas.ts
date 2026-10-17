/**
 * 把 n8n 工作流压缩成「画布视图」需要的最小数据。
 *
 * 为什么不直接把整个工作流丢给浮窗：
 * 1. 体积 —— Code 节点的 jsCode 动辄几十 KB，画布一个字节都用不上；
 * 2. 安全 —— 节点参数里可能有 URL、内联数据、凭据引用，浮窗没有理由拿到。
 *
 * 只保留画布真正要画的东西：节点名、短类型、坐标、是否禁用，以及连线。
 */

export interface CanvasNode {
  id: string
  name: string
  /** 完整节点类型，如 `n8n-nodes-base.webhook`。 */
  type: string
  /** 短类型名（画布上标注用），如 `webhook`。 */
  kind: string
  x: number
  y: number
  disabled: boolean
}

export interface CanvasEdge {
  from: string
  to: string
  /** 通道名：`main` / `ai_languageModel` / `ai_tool` … */
  channel: string
}

export interface CanvasGraph {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  /** 指向不存在节点的连线数（画不出来，但如实报告，便于排查）。 */
  danglingEdges: number
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** 兼容 `[x, y]` 与 `{0: x, 1: y}` 两种 position 形态。 */
function positionOf(raw: unknown): [number, number] {
  if (Array.isArray(raw)) return [num(raw[0]), num(raw[1])]
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    return [num(obj['0'] ?? obj.x), num(obj['1'] ?? obj.y)]
  }
  return [0, 0]
}

/** `n8n-nodes-base.httpRequest` → `httpRequest`；`@n8n/n8n-nodes-langchain.agent` → `agent`。 */
export function shortType(type: string): string {
  const last = type.split('.').pop() ?? ''
  return last || type
}

export function buildCanvas(workflow: unknown): CanvasGraph {
  const wf = (workflow ?? {}) as { nodes?: unknown; connections?: unknown }
  const rawNodes = Array.isArray(wf.nodes) ? wf.nodes : []

  const nodes: CanvasNode[] = []
  const names = new Set<string>()

  for (const item of rawNodes) {
    if (!item || typeof item !== 'object') continue
    const node = item as Record<string, unknown>
    const name = str(node.name)
    if (!name) continue
    const [x, y] = positionOf(node.position)
    const type = str(node.type)
    names.add(name)
    nodes.push({
      id: str(node.id) || name,
      name,
      type,
      kind: shortType(type),
      x,
      y,
      disabled: node.disabled === true
    })
  }

  const edges: CanvasEdge[] = []
  let danglingEdges = 0

  const connections = wf.connections
  if (connections && typeof connections === 'object') {
    for (const [from, channels] of Object.entries(connections as Record<string, unknown>)) {
      if (!channels || typeof channels !== 'object') continue
      for (const [channel, branches] of Object.entries(channels as Record<string, unknown>)) {
        if (!Array.isArray(branches)) continue
        for (const branch of branches) {
          if (!Array.isArray(branch)) continue
          for (const link of branch) {
            const to = str((link as { node?: unknown } | null)?.node)
            if (!to) continue
            // 两端都得是真实节点，否则画不出线
            if (!names.has(from) || !names.has(to)) {
              danglingEdges += 1
              continue
            }
            edges.push({ from, to, channel })
          }
        }
      }
    }
  }

  return { nodes, edges, danglingEdges }
}
