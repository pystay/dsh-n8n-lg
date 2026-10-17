/**
 * 搭建会话（Build Session）—— 让「AI 一步步搭工作流」变成**可观察、可控制**的过程。
 *
 * 为什么需要它：之前 AI 只是反复调 `n8n_add_nodes`，用户只能看浮窗里的画布刷新，
 * 既不知道「一共要做几步、现在第几步」，也没法暂停或中止。这里把搭建过程显式建模：
 *
 *  - Agent 先声明**计划**（goal + 步骤列表）→ 用户看到完整计划；
 *  - 每步执行时更新状态与结果（谁加的节点、验证是否通过、快照 id、失败原因）；
 *  - **暂停是真实生效的**：会话暂停期间，写操作会被 `blockReason` 拦下，
 *    而不只是界面上画个暂停图标。
 *
 * 会话默认只存内存；调用 {@link SessionStore.useFile} 后落盘，重启不丢。
 * 加载时会把上次遗留的 running / planning 会话标成 failed —— 进程都重启了，
 * 那个会话显然不会再有人推进，留着 running 只会让时间线永远卡住。
 */
import { randomUUID } from 'node:crypto'
import { readJsonFile, writeJsonFile } from './state-file.js'

export type SessionStatus = 'planning' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

/** 会话里的一个步骤（对应 Agent 的一次 `n8n_add_nodes` 等动作）。 */
export interface BuildStep {
  /** 幂等键：与 `n8n_add_nodes` 的 `stepId` 对应。 */
  id: string
  title: string
  detail?: string
  status: StepStatus
  startedAt?: string
  finishedAt?: string
  /** 该步写入前的自动快照 id（可回滚到这一步之前）。 */
  snapshotId?: string
  added?: number
  skipped?: string[]
  nodeCount?: number
  verified?: boolean
  /** 校验问题的摘要（只保留错误与警告的文案）。 */
  issues?: string[]
  error?: string
}

export interface BuildSession {
  id: string
  workflowId: string
  /** 用户的需求描述，用于在时间线上说明「在做什么」。 */
  goal: string
  status: SessionStatus
  steps: BuildStep[]
  createdAt: string
  updatedAt: string
  finishedAt?: string
  note?: string
}

export interface StepResultInput {
  added?: number
  skipped?: string[]
  nodeCount?: number
  verified?: boolean
  snapshotId?: string
  issues?: Array<{ level: string; message: string }>
  error?: string
}

function now(): string {
  return new Date().toISOString()
}

/** 落盘结构：会话本体 + 「哪个工作流的活跃会话是哪个」。 */
interface SessionFile {
  sessions: BuildSession[]
  active: Record<string, string>
}

/** 会话存储（默认内存，可选落盘；按工作流保留最近若干条）。 */
export class SessionStore {
  private readonly byId = new Map<string, BuildSession>()
  /** 每个工作流当前「活跃」的会话（running / paused / planning）。 */
  private readonly activeByWorkflow = new Map<string, string>()
  private filePath?: string
  private loaded = false
  private persistFailed = false

  constructor(private readonly limit = 10) {}

  /** 启用落盘并加载已有数据；不调用则保持纯内存行为。 */
  useFile(path: string): void {
    this.filePath = path
    this.load()
  }

  /** 落盘是否出过错。 */
  get persistenceBroken(): boolean {
    return this.persistFailed
  }

  /** 清空（测试用）。 */
  clear(): void {
    this.byId.clear()
    this.activeByWorkflow.clear()
    this.loaded = true
    this.persist()
  }

  /** 新建会话。同一工作流已有活跃会话时，旧会话标记为 cancelled。 */
  start(input: {
    workflowId: string
    goal: string
    steps: Array<{ id: string; title: string; detail?: string }>
  }): BuildSession {
    this.ensureLoaded()
    const previous = this.activeByWorkflow.get(input.workflowId)
    if (previous) {
      const old = this.byId.get(previous)
      if (old && (old.status === 'running' || old.status === 'paused' || old.status === 'planning')) {
        old.status = 'cancelled'
        old.updatedAt = now()
        old.finishedAt = now()
        old.note = '被新的搭建会话取代'
      }
    }

    const session: BuildSession = {
      id: randomUUID().slice(0, 8),
      workflowId: input.workflowId,
      goal: input.goal,
      status: 'running',
      steps: input.steps.map((s) => ({ id: s.id, title: s.title, detail: s.detail, status: 'pending' })),
      createdAt: now(),
      updatedAt: now()
    }
    this.byId.set(session.id, session)
    this.activeByWorkflow.set(input.workflowId, session.id)
    this.evict(session.workflowId)
    this.persist()
    return session
  }

  get(sessionId: string): BuildSession | undefined {
    this.ensureLoaded()
    return this.byId.get(sessionId)
  }

  /** 某工作流当前活跃的会话。 */
  activeFor(workflowId: string): BuildSession | undefined {
    this.ensureLoaded()
    const id = this.activeByWorkflow.get(workflowId)
    return id ? this.byId.get(id) : undefined
  }

  /** 某工作流最近一次会话（含已结束的）。 */
  latest(workflowId: string): BuildSession | undefined {
    return this.list(workflowId).at(-1)
  }

