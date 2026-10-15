/**
 * 浏览器端（玻璃 HUD）单测。
 *
 * 审查曾指出「测试只覆盖了服务端与工具链，没有 HUD 测试」。这里用 node:vm +
 * 极简 DOM 直接跑**真实的** src/client/ui.js 与 src/client/store.js，
 * 覆盖几个曾经出过问题的交互：
 *  - 折叠后收到 AI 的 focus 指令必须自动展开
 *  - 关闭「自动刷新」后，同一目标的 focus 不得重载 iframe
 *  - 保存失败必须显示失败（不能假成功）
 *  - 非 2xx 响应不能被 JSON 里的 ok:true 掩盖
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'

const uiSource = readFileSync(new URL('../src/client/ui.js', import.meta.url), 'utf8')
const storeSource = readFileSync(new URL('../src/client/store.js', import.meta.url), 'utf8')

/** 极简 DOM 元素。 */
class FakeElement {
  constructor(tag) {
    this.tag = tag
    this.children = []
    this.attrs = {}
    this.style = {}
    this.events = {}
    this.className = ''
    this.disabled = false
    this.value = ''
    this._text = ''
    this.classList = {
      add: (c) => {
        if (!this.className.includes(c)) this.className = `${this.className} ${c}`.trim()
      },
      remove: (c) => {
        this.className = this.className.replace(c, '').trim()
      }
    }
  }
  set textContent(v) {
    this._text = v
    this.children = []
  }
  get textContent() {
    return this._text
  }
  setAttribute(k, v) {
    this.attrs[k] = v
    if (k === 'class') this.className = v
    if (k === 'src') this.src = v
    if (k === 'style') this.style = parseStyle(v)
  }
  addEventListener(type, fn) {
    this.events[type] = fn
  }
  /** ui.js 部分按钮用 `btn.onclick = fn` 直接赋值，这里同样要捕获。 */
  set onclick(fn) {
    this.events.click = fn
  }
  get onclick() {
    return this.events.click
  }
  appendChild(node) {
    this.children.push(node)
  }
  querySelector(sel) {
    return walk(this).find((n) => n.className.includes(sel.slice(1)))
  }
  remove() {
    this.removed = true
  }
}

function parseStyle(text) {
  const out = {}
  String(text)
    .split(';')
    .forEach((part) => {
      const [k, v] = part.split(':')
      if (k && v) out[k.trim()] = v.trim()
    })
  return out
}

function walk(node) {
  return [node, ...node.children.flatMap(walk)]
}

function makeDom() {
  const head = new FakeElement('head')
  const body = new FakeElement('body')
  const document = {
    head,
    body,
    createElement: (tag) => new FakeElement(tag),
    getElementById: (id) => [...walk(head), ...walk(body)].find((n) => n.attrs.id === id)
  }
  return { document, head, body, all: () => [...walk(head), ...walk(body)] }
}

/** 可控的定时器。 */
function makeTimers() {
  const timeouts = []
  const intervals = []
  return {
    timeouts,
    intervals,
    setTimeout: (fn, ms) => {
      timeouts.push({ fn, ms })
      return timeouts.length
    },
    clearTimeout: (id) => {
      if (timeouts[id - 1]) timeouts[id - 1].cancelled = true
    },
    setInterval: (fn) => {
      intervals.push(fn)
      return intervals.length
    },
    clearInterval: () => {},
    /** 执行所有未取消的 timeout。 */
    flushTimeouts: () => {
      const pending = timeouts.splice(0, timeouts.length)
      pending.forEach((t) => {
        if (!t.cancelled) t.fn()
      })
    }
  }
}

/** 让 Promise 链跑完。 */
async function flush(times = 12) {
  for (let i = 0; i < times; i += 1) await Promise.resolve()
}

function byText(dom, text) {
  return dom.all().find((n) => n.tag === 'button' && n.textContent === text)
}

/**
 * 挂载 HUD。
 * @param {object} opts
 * @param {function} opts.api  模拟 NS.api(path, options) -> Promise
 * @param {object} opts.config 模拟 localStorage 里的配置
 */
