/**
 * WorkflowEditor —— 安全、可验证、可回滚的工作流编辑服务。
 *
 * 它解决的是「AI 增量搭工作流」时的四类真实故障：
 *  1. **重复**：同一个加节点请求重试 → 节点被追加两次。
 *  2. **丢更新**：两个请求各自基于旧版本 PUT → 后写的覆盖先写的。
 *  3. **连错线**：只合并 `main` 通道，AI 的 `ai_languageModel` 等通道被浅覆盖。
 *  4. **写坏数据**：不校验节点/连线就写库，激活时才 400。
 *
 * 对策：按工作流**串行**写入、按 id/name **去重**、按 stepId **幂等**、
 * **合并全部通道**、写前**校验**、写后**读回验证**、写前**自动快照**。
 */
import type { ClientProvider } from '../connection.js'
import type { N8nClient } from './client.js'
import type { WorkflowSummary } from './types.js'
import { snapshots, type WorkflowSnapshot } from './snapshots.js'

/** n8n 节点（结构原样透传，只声明我们校验/读取的字段）。 */
export interface N8nNode {
  id?: unknown
  name?: unknown
  type?: unknown
  typeVersion?: unknown
  position?: unknown
  parameters?: Record<string, unknown>
  disabled?: unknown
  [key: string]: unknown
}

/** n8n 连线：源节点 → 通道 → 分支 → 连接项。 */
export type ConnectionLink = { node: string; type?: string; index?: number }
export type Connections = Record<string, Record<string, ConnectionLink[][]>>

export interface NodeIssue {
  node: string
  level: 'error' | 'warning'
  message: string
}

export interface AddNodesResult {
  ok: boolean
  workflowId: string
  /** 本次真正新增的节点数。 */
  added: number
  /** 因 id/name 已存在或 stepId 重复而跳过的节点名。 */
  skipped: string[]
  /** 写入后的节点总数。 */
  nodeCount: number
  /** 写入前自动留下的快照 id（可据此回滚）。 */
  snapshotId?: string
  /** 校验发现的问题（有 error 时不会写入）。 */
  issues: NodeIssue[]
  /** 写入后是否读回验证通过。 */
  verified: boolean
  /** n8n 侧拒绝了写入时的原因（已做本地校验仍被拒的情况）。 */
  error?: string
}

export interface UpdateResult {
  ok: boolean
  workflowId: string
  nodeCount: number
  snapshotId?: string
  issues: NodeIssue[]
  verified: boolean
  /** n8n 侧拒绝了写入时的原因。 */
  error?: string
}

export interface RestoreResult {
  ok: boolean
  workflowId: string
  restoredFrom: string
  nodeCount: number
}

/** 把任意值安全地当作节点数组。 */
function asNodeArray(value: unknown): N8nNode[] {
  return Array.isArray(value) ? (value as N8nNode[]) : []
}

