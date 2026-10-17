/**
 * 快照 / 会话的落盘与恢复。
 *
 * 这些用例都直接操作临时目录，不碰用户的 ~/.dsh。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readJsonFile, writeJsonFile } from '../src/n8n/state-file'
import { SnapshotStore } from '../src/n8n/snapshots'
import { SessionStore } from '../src/n8n/session'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-n8n-lg-state-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('state-file：原子写 + 容错读', () => {
  it('写入后能原样读回，且不留 .tmp', () => {
    const file = join(dir, 'a.json')
    expect(writeJsonFile(file, { x: 1 })).toBe(true)
    expect(readJsonFile(file, {})).toEqual({ x: 1 })
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('目录不存在时自动创建', () => {
    const file = join(dir, 'deep', 'nested', 'b.json')
    expect(writeJsonFile(file, [1, 2])).toBe(true)
    expect(existsSync(file)).toBe(true)
  })

  it('文件不存在 / 空 / 内容损坏都退化为 fallback，不抛异常', () => {
    const missing = join(dir, 'nope.json')
    expect(readJsonFile(missing, { fallback: true })).toEqual({ fallback: true })

    const empty = join(dir, 'empty.json')
    writeFileSync(empty, '   \n', 'utf8')
    expect(readJsonFile(empty, [])).toEqual([])

    const broken = join(dir, 'broken.json')
    writeFileSync(broken, '{"half": ', 'utf8')
    expect(readJsonFile(broken, 'fb')).toBe('fb')
  })
})

describe('SnapshotStore 落盘', () => {
  const add = (store: SnapshotStore, workflowId: string, reason: string, baseUrl?: string) =>
    store.add({ workflowId, reason, name: 'wf', nodes: [], connections: {}, settings: {}, baseUrl })

  it('不调 useFile 时完全不写文件（纯内存，测试与旧用法不受影响）', () => {
    const store = new SnapshotStore()
    add(store, 'w1', 'before')
    expect(readdirSync(dir)).toEqual([])
  })

  it('useFile 后写入，新建 store 指向同一文件能读回', () => {
    const file = join(dir, 'snapshots.json')
    const a = new SnapshotStore()
    a.useFile(file)
    const snap = add(a, 'w1', 'add_nodes 前')
    expect(existsSync(file)).toBe(true)

    const b = new SnapshotStore()
    b.useFile(file)
    const list = b.list('w1')
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe(snap.id)
    expect(list[0]?.reason).toBe('add_nodes 前')
  })

  it('超过上限只保留最近 N 份（重启后也一样）', () => {
    const file = join(dir, 'snapshots.json')
    const a = new SnapshotStore(3)
    a.useFile(file)
    for (const r of ['s1', 's2', 's3', 's4', 's5']) add(a, 'w1', r)

    const b = new SnapshotStore(3)
    b.useFile(file)
    expect(b.list('w1').map((s) => s.reason)).toEqual(['s3', 's4', 's5'])
  })

  it('按 baseUrl 隔离：不同实例的同名 workflowId 不会串', () => {
    const file = join(dir, 'snapshots.json')
    const store = new SnapshotStore()
    store.useFile(file)
    add(store, 'w1', 'from A', 'http://a.test')
    add(store, 'w1', 'from B', 'http://b.test')

    expect(store.list('w1', 'http://a.test').map((s) => s.reason)).toEqual(['from A'])
    expect(store.list('w1', 'http://b.test').map((s) => s.reason)).toEqual(['from B'])
    // 不传 baseUrl 时不过滤（兼容旧调用）
    expect(store.list('w1')).toHaveLength(2)
  })

  it('文件里混入脏数据时跳过坏条目，好条目照常加载', () => {
    const file = join(dir, 'snapshots.json')
    writeFileSync(
      file,
      JSON.stringify({
        w1: [
          null,
          { id: 'ok1', workflowId: 'w1', nodes: [], reason: 'good' },
          { id: 'bad-no-nodes' },
          'nonsense'
        ],
        w2: 'not-an-array'
      }),
      'utf8'
    )
    const store = new SnapshotStore()
    store.useFile(file)
    expect(store.list('w1').map((s) => s.id)).toEqual(['ok1'])
    expect(store.list('w2')).toEqual([])
  })
})

describe('SessionStore 落盘', () => {
  it('start 后写入，新 store 能读回活跃会话', () => {
    const file = join(dir, 'sessions.json')
    const a = new SessionStore()
    a.useFile(file)
    const s = a.start({ workflowId: 'w1', goal: '做个工作流', steps: [{ id: 's1', title: '加 Webhook' }] })

    const b = new SessionStore()
    b.useFile(file)
    expect(b.activeFor('w1')?.id).toBe(s.id)
    expect(b.get(s.id)?.goal).toBe('做个工作流')
    expect(b.get(s.id)?.steps).toHaveLength(1)
  })

  it('重启后 running 的会话被标成 failed（不会永远卡在 running）', () => {
    const file = join(dir, 'sessions.json')
    const a = new SessionStore()
    a.useFile(file)
    a.start({ workflowId: 'w1', goal: 'g', steps: [{ id: 's1', title: 't' }] })

    const b = new SessionStore()
    b.useFile(file)
    const loaded = b.activeFor('w1')
    expect(loaded?.status).toBe('failed')
    expect(loaded?.note).toContain('重启')
    expect(loaded?.finishedAt).toBeTruthy()
  })

  it('paused 的会话重启后仍是 paused（暂停要能跨重启生效）', () => {
    const file = join(dir, 'sessions.json')
    const a = new SessionStore()
    a.useFile(file)
    const s = a.start({ workflowId: 'w1', goal: 'g', steps: [{ id: 's1', title: 't' }] })
    a.setStatus(s.id, 'paused', '先停一下')

    const b = new SessionStore()
    b.useFile(file)
    expect(b.activeFor('w1')?.status).toBe('paused')
    expect(b.pausedReason('w1')).toContain('暂停')
  })

  it('步骤进度也会落盘', () => {
    const file = join(dir, 'sessions.json')
    const a = new SessionStore()
    a.useFile(file)
    const s = a.start({ workflowId: 'w1', goal: 'g', steps: [{ id: 's1', title: 't' }] })
    a.beginStep(s.id, 's1')
    a.recordResult(s.id, 's1', { added: 2, nodeCount: 2, verified: true })

    const b = new SessionStore()
    b.useFile(file)
    const step = b.get(s.id)?.steps[0]
    expect(step?.status).toBe('done')
    expect(step?.added).toBe(2)
    expect(step?.verified).toBe(true)
  })

  it('不调 useFile 时不写文件', () => {
    const store = new SessionStore()
    store.start({ workflowId: 'w1', goal: 'g', steps: [{ id: 's1', title: 't' }] })
    expect(readdirSync(dir)).toEqual([])
  })
})
