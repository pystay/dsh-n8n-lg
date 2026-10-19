/**
 * 浮窗 → Agent 的桥。
 *
 * 背景：浮窗跑在渲染进程里，自己没法调 LLM。但宿主的 `sessionController` 服务
 * 有 `prompt({ sessionId, requestId, content })`，能把一条用户消息投给 Agent ——
 * 这正是「在画布上右键节点、输入需求、让 AI 去改」这条链路的前提。
 *
 * 服务名是 `sessionController`，不是 `sessions`（后者是另一个东西，
 * 参考 `dsh-schedule` 的 `static inject = ['agents','sessions','storageDomain','sessionController','sessionPersistence']`）。
 *
 * 当前阶段：确认服务可用，并探测 `list()` 的返回结构 —— 因为要发消息必须先知道
 * 「发给哪个会话」。探测**只记录键名与数量，不记录任何会话内容**。
 */
import { randomUUID } from 'node:crypto'

/** 会话列表的「形状」（用于排障，不含用户数据）。 */
export interface SessionShape {
  kind: 'array' | 'object' | 'unknown'
  count?: number
  /** 顶层对象的键名（分页结构常见 data / items / sessions）。 */
  keys?: string[]
  /** 单条会话的字段名（判断能否从中取到 id）。 */
  itemKeys?: string[]
  error?: string
}

let controller: Record<string, unknown> | undefined
let available = false
let methodNames: string[] = []
let shape: SessionShape | undefined

/** 由 apply() 在 `sessionController` 服务就绪时调用。 */
export function markAiBridge(service: unknown): void {
  const svc = service as Record<string, unknown> | undefined
  if (!svc || typeof svc !== 'object') {
    controller = undefined
    available = false
    methodNames = []
    return
  }
  controller = svc
  methodNames = Object.keys(svc).filter((k) => typeof svc[k] === 'function')
  // 真正要用的只有 prompt —— 没有它就谈不上「把需求交给 Agent」
  available = typeof svc.prompt === 'function'
}

/** 宿主是否提供了能把消息投给 Agent 的能力。 */
export function aiBridgeReady(): boolean {
  return available
}

/** 探测到的方法名（排障用）。 */
export function aiBridgeMethods(): string[] {
  return [...methodNames]
}

/** 探测结果（排障用）。 */
export function sessionShape(): SessionShape | undefined {
  return shape
}

/** 会话列表里的单条（只声明我们用到的字段）。 */
interface SessionItem {
  sessionId?: string
  updatedAt?: string
  agentAvailable?: boolean
  blank?: boolean
}

/**
 * 挑一个能接收消息的会话：Agent 可用 + 最近更新过。
 * 优先非空会话（`blank: false`），这样需求能接上原有上下文。
 */
async function pickSession(): Promise<string | undefined> {
  if (!controller) return undefined
  const list = controller.list
  if (typeof list !== 'function') return undefined
  const out = (await (list as () => unknown).call(controller)) as { items?: SessionItem[] } | undefined
  const items = Array.isArray(out?.items) ? out.items : []
  const usable = items.filter((it) => it?.sessionId && it.agentAvailable === true)
  if (usable.length === 0) return undefined
  usable.sort((a, b) => {
    // 非空会话优先，其次按更新时间倒序
    const blankDiff = Number(a.blank === true) - Number(b.blank === true)
    if (blankDiff !== 0) return blankDiff
    return String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))
  })
  return usable[0]?.sessionId
}

export interface PromptResult {
  ok: boolean
  /** 消息投递到了哪个会话。 */
  sessionId?: string
  error?: string
}

/**
 * 把一条文本需求投给 Agent。
 *
 * 用的是「最近可用的会话」——插件没有「用户当前在看哪个会话」的信息，
 * 这是能拿到的最接近的答案；只有一个对话时永远正确。
 */
export async function promptAgent(text: string): Promise<PromptResult> {
  if (!available || !controller) {
    return { ok: false, error: '当前宿主不支持把消息投给 Agent（没有 sessionController.prompt）' }
  }
  const prompt = controller.prompt as
    | ((req: unknown, src?: unknown) => Promise<unknown>)
    | undefined
  if (typeof prompt !== 'function') {
    return { ok: false, error: 'sessionController.prompt 不可调用' }
  }

  let sessionId: string | undefined
  try {
    sessionId = await pickSession()
  } catch (err) {
    return { ok: false, error: `读取会话列表失败：${err instanceof Error ? err.message : String(err)}` }
  }
  if (!sessionId) {
    return { ok: false, error: '没有可用的会话：请先在 DSH 里打开一个对话，再回来提交需求' }
  }

  try {
    await prompt.call(controller, {
      sessionId,
      requestId: randomUUID(),
      content: [{ type: 'text', text }]
    })
    return { ok: true, sessionId }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 把「改这个节点」包装成一条给 Agent 的指令。
 *
 * 刻意写清楚边界：只改这一个节点、先读后改、改完校验 —— 否则 Agent 很容易
 * 顺手把整个工作流重写一遍。
 */
export function buildNodeEditPrompt(input: {
  workflowId: string
  nodeName: string
  requirement: string
}): string {
  return [
    `【来自 DSH 浮窗画布】用户右键了工作流 ${input.workflowId} 的节点「${input.nodeName}」，提出了修改需求：`,
    '',
    input.requirement.trim(),
    '',
    '请按这个顺序处理：',
    `1. 用 n8n_get_workflow 读取 ${input.workflowId} 的当前配置，找到节点「${input.nodeName}」；`,
    '2. 只修改这一个节点的相关参数，**不要改动其他节点，也不要重排布局**；',
    '3. 用 n8n_validate_workflow 校验后再保存；',
    '4. 用一两句话说明你改了什么。'
  ].join('\n')
}
export async function probeSessionShape(): Promise<void> {
  if (!controller) {
    shape = { kind: 'unknown', error: 'sessionController 不可用' }
    return
  }
  const list = controller.list
  if (typeof list !== 'function') {
    shape = { kind: 'unknown', error: '没有 list() 方法' }
    return
  }
  try {
    const out = (await (list as () => unknown).call(controller)) as unknown
    if (Array.isArray(out)) {
      const first = out[0] as Record<string, unknown> | undefined
      shape = { kind: 'array', count: out.length, itemKeys: first ? Object.keys(first) : [] }
      return
    }
    if (out && typeof out === 'object') {
      const obj = out as Record<string, unknown>
      shape = { kind: 'object', keys: Object.keys(obj) }
      for (const key of ['data', 'items', 'sessions', 'rows', 'list']) {
        const v = obj[key]
        if (Array.isArray(v)) {
          const first = v[0] as Record<string, unknown> | undefined
          shape.count = v.length
          shape.itemKeys = first ? Object.keys(first) : []
          break
        }
      }
      return
    }
    shape = { kind: 'unknown', error: `list() 返回了 ${typeof out}` }
  } catch (err) {
    shape = { kind: 'unknown', error: err instanceof Error ? err.message : String(err) }
  }
}