  list(workflowId?: string): BuildSession[] {
    this.ensureLoaded()
    const all = [...this.byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    return workflowId ? all.filter((s) => s.workflowId === workflowId) : all
  }

  /** 切换会话状态；结束时记录 finishedAt 并解除「活跃」标记。 */
  setStatus(sessionId: string, status: SessionStatus, note?: string): BuildSession {
    this.ensureLoaded()
    const session = this.byId.get(sessionId)
    if (!session) throw new Error(`找不到搭建会话：${sessionId}`)
    session.status = status
    session.updatedAt = now()
    if (note !== undefined) session.note = note
    if (status === 'completed' || status === 'cancelled' || status === 'failed') {
      session.finishedAt = now()
      if (this.activeByWorkflow.get(session.workflowId) === sessionId) {
        this.activeByWorkflow.delete(session.workflowId)
      }
    }
    this.persist()
    return session
  }

  /** 标记某步开始执行。 */
  beginStep(sessionId: string, stepId: string): BuildStep | undefined {
    const step = this.findStep(sessionId, stepId)
    if (!step) return undefined
    step.status = 'running'
    step.startedAt = now()
    this.touch(sessionId)
    return step
  }

  /** 记录某步的执行结果（由工具层在写入完成后调用）。 */
  recordResult(sessionId: string, stepId: string, result: StepResultInput): BuildStep | undefined {
    const step = this.findStep(sessionId, stepId)
    if (!step) return undefined
    step.added = result.added
    step.skipped = result.skipped
    step.nodeCount = result.nodeCount
    step.verified = result.verified
    step.snapshotId = result.snapshotId
    step.error = result.error
    if (result.issues) {
      step.issues = result.issues
        .filter((i) => i.level === 'error' || i.level === 'warning')
        .map((i) => i.message)
        .slice(0, 5)
    }
    if (result.error || (result.verified === false && (result.issues?.length ?? 0) > 0)) {
      step.status = 'failed'
      step.finishedAt = now()
    } else {
      step.status = 'done'
      step.finishedAt = now()
    }
    this.touch(sessionId)
    return step
  }

  /** 把还没跑过的步骤标为跳过（会话结束时用）。 */
  skipPending(sessionId: string, note?: string): void {
    const session = this.byId.get(sessionId)
    if (!session) return
    for (const step of session.steps) {
      if (step.status === 'pending' || step.status === 'running') {
        step.status = 'skipped'
        step.finishedAt = now()
        if (note) step.error = note
      }
    }
    this.touch(sessionId)
  }

  /** 会话是否处于暂停态（写操作据此被拦下）。 */
  pausedReason(workflowId: string): string | undefined {
    const session = this.activeFor(workflowId)
    if (session?.status === 'paused') {
      return `搭建会话 ${session.id} 处于暂停状态，写操作已被拦下；请先恢复（n8n_set_build_session_state state=running）或结束会话`
    }
    return undefined
  }

  private findStep(sessionId: string, stepId: string): BuildStep | undefined {
    return this.byId.get(sessionId)?.steps.find((s) => s.id === stepId)
  }

  private touch(sessionId: string): void {
    const session = this.byId.get(sessionId)
    if (session) session.updatedAt = now()
    this.persist()
  }

  /** 每个工作流只保留最近 N 条会话。 */
  private evict(workflowId: string): void {
    const all = this.list(workflowId)
    while (all.length > this.limit) {
      const oldest = all.shift()
      if (oldest) this.byId.delete(oldest.id)
    }
  }

  private ensureLoaded(): void {
    if (this.loaded) return
    this.load()
  }

  private load(): void {
    this.loaded = true
    if (!this.filePath) return
    const data = readJsonFile<SessionFile>(this.filePath, { sessions: [], active: {} })
    for (const session of data.sessions ?? []) {
      if (!session || typeof session.id !== 'string' || !Array.isArray(session.steps)) continue
      // 进程重启后，上次还在跑的会话不会再有 Agent 推进 —— 标成中断，
      // 否则时间线会永远停在 running，用户以为还在搭。
      if (session.status === 'running' || session.status === 'planning') {
        session.status = 'failed'
        session.note = session.note ?? '插件重启，会话已中断'
        session.finishedAt = session.finishedAt ?? now()
      }
      this.byId.set(session.id, session)
    }
    for (const [workflowId, sessionId] of Object.entries(data.active ?? {})) {
      if (this.byId.has(sessionId)) this.activeByWorkflow.set(workflowId, sessionId)
    }
  }

  private persist(): void {
    if (!this.filePath) return
    const data: SessionFile = {
      sessions: [...this.byId.values()],
      active: Object.fromEntries(this.activeByWorkflow)
    }
    this.persistFailed = !writeJsonFile(this.filePath, data)
  }
}

/** 进程级单例：工具层与 HUD 路由共用。 */
export const sessions = new SessionStore()

/** 会话进度的汇总（给 UI 用）。 */
export function summarizeSession(session: BuildSession): {
  total: number
  done: number
  failed: number
  skipped: number
  percent: number
} {
  const total = session.steps.length
  const done = session.steps.filter((s) => s.status === 'done').length
  const failed = session.steps.filter((s) => s.status === 'failed').length
  const skipped = session.steps.filter((s) => s.status === 'skipped').length
  const percent = total === 0 ? 0 : Math.round(((done + failed + skipped) / total) * 100)
  return { total, done, failed, skipped, percent }
}