function nodeLabel(node: N8nNode, index: number): string {
  if (typeof node?.name === 'string' && node.name) return node.name
  if (typeof node?.id === 'string' && node.id) return node.id
  return `#${index}`
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

/**
 * 校验工作流（纯函数，便于单测）。
 *
 * `knownTypes` 可选：传入 n8n 实际支持的节点类型清单时，会额外检查
 * 类型是否真实存在（这正是此前「AI 编造节点类型」的根因）。
 */
export function validateWorkflow(
  nodes: unknown,
  connections: unknown,
  options: { knownTypes?: string[] } = {}
): NodeIssue[] {
  const issues: NodeIssue[] = []
  const list = asNodeArray(nodes)
  if (!Array.isArray(nodes)) {
    return [{ node: '(workflow)', level: 'error', message: 'nodes 必须是数组' }]
  }

  const seenIds = new Map<string, string>()
  const seenNames = new Map<string, string>()
  const webhookPaths = new Map<string, string>()
  const known = options.knownTypes ? new Set(options.knownTypes) : undefined

  list.forEach((node, index) => {
    const label = nodeLabel(node, index)
    if (!node || typeof node !== 'object') {
      issues.push({ node: `#${index}`, level: 'error', message: '节点必须是对象' })
      return
    }
    const id = str(node.id)
    const name = str(node.name)
    const type = str(node.type)

    if (!id) issues.push({ node: label, level: 'error', message: '缺少 id' })
    if (!name) issues.push({ node: label, level: 'error', message: '缺少 name' })
    if (!type) issues.push({ node: label, level: 'error', message: '缺少 type' })
    if (typeof node.typeVersion !== 'number') {
      issues.push({ node: label, level: 'warning', message: '缺少 typeVersion（n8n 可能拒绝保存/激活）' })
    }
    if (!Array.isArray(node.position)) {
      issues.push({ node: label, level: 'warning', message: '缺少 position（画布上位置会异常）' })
    }
    if (known && type && !known.has(type)) {
      issues.push({ node: label, level: 'error', message: `当前 n8n 不支持该节点类型：${type}` })
    }

    if (id) {
      const prev = seenIds.get(id)
      if (prev) issues.push({ node: label, level: 'error', message: `节点 id 重复：${id}（与 ${prev} 冲突）` })
      else seenIds.set(id, label)
    }
    if (name) {
      const prev = seenNames.get(name)
      if (prev) issues.push({ node: label, level: 'error', message: `节点 name 重复：${name}（与 ${prev} 冲突）` })
      else seenNames.set(name, label)
    }

    if (type === 'n8n-nodes-base.webhook') {
      const path = str(node.parameters?.path)
      if (!path) {
        issues.push({ node: label, level: 'error', message: 'Webhook 节点缺少 parameters.path' })
      } else {
        const prev = webhookPaths.get(path)
        if (prev) {
          issues.push({
            node: label,
            level: 'error',
            message: `Webhook 路径重复：${path}（与 ${prev} 冲突，激活会返回 409）`
          })
        } else {
          webhookPaths.set(path, label)
        }
      }
    }
  })

  const nameSet = new Set(seenNames.keys())
  const conn = (connections ?? {}) as Record<string, Record<string, ConnectionLink[][]>>
  if (connections && typeof connections === 'object') {
    for (const [source, channels] of Object.entries(conn)) {
      if (!nameSet.has(source)) {
        // n8n 会以 400 unknown_connection_target 拒绝，因此这里必须是 error（写前拦下）
        issues.push({
          node: source,
          level: 'error',
          message: '连线源节点不存在于节点列表中（n8n 会以 400 拒绝保存）'
        })
      }
      if (!channels || typeof channels !== 'object') continue
      for (const [channel, branches] of Object.entries(channels)) {
        if (!Array.isArray(branches)) continue
        branches.forEach((branch) => {
          if (!Array.isArray(branch)) return
          for (const link of branch) {
            const target = str(link?.node)
            if (!target) {
              issues.push({ node: source, level: 'error', message: `通道 ${channel} 存在缺少目标节点的连线` })
            } else if (!nameSet.has(target)) {
              // 实测：n8n 返回 400 "unknown_connection_target"，属于硬错误而非提示
              issues.push({
                node: source,
                level: 'error',
                message: `连线指向不存在的节点：${target}（通道 ${channel}；n8n 会以 400 拒绝保存）`
              })
            }
          }
        })
      }
    }
  }

  return issues
}

/** 合并连线：**逐通道**追加并按 (node,type,index) 去重，绝不覆盖已有分支。 */
export function mergeConnections(base: unknown, add: unknown): Connections {
  const out: Connections = clone(base) as Connections
  if (!add || typeof add !== 'object') return out
  for (const [source, channels] of Object.entries(add as Record<string, unknown>)) {
    if (!channels || typeof channels !== 'object') continue
    const target = (out[source] ??= {})
    for (const [channel, branches] of Object.entries(channels as Record<string, unknown>)) {
      const prevBranches = Array.isArray(target[channel]) ? (target[channel] as ConnectionLink[][]) : []
      const addBranches = Array.isArray(branches) ? (branches as ConnectionLink[][]) : []
      const length = Math.max(prevBranches.length, addBranches.length)
      const merged: ConnectionLink[][] = []
      for (let i = 0; i < length; i += 1) {
        const prev = Array.isArray(prevBranches[i]) ? prevBranches[i]! : []
        const extra = Array.isArray(addBranches[i]) ? addBranches[i]! : []
        merged.push(dedupeLinks([...prev, ...extra]))
      }
      target[channel] = merged
    }
  }
  return out
}

function dedupeLinks(links: ConnectionLink[]): ConnectionLink[] {
  const seen = new Set<string>()
  const out: ConnectionLink[] = []
  for (const link of links) {
    if (!link || typeof link !== 'object') continue
    const key = `${link.node}\u0000${link.type ?? ''}\u0000${link.index ?? 0}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(link)
  }
  return out
}

/** JSON 深拷贝（避免 structuredClone 的类型/环境差异）。 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? {})) as T
}

/** 把 n8n 的写入失败转成可读的一句话（保留 n8n 自己的原因）。 */
function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return `n8n 拒绝了这次写入：${message}`
}

export interface AddNodesInput {
  workflowId: string
  nodes: unknown
  connections?: unknown
  /** 幂等键：同一步骤重复调用不会重复写入。 */
  stepId?: string
  /** 已知的合法节点类型（可选，来自 `n8n export:nodes`）。 */
  knownTypes?: string[]
}

export class WorkflowEditor {
  /** 每个工作流一条串行队列，避免并发写互相覆盖。 */
  private readonly queues = new Map<string, Promise<unknown>>()
  /** 已应用的步骤（幂等保护）。 */
  private readonly appliedSteps = new Map<string, Set<string>>()

  constructor(private readonly provider: ClientProvider) {}

  /** 每次写操作都取「当前」客户端，连接被用户在浮窗里改掉后依然生效。 */
  private get client(): N8nClient {
    return this.provider.client()
  }

  /** 串行执行同一工作流的写操作。 */
  private enqueue<T>(workflowId: string, task: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(workflowId) ?? Promise.resolve()
    const run = prev.then(task, task)
    this.queues.set(
      workflowId,
      run.then(
        () => undefined,
        () => undefined
      )
    )
    return run
  }

  private steps(workflowId: string): Set<string> {
    let set = this.appliedSteps.get(workflowId)
    if (!set) {
      set = new Set()
      this.appliedSteps.set(workflowId, set)
    }
    return set
  }

  /** 为当前状态留一份快照（回滚点）。 */
  async capture(workflowId: string, reason: string): Promise<WorkflowSnapshot> {
    const wf = (await this.client.getWorkflow(workflowId)) as unknown as {
      name?: string
      nodes?: unknown
      connections?: unknown
      settings?: unknown
    }
    return snapshots.add({
      workflowId,
      reason,
      name: wf.name ?? 'Untitled',
      nodes: asNodeArray(wf.nodes),
      connections: wf.connections ?? {},
      settings: wf.settings ?? {}
    })
  }

  /** 列出某工作流的快照（最近的在后）。 */
  listSnapshots(workflowId: string): WorkflowSnapshot[] {
    return snapshots.list(workflowId)
  }

  /**
   * 增量追加节点：幂等 + 去重 + 全通道合并 + 校验 + 读回验证。
   * 校验发现 error 时**不写入**，把问题原样返回给 Agent 去修。
   */
  async addNodes(input: AddNodesInput): Promise<AddNodesResult> {
    const { workflowId, stepId, knownTypes } = input
    const incoming = asNodeArray(input.nodes)
    if (incoming.length === 0) throw new Error('nodes 必须是非空数组')

    if (stepId && this.steps(workflowId).has(stepId)) {
      return {
        ok: true,
        workflowId,
        added: 0,
        skipped: [],
        nodeCount: 0,
        issues: [],
        verified: true
      }
    }

    return this.enqueue(workflowId, async () => {
      const current = (await this.client.getWorkflow(workflowId)) as unknown as {
        name?: string
        nodes?: unknown
        connections?: unknown
        settings?: unknown
      }
      const existing = asNodeArray(current.nodes)
      const existingIds = new Set(existing.map((n) => str(n.id)).filter(Boolean) as string[])
      const existingNames = new Set(existing.map((n) => str(n.name)).filter(Boolean) as string[])

      const skipped: string[] = []
      const fresh = incoming.filter((node, index) => {
        const id = str(node?.id)
        const name = str(node?.name)
        if ((id && existingIds.has(id)) || (name && existingNames.has(name))) {
          skipped.push(nodeLabel(node, index))
          return false
        }
        return true
      })

      const nodes = [...existing, ...fresh]
      const connections = mergeConnections(current.connections, input.connections)

      // 没有任何新节点：不写入、不留快照（重试/重复调用应当完全无副作用）
      if (fresh.length === 0) {
        return {
          ok: true,
          workflowId,
          added: 0,
          skipped,
          nodeCount: existing.length,
          issues: [],
          verified: true
        }
      }

      const issues = validateWorkflow(nodes, connections, { knownTypes })
      const errors = issues.filter((i) => i.level === 'error')
      if (errors.length > 0) {
        return {
          ok: false,
          workflowId,
          added: 0,
          skipped,
          nodeCount: existing.length,
          issues,
          verified: false
        }
      }

      const snapshot = await this.capture(workflowId, `add_nodes(${fresh.length}) 前的自动快照`)
      // 中间态只存草稿，避免把半成品直接发布上线
      try {
        await this.client.updateWorkflow(
          workflowId,
          { name: current.name ?? 'Untitled', nodes, connections, settings: current.settings ?? {} },
          { publishIfActive: false }
        )
      } catch (err) {
        // 本地校验通过但 n8n 仍拒绝（例如它自己的结构校验）：返回结构化失败而不是抛异常
        return {
          ok: false,
          workflowId,
          added: 0,
          skipped,
          nodeCount: existing.length,
          snapshotId: snapshot.id,
          issues,
          verified: false,
          error: describeError(err)
        }
      }

      const verified = await this.verify(workflowId, fresh)
      if (stepId) this.steps(workflowId).add(stepId)

      return {
        ok: verified,
        workflowId,
        added: fresh.length,
        skipped,
        nodeCount: nodes.length,
        snapshotId: snapshot.id,
        issues,
        verified
      }
    })
  }

  /** 整份替换（保留未提及字段），供通用更新工具使用。 */
  async updateWorkflow(
    workflowId: string,
    patch: { name?: string; nodes?: unknown; connections?: unknown; settings?: unknown },
    options: { publishIfActive?: boolean; reason?: string } = {}
  ): Promise<UpdateResult> {
    return this.enqueue(workflowId, async () => {
      const current = (await this.client.getWorkflow(workflowId)) as unknown as {
        name?: string
        nodes?: unknown
        connections?: unknown
        settings?: unknown
      }
      const nodes = patch.nodes === undefined ? asNodeArray(current.nodes) : asNodeArray(patch.nodes)
      const connections = patch.connections === undefined ? (current.connections ?? {}) : patch.connections
      const issues = validateWorkflow(nodes, connections)
      const errors = issues.filter((i) => i.level === 'error')
      if (errors.length > 0) {
        return { ok: false, workflowId, nodeCount: nodes.length, issues, verified: false }
      }

      const snapshot = await this.capture(workflowId, options.reason ?? 'update 前的自动快照')
      try {
        await this.client.updateWorkflow(
          workflowId,
          {
            name: patch.name ?? current.name ?? 'Untitled',
            nodes,
            connections,
            settings: patch.settings ?? current.settings ?? {}
          },
          { publishIfActive: options.publishIfActive ?? false }
        )
      } catch (err) {
        return {
          ok: false,
          workflowId,
          nodeCount: nodes.length,
          snapshotId: snapshot.id,
          issues,
          verified: false,
          error: describeError(err)
        }
      }

      return {
        ok: true,
        workflowId,
        nodeCount: nodes.length,
        snapshotId: snapshot.id,
        issues,
        verified: true
      }
    })
  }

  /** 恢复到指定快照（默认最近一份）；恢复前会为当前状态再留一份快照。 */
  async restore(workflowId: string, snapshotId?: string): Promise<RestoreResult> {
    const snapshot = snapshots.get(workflowId, snapshotId)
    if (!snapshot) {
      throw new Error('找不到可恢复的快照：请先用 n8n_snapshot_workflow 记录一次')
    }
    return this.enqueue(workflowId, async () => {
      await this.capture(workflowId, `restore(${snapshot.id}) 前的自动快照`)
      await this.client.updateWorkflow(
        workflowId,
        {
          name: snapshot.name,
          nodes: asNodeArray(snapshot.nodes),
          connections: snapshot.connections ?? {},
          settings: snapshot.settings ?? {}
        },
        { publishIfActive: false }
      )
      return {
        ok: true,
        workflowId,
        restoredFrom: snapshot.id,
        nodeCount: asNodeArray(snapshot.nodes).length
      }
    })
  }

  /** 读回验证：新增的节点确实存在于 n8n 里。 */
  private async verify(workflowId: string, added: N8nNode[]): Promise<boolean> {
    if (added.length === 0) return true
    try {
      const after = (await this.client.getWorkflow(workflowId)) as unknown as { nodes?: unknown }
      const names = new Set(
        asNodeArray(after.nodes)
          .map((n) => str(n.name))
          .filter(Boolean) as string[]
      )
      return added.every((node) => {
        const name = str(node.name)
        return name ? names.has(name) : true
      })
    } catch {
      return false
    }
  }
}

/** 供工具层展示的工作流摘要（GET /workflows/{id} 的常用字段）。 */
export function summarizeWorkflow(wf: WorkflowSummary): {
  id: string
  name: string
  active: boolean
  nodeCount: number
} {
  return {
    id: wf.id,
    name: wf.name,
    active: Boolean(wf.active),
    nodeCount: asNodeArray((wf as { nodes?: unknown }).nodes).length
  }
}