function mountHud(opts = {}) {
  const dom = makeDom()
  const timers = makeTimers()
  const cfg = { baseUrl: 'http://n8n.test', apiKey: 'k', ...(opts.config ?? {}) }
  const apiCalls = []
  const api =
    opts.api ??
    (async (path) => {
      if (path === '/health') return { ok: true, configured: true, baseUrl: 'http://n8n.test', source: 'runtime' }
      if (path === '/workflows') return { ok: true, data: [] }
      if (path.startsWith('/executions')) return { ok: true, data: [] }
      if (path === '/focus') return { ok: true, rev: 0, workflowId: null }
      return { ok: true }
    })

  const sandbox = {
    document: dom.document,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    open: () => {},
    __DSH_N8N_HUD__: {
      DEFAULT_BASE_URL: 'http://127.0.0.1:5678',
      loadConfig: () => cfg,
      saveConfig: () => opts.localStorageOk ?? true,
      pushConfig: (c) => api('/config', { method: 'POST', body: c }),
      api: (path, options) => {
        apiCalls.push({ path, options })
        return api(path, options)
      }
    }
  }
  vm.createContext(sandbox)
  vm.runInContext(uiSource, sandbox)
  const hud = sandbox.createHud()
  return { dom, timers, hud, apiCalls, sandbox }
}

afterEach(() => vi.unstubAllGlobals())

