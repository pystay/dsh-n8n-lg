/**
 * 工作流快照存储（内存环形缓冲）。
 *
 * 用途：让 AI 的每一次写入都可回滚——「安全、可验证、可回滚」里的最后一块。
 *  - 每次改动前自动留一份快照；
 *  - 用户/Agent 可以列出、查看并恢复；
 *  - 仅存内存：不落盘、不进 Git、进程重启即清空（避免把业务数据写到仓库里）。
 */
import { randomUUID } from 'node:crypto'

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
}

export class SnapshotStore {
  private readonly byWorkflow = new Map<string, WorkflowSnapshot[]>()

  constructor(private readonly limit = 5) {}

  /** 记录一份快照，返回它（超过上限时丢弃最旧的一份）。 */
  add(input: {
    workflowId: string
    reason: string
    name: string
    nodes: unknown[]
    connections: unknown
    settings: unknown
  }): WorkflowSnapshot {
    const snapshot: WorkflowSnapshot = {
      id: randomUUID().slice(0, 8),
      createdAt: new Date().toISOString(),
      ...input
    }
    const list = this.byWorkflow.get(input.workflowId) ?? []
    list.push(snapshot)
    while (list.length > this.limit) list.shift()
    this.byWorkflow.set(input.workflowId, list)
    return snapshot
  }

  list(workflowId: string): WorkflowSnapshot[] {
    return [...(this.byWorkflow.get(workflowId) ?? [])]
  }

  /** 取最近一份；可指定 id。 */
  get(workflowId: string, id?: string): WorkflowSnapshot | undefined {
    const list = this.byWorkflow.get(workflowId) ?? []
    if (id) return list.find((s) => s.id === id)
    return list.at(-1)
  }
}

/** 进程级单例：工具与 HUD 路由共用同一份快照。 */
export const snapshots = new SnapshotStore()
