/**
 * 工作流快照存储（每个工作流保留最近 N 份，**可选落盘**）。
 *
 * 用途：让 AI 的每一次写入都可回滚——「安全、可验证、可回滚」里的最后一块。
 *  - 每次改动前自动留一份快照；
 *  - 用户/Agent 可以列出、查看并恢复；
 *  - 默认只存内存（测试与纯内存用法不受影响）；调用 {@link SnapshotStore.useFile}
 *    之后才会写盘，重启不丢。
 *
 * 为什么要记 `baseUrl`：多个 profile 连不同 n8n 实例、却共用同一份状态文件时，
 * 两边的 workflowId 可能撞车。恢复错了实例 = 拿 A 的工作流覆盖 B，属于数据事故。
 * 所以 `list` / `get` 接受可选的 `baseUrl` 做过滤。
 */
import { randomUUID } from 'node:crypto'
import { readJsonFile, writeJsonFile } from './state-file.js'

/** 一份工作流快照（只含可写回 n8n 的字段）。 */
export interface WorkflowSnapshot {
  id: string
  workflowId: string
  createdAt: string
  /** 触发这次快照的动作，便于用户理解「恢复到哪一步」。 */
  reason: string
  name: string
  nodes: unknown[]
  connections: unknown
  settings: unknown
  /** 快照来自哪个 n8n 实例（落盘后用于隔离）。 */
  baseUrl?: string
}

type SnapshotFile = Record<string, WorkflowSnapshot[]>

export class SnapshotStore {
  private readonly byWorkflow = new Map<string, WorkflowSnapshot[]>()
  private filePath?: string
  private loaded = false
  /** 最近一次落盘是否失败（失败不影响内存态，只影响「重启还在不在」）。 */
  private persistFailed = false

  constructor(private readonly limit = 5) {}

  /**
   * 启用落盘并立刻加载已有数据。不调用则保持纯内存行为。
   * 同一个 store 只会加载一次（重复调用忽略）。
   */
  useFile(path: string): void {
    this.filePath = path
    this.load()
  }

  /** 落盘是否出过错（供 UI / 诊断使用）。 */
  get persistenceBroken(): boolean {
    return this.persistFailed
  }

  /** 记录一份快照，返回它（超过上限时丢弃最旧的一份）。 */
  add(input: {
    workflowId: string
    reason: string
    name: string
    nodes: unknown[]
    connections: unknown
    settings: unknown
    baseUrl?: string
  }): WorkflowSnapshot {
    this.ensureLoaded()
    const snapshot: WorkflowSnapshot = {
      id: randomUUID().slice(0, 8),
      createdAt: new Date().toISOString(),
      ...input
    }
    const list = this.byWorkflow.get(input.workflowId) ?? []
    list.push(snapshot)
    while (list.length > this.limit) list.shift()
    this.byWorkflow.set(input.workflowId, list)
    this.persist()
    return snapshot
  }

  /**
   * 列出某工作流的快照（最旧 → 最新）。
   * @param baseUrl 传入时只返回该实例的快照（不传则不过滤，兼容旧调用）。
   */
  list(workflowId: string, baseUrl?: string): WorkflowSnapshot[] {
    this.ensureLoaded()
    const list = this.byWorkflow.get(workflowId) ?? []
    if (!baseUrl) return [...list]
    return list.filter((s) => !s.baseUrl || s.baseUrl === baseUrl)
  }

  /** 取最近一份；可指定 id。 */
  get(workflowId: string, id?: string, baseUrl?: string): WorkflowSnapshot | undefined {
    const list = this.list(workflowId, baseUrl)
    if (id) return list.find((s) => s.id === id)
    return list.at(-1)
  }

  /** 清空（测试用）。 */
  clear(): void {
    this.byWorkflow.clear()
    this.loaded = true
    this.persist()
  }

  private ensureLoaded(): void {
    if (this.loaded) return
    this.load()
  }

  private load(): void {
    this.loaded = true
    if (!this.filePath) return
    const data = readJsonFile<SnapshotFile>(this.filePath, {})
    for (const [workflowId, list] of Object.entries(data)) {
      if (!Array.isArray(list)) continue
      const valid = list.filter(
        (s): s is WorkflowSnapshot =>
          Boolean(s) && typeof s === 'object' && typeof s.id === 'string' && Array.isArray(s.nodes)
      )
      if (valid.length) this.byWorkflow.set(workflowId, valid.slice(-this.limit))
    }
  }

  private persist(): void {
    if (!this.filePath) return
    const data: SnapshotFile = {}
    for (const [workflowId, list] of this.byWorkflow) data[workflowId] = list
    this.persistFailed = !writeJsonFile(this.filePath, data)
  }
}

/** 进程级单例：工具与 HUD 路由共用同一份快照。 */
export const snapshots = new SnapshotStore()