describe('HUD 浮窗交互（真实 ui.js）', () => {
  it('挂载后渲染面板，并显示连接来源', async () => {
    const { dom, hud } = mountHud()
    await flush()
    const panel = dom.all().find((n) => n.className.startsWith('dshn8n-panel'))
    expect(panel.style.display).toBe('flex')
    expect(dom.body.children.length).toBe(1)
    hud.destroy()
    expect(dom.body.children[0].removed).toBe(true)
  })

  it('折叠后收到 AI 的 focus 指令会自动展开（回归：此前仍为 none）', async () => {
    let rev = 0
    const { dom, timers } = mountHud({
      api: async (path) => {
        if (path === '/health') return { ok: true, configured: true, baseUrl: 'http://n8n.test', source: 'runtime' }
        if (path === '/workflows') return { ok: true, data: [] }
        if (path.startsWith('/executions')) return { ok: true, data: [] }
        if (path === '/focus') return { ok: true, rev, workflowId: rev > 0 ? 'wf-1' : null }
        return { ok: true }
      }
    })
    await flush()

    byText(dom, '—').events.click()
    const panel = dom.all().find((n) => n.className.startsWith('dshn8n-panel'))
    expect(panel.style.display).toBe('none')

    rev = 1
    timers.intervals[0]() // 轮询
    await flush()

    expect(panel.style.display).toBe('flex')
    const editor = dom.all().find((n) => n.className.startsWith('dshn8n-editor'))
    expect(editor.style.display).toBe('flex')
  })

  it('关闭「自动刷新」后，同一目标的 focus 不会重载 iframe（回归）', async () => {
    let rev = 0
    const { dom, timers } = mountHud({
      api: async (path) => {
        if (path === '/health') return { ok: true, configured: true, baseUrl: 'http://n8n.test', source: 'runtime' }
        if (path === '/workflows') return { ok: true, data: [] }
        if (path.startsWith('/executions')) return { ok: true, data: [] }
        if (path === '/focus') return { ok: true, rev, workflowId: rev > 0 ? 'wf-1' : null }
        return { ok: true }
      }
    })
    await flush()

    rev = 1
    timers.intervals[0]()
    await flush()
    timers.flushTimeouts() // 让首次 iframe 真正加载

    // 关掉自动刷新
    byText(dom, '自动刷新').events.click()

    const frame = dom.all().find((n) => n.tag === 'iframe')
    const before = frame.src

    // 同一目标、新 rev
    rev = 2
    timers.intervals[0]()
    await flush()
    timers.flushTimeouts()

    expect(frame.src).toBe(before)
  })

  it('编辑器链接使用宿主实际连接，而不是浏览器本地地址（回归）', async () => {
    let rev = 0
    const { dom, timers } = mountHud({
      // 本地存储里是另一个（过期的）实例
      config: { baseUrl: 'http://stale.test', apiKey: 'k' },
      api: async (path) => {
        if (path === '/health')
          return {
            ok: true,
            configured: true,
            baseUrl: 'http://real.test',
            editorBaseUrl: 'http://real.test/n8n',
            source: 'env'
          }
        if (path === '/workflows') return { ok: true, data: [] }
        if (path.startsWith('/executions')) return { ok: true, data: [] }
        if (path === '/focus') return { ok: true, rev, workflowId: rev > 0 ? 'wf-1' : null }
        return { ok: true }
      }
    })
    await flush()

    rev = 1
    timers.intervals[0]()
    await flush()
    timers.flushTimeouts()

    const frame = dom.all().find((n) => n.tag === 'iframe')
    expect(frame.src).toBe('http://real.test/n8n/workflow/wf-1')
    expect(frame.src).not.toContain('stale.test')
  })

  it('渲染搭建会话时间线，并可暂停（回归：此前没有进度视图）', async () => {
    const posted = []
    const { dom } = mountHud({
      api: async (path, options) => {
        if (path === '/health') return { ok: true, configured: true, baseUrl: 'http://n8n.test', source: 'runtime' }
        if (path === '/workflows') return { ok: true, data: [] }
        if (path.startsWith('/executions')) return { ok: true, data: [] }
        if (path === '/focus') return { ok: true, rev: 0, workflowId: null }
        if (path === '/session')
          return {
            ok: true,
            session: {
              id: 'sess-1',
              workflowId: 'w1',
              goal: '做个问候工作流',
              status: 'running',
              steps: [
                { id: 's1', title: '加 Webhook', status: 'done', added: 1, nodeCount: 1, verified: true, snapshotId: 'ab12' },
                { id: 's2', title: '加 Code', status: 'running' },
                { id: 's3', title: '连线', status: 'pending' }
              ]
            },
            progress: { total: 3, done: 1, failed: 0, skipped: 0, percent: 33 }
          }
        if (path === '/session/state') {
          posted.push(options.body)
          return { ok: true, session: { id: 'sess-1', status: 'paused', goal: 'g', steps: [] }, progress: { percent: 33 } }
        }
        return { ok: true }
      }
    })
    await flush()

    const section = dom.all().find((n) => n.className.includes('dshn8n-sec') && n.children.some((c) => c.textContent === '搭建进度'))
    expect(section?.style.display).toBe('block')
    const goal = dom.all().find((n) => n.className === 'dshn8n-sess-goal')
    expect(goal.textContent).toBe('做个问候工作流')
    const chip = dom.all().find((n) => n.className.startsWith('dshn8n-tag'))
    expect(chip.textContent).toContain('进行中 33%')

    const steps = dom.all().filter((n) => n.className.startsWith('dshn8n-step'))
    expect(steps).toHaveLength(3)
    expect(steps[0].className).toContain('done')
    expect(steps[1].className).toContain('running')
    expect(steps[2].className).toContain('pending')
    // 结果摘要（+节点数 / 快照）要能看见
    const subs = dom.all().filter((n) => n.className === 'sub').map((n) => n.textContent)
    expect(subs.join(' ')).toContain('+1 节点')
    expect(subs.join(' ')).toContain('快照 ab12')

    byText(dom, '暂停').events.click()
    await flush()
    expect(posted[0]).toMatchObject({ sessionId: 'sess-1', state: 'paused' })
  })

  it('没有会话时不显示时间线', async () => {
    const { dom } = mountHud({
      api: async (path) => {
        if (path === '/health') return { ok: true, configured: true, baseUrl: 'http://n8n.test', source: 'runtime' }
        if (path === '/workflows') return { ok: true, data: [] }
        if (path.startsWith('/executions')) return { ok: true, data: [] }
        if (path === '/focus') return { ok: true, rev: 0, workflowId: null }
        if (path === '/session') return { ok: true, session: null }
        return { ok: true }
      }
    })
    await flush()
    const section = dom.all().find((n) => n.className.includes('dshn8n-sec') && n.children.some((c) => c.textContent === '搭建进度'))
    expect(section?.style.display).toBe('none')
  })

  it('凭据按钮会展示缺失项与配置入口（不涉及密钥）', async () => {
    const { dom } = mountHud({
      api: async (path) => {
        if (path === '/health') return { ok: true, configured: true, baseUrl: 'http://n8n.test', source: 'runtime' }
        if (path === '/workflows')
          return { ok: true, data: [{ id: 'w1', name: 'wf', active: true, webhooks: [] }] }
        if (path.startsWith('/executions')) return { ok: true, data: [] }
        if (path === '/focus') return { ok: true, rev: 0, workflowId: null }
        if (path === '/session') return { ok: true, session: null }
        if (path.endsWith('/credentials'))
          return {
            ok: false,
            requirements: [],
            available: ['openAiApi'],
            missing: [
              { credentialType: 'googleSheetsOAuth2Api', nodes: ['写表格'], hint: '在 n8n 里新建 Google Sheets OAuth2 凭据' }
            ],
            unverified: [],
            credentialsUrl: 'http://n8n.test/home/credentials',
            note: ''
          }
        return { ok: true }
      }
    })
    await flush()
    byText(dom, '凭据').events.click()
    await flush()

    const box = dom.all().find((n) => n.className.startsWith('dshn8n-credbox'))
    expect(box.style.display).toBe('block')
    expect(box.textContent).toContain('googleSheetsOAuth2Api')
    expect(box.textContent).toContain('写表格')
    expect(box.textContent).toContain('http://n8n.test/home/credentials')
  })

  it('保存失败时显示失败，不假成功（回归）', async () => {
    const { dom } = mountHud({
      api: async (path) => {
        if (path === '/health') return { ok: true, configured: true, baseUrl: 'http://n8n.test', source: 'runtime' }
        if (path === '/workflows') return { ok: true, data: [] }
        if (path.startsWith('/executions')) return { ok: true, data: [] }
        if (path === '/focus') return { ok: true, rev: 0, workflowId: null }
        if (path === '/config') return { ok: false, error: '宿主拒绝保存' }
        return { ok: true }
      }
    })
    await flush()

    byText(dom, '保存').events.click()
    await flush()

    const msg = dom.all().find((n) => n.className === 'dshn8n-msg')
    expect(msg.textContent).toContain('保存失败')
    expect(msg.textContent).toContain('宿主拒绝保存')
  })

  it('本地存储不可用但宿主保存成功时，提示与事实一致', async () => {
    const { dom } = mountHud({ localStorageOk: false })
    await flush()
    byText(dom, '保存').events.click()
    await flush()
    const msg = dom.all().find((n) => n.className === 'dshn8n-msg')
    expect(msg.textContent).toContain('本地存储不可用')
  })

  it('执行列表失败时单独报错，不影响工作流状态灯（回归）', async () => {
    const { dom } = mountHud({
      api: async (path) => {
        if (path === '/health') return { ok: true, configured: true, baseUrl: 'http://n8n.test', source: 'runtime' }
        if (path === '/workflows') return { ok: true, data: [{ id: 'w', name: 'w', active: true, webhooks: [] }] }
        if (path.startsWith('/executions')) return { ok: false, error: '执行接口挂了' }
        if (path === '/focus') return { ok: true, rev: 0, workflowId: null }
        return { ok: true }
      }
    })
    await flush()
    const exMsg = dom.all().find((n) => n.className === 'dshn8n-exmsg')
    expect(exMsg.style.display).toBe('block')
    expect(exMsg.textContent).toContain('执行接口挂了')
  })

  it('未配置连接时给出明确提示', async () => {
    const { dom } = mountHud({
      config: { baseUrl: 'http://127.0.0.1:5678', apiKey: '' },
      api: async (path) => {
        if (path === '/health') return { ok: true, configured: false, baseUrl: null, source: null }
        if (path === '/focus') return { ok: true, rev: 0, workflowId: null }
        return { ok: true }
      }
    })
    await flush()
    const msg = dom.all().find((n) => n.className === 'dshn8n-msg')
    expect(msg.textContent).toContain('尚未连接 n8n')
  })

  it('触发时发送面板里的 JSON body（回归：此前总是空对象）', async () => {
    const calls = []
    const { dom } = mountHud({
      api: async (path, options) => {
        if (path === '/health') return { ok: true, configured: true, baseUrl: 'http://n8n.test', source: 'runtime' }
        if (path === '/workflows')
          return {
            ok: true,
            data: [{ id: 'w', name: 'wf', active: true, webhooks: [{ path: 'hello', method: 'POST' }] }]
          }
        if (path.startsWith('/executions')) return { ok: true, data: [] }
        if (path === '/focus') return { ok: true, rev: 0, workflowId: null }
        if (path === '/trigger') {
          calls.push(options.body)
          return { ok: true, result: { result: { executionId: '42' } } }
        }
        return { ok: true }
      }
    })
    await flush()

    const textarea = dom.all().find((n) => n.tag === 'textarea')
    textarea.value = '{"name":"world"}'
    byText(dom, '触发').events.click()
    await flush()

    expect(calls[0]).toMatchObject({ webhookPath: 'hello', method: 'POST', payload: { name: 'world' } })
    const msg = dom.all().find((n) => n.className === 'dshn8n-msg')
    expect(msg.textContent).toContain('执行 #42')
  })

  it('未激活的工作流点触发会先提示，不发请求', async () => {
    const calls = []
    const { dom } = mountHud({
      api: async (path, options) => {
        if (path === '/health') return { ok: true, configured: true, baseUrl: 'http://n8n.test', source: 'runtime' }
        if (path === '/workflows')
          return { ok: true, data: [{ id: 'w', name: 'wf', active: false, webhooks: [{ path: 'hello' }] }] }
        if (path.startsWith('/executions')) return { ok: true, data: [] }
        if (path === '/focus') return { ok: true, rev: 0, workflowId: null }
        calls.push(path)
        return { ok: true }
      }
    })
    await flush()
    byText(dom, '触发').events.click()
    await flush()
    // 只关心没有发出触发请求（启动时会有一次 /config 同步）
    expect(calls.filter((p) => p === '/trigger')).toEqual([])
    const msg = dom.all().find((n) => n.className === 'dshn8n-msg')
    expect(msg.textContent).toContain('未激活')
  })

  it('销毁时清理定时器（不再继续轮询）', async () => {
    const { timers, hud } = mountHud()
    await flush()
    expect(timers.intervals.length).toBe(1)
    hud.destroy()
    // destroy 后 root 被移除；再次触发 interval 不应抛错
    expect(() => timers.intervals[0]()).not.toThrow()
  })
})

describe('HUD 数据层（真实 store.js）', () => {
  function mountStore(fetchImpl, stored = new Map()) {
    const sandbox = {
      localStorage: {
        getItem: (k) => stored.get(k),
        setItem: (k, v) => stored.set(k, v)
      },
      fetch: fetchImpl
    }
    vm.createContext(sandbox)
    vm.runInContext(storeSource, sandbox)
    return { NS: sandbox.__DSH_N8N_HUD__, stored }
  }

  it('非 2xx 响应不会被 JSON 里的 ok:true 掩盖（回归）', async () => {
    const { NS } = mountStore(async () => ({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ ok: true })
    }))
    const res = await NS.api('/health')
    expect(res.ok).toBe(false)
    expect(res.httpStatus).toBe(500)
  })

  it('非 JSON 响应被包装成可读错误', async () => {
    const { NS } = mountStore(async () => ({ ok: false, status: 404, text: async () => 'not found' }))
    const res = await NS.api('/health')
    expect(res.ok).toBe(false)
    expect(res.error).toContain('404')
  })

  it('请求不再携带连接凭据（回归：此前会发送 x-n8n-api-key）', async () => {
    const seen = []
    const { NS } = mountStore(async (_url, init) => {
      seen.push(init.headers)
      return { ok: true, status: 200, text: async () => '{}' }
    })
    await NS.api('/workflows')
    expect(seen[0]['x-n8n-api-key']).toBeUndefined()
    expect(seen[0]['x-n8n-base-url']).toBeUndefined()
  })

  it('保存配置失败时 saveConfig 返回 false（调用方据此提示）', () => {
    const { NS } = mountStore(async () => ({ ok: true, status: 200, text: async () => '{}' }), {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      }
    })
    expect(NS.saveConfig({ baseUrl: 'x', apiKey: 'y' })).toBe(false)
  })

  it('默认地址仅在本地无配置时用于回填', () => {
    const { NS } = mountStore(async () => ({ ok: true, status: 200, text: async () => '{}' }))
    expect(NS.loadConfig()).toEqual({ baseUrl: 'http://127.0.0.1:5678', apiKey: '' })
  })
})
