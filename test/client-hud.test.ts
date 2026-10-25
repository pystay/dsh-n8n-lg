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
  getBoundingClientRect() {
    return {
      left: parseFloat(this.style.left) || 0,
      top: parseFloat(this.style.top) || 0,
      width: this.offsetWidth,
      height: this.offsetHeight
    }
  }
  // 真实 DOM 的 tagName 是大写，ui.js 的 isInteractive 读的是它
  get tagName() {
    return String(this.tag).toUpperCase()
  }
  get offsetWidth() {
    if (this.className.includes('dshn8n-panel')) return 352
    if (this.className.includes('dshn8n-orb')) return 54
    return 60
  }
  get offsetHeight() {
    if (this.className.includes('dshn8n-panel')) return 420
    if (this.className.includes('dshn8n-orb')) return 54
    return 60
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
  // 画布右键菜单会往 document 上挂「点别处关闭」/「Esc 关闭」的监听，
  // 所以这里要能收 addEventListener
  const docEvents = {}
  const document = {
    head,
    body,
    createElement: (tag) => new FakeElement(tag),
    // 只读画布用 SVG（createElementNS），这里同样返回 FakeElement 以便断言结构
    createElementNS: (_ns, tag) => new FakeElement(tag),
    getElementById: (id) => [...walk(head), ...walk(body)].find((n) => n.attrs.id === id),
    addEventListener(type, fn) {
      ;(docEvents[type] = docEvents[type] || []).push(fn)
    },
    removeEventListener(type) {
      delete docEvents[type]
    }
  }
  return { document, head, body, docEvents, all: () => [...walk(head), ...walk(body)] }
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
  const themeCalls = []
  const posCalls = []
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
    // 右键菜单按鼠标位置定位时要读视口尺寸
    window: { innerWidth: 1280, innerHeight: 800 },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    open: () => {},
    __DSH_N8N_HUD__: {
      DEFAULT_BASE_URL: 'http://127.0.0.1:5678',
      loadConfig: () => cfg,
      saveConfig: () => opts.localStorageOk ?? true,
      loadTheme: () => opts.theme ?? 'dark',
      saveTheme: (t) => themeCalls.push(t),
      loadPos: () => opts.pos ?? null,
      savePos: (p) => posCalls.push(p),
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
  return { dom, timers, hud, apiCalls, sandbox, themeCalls, posCalls }
}

afterEach(() => vi.unstubAllGlobals())

describe('HUD 浮窗交互（真实 ui.js）', () => {
  it('挂载后渲染面板，并显示连接来源', async () => {
    const { dom, hud } = mountHud()
    await flush()
    const panel = dom.all().find((n) => n.className.startsWith('dshn8n-panel'))
    // 展开/收起现在用 class 控制（display 切换没有过渡动画）
    expect(panel.className).not.toContain('dshn8n-hidden')
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
    expect(panel.className).toContain('dshn8n-hidden')

    rev = 1
    timers.intervals[0]() // 轮询
    await flush()

    expect(panel.className).not.toContain('dshn8n-hidden')
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
        if (path.startsWith('/embed-check')) return { ok: true, embeddable: true }
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
    expect(before).toContain('wf-1')

    // 同一目标、新 rev
    rev = 2
    timers.intervals[0]()
    await flush()
    timers.flushTimeouts()

    expect(frame.src).toBe(before)
  })

  it('n8n 禁止内嵌时显示说明与外部打开入口，而不是一片空白（回归）', async () => {
    const { dom } = mountHud({
      api: async (path) => {
        if (path === '/health') return { ok: true, configured: true, baseUrl: 'http://n8n.test', source: 'runtime' }
        if (path === '/workflows') return { ok: true, data: [{ id: 'w1', name: 'wf', active: true, webhooks: [] }] }
        if (path.startsWith('/executions')) return { ok: true, data: [] }
        if (path === '/focus') return { ok: true, rev: 0, workflowId: null }
        if (path.startsWith('/embed-check'))
          return { ok: true, embeddable: false, reason: 'n8n 返回 X-Frame-Options: SAMEORIGIN，浏览器会拒绝在浮窗里渲染它' }
        return { ok: true }
      }
    })
    await flush()

    byText(dom, '编辑').events.click()
    await flush()

    const frame = dom.all().find((n) => n.tag === 'iframe')
    const notice = dom.all().find((n) => n.className === 'dshn8n-embed-notice')
    expect(frame.style.display).toBe('none')
    expect(notice.style.display).toBe('block')
    const text = dom.all().find((n) => n.className === 'dshn8n-embed-text')
    expect(text.textContent).toContain('X-Frame-Options')
    expect(text.textContent).toContain('系统浏览器')
    // 仍然提供外部打开入口
    expect(dom.all().some((n) => n.tag === 'button' && n.textContent.includes('在系统浏览器打开编辑器'))).toBe(true)
  })

  it('n8n 允许内嵌时正常加载 iframe', async () => {
    let rev = 0
    const { dom, timers } = mountHud({
      api: async (path) => {
        if (path === '/health') return { ok: true, configured: true, baseUrl: 'http://n8n.test', source: 'runtime' }
        if (path === '/workflows') return { ok: true, data: [] }
        if (path.startsWith('/executions')) return { ok: true, data: [] }
        if (path === '/focus') return { ok: true, rev, workflowId: rev > 0 ? 'wf-9' : null }
        if (path.startsWith('/embed-check')) return { ok: true, embeddable: true }
        return { ok: true }
      }
    })
    await flush()
    rev = 1
    timers.intervals[0]()
    await flush()
    timers.flushTimeouts()

    const frame = dom.all().find((n) => n.tag === 'iframe')
    const notice = dom.all().find((n) => n.className === 'dshn8n-embed-notice')
    expect(frame.style.display).toBe('block')
    expect(notice.style.display).toBe('none')
    expect(frame.src).toBe('http://n8n.test/workflow/wf-9')
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
        if (path.startsWith('/embed-check')) return { ok: true, embeddable: true }
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

    // 按 class 定位触发 body 输入框：浮窗里还有别的 textarea（节点编辑需求），
    // 用 tag 找会拿到错的那个
    const textarea = dom.all().find((n) => n.className === 'dshn8n-payload')
    expect(textarea).toBeTruthy()
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

  it('主题偏好：默认深色，只认 light，其余回落到深色', () => {
    const { NS, stored } = mountStore(async () => ({ ok: true }))
    expect(NS.loadTheme()).toBe('dark')

    NS.saveTheme('light')
    expect(NS.loadTheme()).toBe('light')

    // 存了别的值（或旧版本残留）不能把浮窗搞成白屏
    stored.set('dsh-n8n-lg:theme', 'solarized')
    expect(NS.loadTheme()).toBe('dark')
  })

  it('localStorage 不可用时 loadTheme 不抛异常', () => {
    const sandbox = { fetch: async () => ({ ok: true }) }
    vm.createContext(sandbox)
    vm.runInContext(storeSource, sandbox)
    const NS = sandbox.__DSH_N8N_HUD__
    expect(NS.loadTheme()).toBe('dark')
    expect(() => NS.saveTheme('light')).not.toThrow()
  })

  it('非 2xx 响应不会被 JSON 里的 ok:true 掩盖（回归）', async () => {    const { NS } = mountStore(async () => ({
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

describe('只读画布（n8n 拒绝被 iframe 内嵌时的替代）', () => {
  function canvasApi(canvasPayload) {
    return async (path) => {
      if (path === '/health') {
        return { ok: true, configured: true, baseUrl: 'http://n8n.test', source: 'runtime' }
      }
      if (path === '/workflows') return { ok: true, data: [] }
      if (path.startsWith('/executions')) return { ok: true, data: [] }
      if (path === '/focus') return { ok: true, rev: 1, workflowId: 'wf-1' }
      if (path.startsWith('/embed-check')) {
        return { ok: true, embeddable: false, reason: 'n8n 返回 X-Frame-Options: SAMEORIGIN' }
      }
      if (path === '/workflows/wf-1/canvas') return canvasPayload
      return { ok: true }
    }
  }

  const twoNodes = {
    ok: true,
    workflowId: 'wf-1',
    name: 'demo',
    nodes: [
      { id: 'n1', name: 'Webhook', type: 'n8n-nodes-base.webhook', kind: 'webhook', x: 0, y: 0, disabled: false },
      { id: 'n2', name: 'Code', type: 'n8n-nodes-base.code', kind: 'code', x: 220, y: 0, disabled: false }
    ],
    edges: [{ from: 'Webhook', to: 'Code', channel: 'main' }],
    danglingEdges: 0
  }

  it('内嵌被拒时画出节点与连线，而不是留一句说明', async () => {
    const { dom, timers } = mountHud({ api: canvasApi(twoNodes) })
    await flush()
    timers.intervals[0]()
    await flush(30)

    const svg = dom.all().find((n) => n.tag === 'svg')
    expect(svg).toBeTruthy()
    // 先画连线（path）再画节点（g）
    expect(svg.children.filter((c) => c.tag === 'path')).toHaveLength(1)
    expect(svg.children.filter((c) => c.tag === 'g')).toHaveLength(2)
  })

  it('空工作流显示提示，不生成空 SVG', async () => {
    const { dom, timers } = mountHud({
      api: canvasApi({ ok: true, workflowId: 'wf-1', name: 'empty', nodes: [], edges: [], danglingEdges: 0 })
    })
    await flush()
    timers.intervals[0]()
    await flush(30)

    expect(dom.all().find((n) => n.tag === 'svg')).toBeFalsy()
    expect(dom.all().some((n) => n._text.includes('还没有节点'))).toBe(true)
  })

  it('主题按钮：在 root 上切换 dshn8n-light 类', async () => {
    const { dom } = mountHud({})
    await flush()

    const root = dom.all().find((n) => n.className && n.className.indexOf('dshn8n-root') === 0)
    expect(root).toBeTruthy()
    expect(root.className).not.toContain('dshn8n-light')

    const btn = dom.all().find((n) => n.className && n.className.includes('dshn8n-themebtn'))
    expect(btn).toBeTruthy()
    // 深色下显示「☀」（点了变亮）
    expect(btn._text).toBe('☀')

    btn.onclick()
    expect(root.className).toContain('dshn8n-light')
    expect(btn._text).toBe('☾')

    btn.onclick()
    expect(root.className).not.toContain('dshn8n-light')
    expect(btn._text).toBe('☀')
  })

  it('右键菜单带上当前主题类（菜单挂在 body 上，拿不到 root 的变量）', async () => {
    const { dom, timers } = mountHud({ api: canvasApi(twoNodes) })
    await flush()
    timers.intervals[0]()
    await flush(30)

    const svg = dom.all().find((n) => n.tag === 'svg')
    svg.events.contextmenu({ preventDefault() {}, clientX: 10, clientY: 10 })
    const menu = dom.all().find((n) => n.className && n.className.includes('dshn8n-menu'))
    expect(menu).toBeTruthy()
    expect(menu.className).not.toContain('dshn8n-light')
  })

  it('画布接口失败时给出可读错误，不静默留白', async () => {
    const { dom, timers } = mountHud({ api: canvasApi({ ok: false, error: 'n8n API 500' }) })
    await flush()
    timers.intervals[0]()
    await flush(30)

    expect(dom.all().some((n) => n._text.includes('画布读取失败'))).toBe(true)
  })

  it('右键节点弹出「修改这个节点…」', async () => {
    const { dom, timers } = mountHud({ api: canvasApi(twoNodes) })
    await flush()
    timers.intervals[0]()
    await flush(30)

    const svg = dom.all().find((n) => n.tag === 'svg')
    const nodeG = svg.children.find((c) => c.tag === 'g')
    nodeG.events.contextmenu({
      preventDefault() {},
      stopPropagation() {},
      clientX: 20,
      clientY: 20
    })

    const item = dom.all().find((n) => n.className === 'dshn8n-menu-item')
    expect(item).toBeTruthy()
    expect(item._text).toBe('修改这个节点…')
  })

  it('右键画布空白处弹出「添加节点…」，提交后走 /node-add', async () => {
    const calls = []
    const base = canvasApi(twoNodes)
    const { dom, timers } = mountHud({
      api: async (path, options) => {
        if (path === '/node-add') {
          calls.push(options.body)
          return { ok: true, sessionId: 'sess-1' }
        }
        return base(path, options)
      }
    })
    await flush()
    timers.intervals[0]()
    await flush(30)

    const svg = dom.all().find((n) => n.tag === 'svg')
    svg.events.contextmenu({ preventDefault() {}, clientX: 30, clientY: 30 })

    const item = dom.all().find((n) => n.className === 'dshn8n-menu-item')
    expect(item._text).toBe('添加节点…')
    item.onclick()
    await flush()

    const textarea = dom.all().find((n) => n.className === 'dshn8n-nodeedit-input')
    expect(textarea).toBeTruthy()
    textarea.value = '加个 HTTP 节点，接在 Webhook 后面'
    // 回车提交
    textarea.events.keydown({ key: 'Enter', shiftKey: false, preventDefault() {} })
    await flush()

    expect(calls[0]).toMatchObject({
      workflowId: 'wf-1',
      requirement: '加个 HTTP 节点，接在 Webhook 后面'
    })
    // 添加不需要 nodeName
    expect(calls[0].nodeName).toBeUndefined()
  })

  it('右键节点提交时走 /node-edit，并带上节点名', async () => {
    const calls = []
    const base = canvasApi(twoNodes)
    const { dom, timers } = mountHud({
      api: async (path, options) => {
        if (path === '/node-edit') {
          calls.push(options.body)
          return { ok: true, sessionId: 'sess-2' }
        }
        return base(path, options)
      }
    })
    await flush()
    timers.intervals[0]()
    await flush(30)

    const svg = dom.all().find((n) => n.tag === 'svg')
    const nodeG = svg.children.find((c) => c.tag === 'g')
    nodeG.events.contextmenu({
      preventDefault() {},
      stopPropagation() {},
      clientX: 20,
      clientY: 20
    })
    dom.all().find((n) => n.className === 'dshn8n-menu-item').onclick()
    await flush()

    const textarea = dom.all().find((n) => n.className === 'dshn8n-nodeedit-input')
    textarea.value = '把 method 换成 POST'
    textarea.events.keydown({ key: 'Enter', shiftKey: false, preventDefault() {} })
    await flush()

    expect(calls[0]).toMatchObject({
      workflowId: 'wf-1',
      nodeName: 'Webhook',
      requirement: '把 method 换成 POST'
    })
  })
})

describe('回滚提示（工作流被重建时要说清楚新 id）', () => {
  function rollbackApi(restorePayload) {
    return async (path) => {
      if (path === '/health') {
        return { ok: true, configured: true, baseUrl: 'http://n8n.test', source: 'runtime' }
      }
      if (path === '/workflows') {
        return {
          ok: true,
          data: [{ id: 'wf-1', name: 'demo', active: false }],
          nextCursor: null
        }
      }
      if (path.startsWith('/executions')) return { ok: true, data: [] }
      if (path === '/focus') return { ok: true, rev: 0, workflowId: null }
      if (path === '/workflows/wf-1/restore') return restorePayload
      return { ok: true }
    }
  }

  it('recreated 时提示新 id', async () => {
    const { dom, timers } = mountHud({
      api: rollbackApi({ ok: true, recreated: true, workflowId: 'wf-rebuilt', restoredFrom: 's1' })
    })
    await flush(20)
    timers.intervals[0]()
    await flush(30)

    const btn = dom.all().find((n) => n.tag === 'button' && n._text === '回滚')
    expect(btn).toBeTruthy()
    btn.onclick()
    await flush(30)

    const shown = dom.all().map((n) => n._text).join('\n')
    expect(shown).toContain('wf-rebuilt')
    expect(shown).toContain('重建')
  })

  it('正常回滚时提示快照 id，不提重建', async () => {
    const { dom, timers } = mountHud({
      api: rollbackApi({ ok: true, restoredFrom: 'snap-7', workflowId: 'wf-1' })
    })
    await flush(20)
    timers.intervals[0]()
    await flush(30)

    const btn = dom.all().find((n) => n.tag === 'button' && n._text === '回滚')
    expect(btn).toBeTruthy()
    btn.onclick()
    await flush(30)

    const shown = dom.all().map((n) => n._text).join('\n')
    expect(shown).toContain('snap-7')
    expect(shown).not.toContain('重建')
  })
})

describe('拖动定位', () => {
  /** document 上的监听现在是数组（拖拽在球和标题栏各注册一次）。 */
  function fireDoc(dom, type, ev) {
    ;(dom.docEvents[type] || []).forEach((fn) => fn(ev))
  }

  function grab(dom, handle, x = 100, y = 100) {
    handle.events.mousedown({
      button: 0,
      clientX: x,
      clientY: y,
      target: handle,
      preventDefault() {}
    })
  }

  it('拖动悬浮球会移动整个浮窗，并记住位置', async () => {
    const { dom, posCalls } = mountHud({})
    await flush()
    const root = dom.all().find((n) => n.className.startsWith('dshn8n-root'))
    const orb = dom.all().find((n) => n.className.includes('dshn8n-orb'))

    grab(dom, orb)
    fireDoc(dom, 'mousemove', { clientX: 160, clientY: 140 })
    fireDoc(dom, 'mouseup', {})

    expect(root.style.left).toBe('60px')
    expect(root.style.top).toBe('40px')
    // 必须同时清掉 right/bottom，否则 left 和 right 一起生效会把容器拉宽
    expect(root.style.right).toBe('auto')
    expect(root.style.bottom).toBe('auto')
    expect(posCalls.at(-1)).toEqual({ left: 60, top: 40 })
  })

  it('拖动标题栏也能移动', async () => {
    const { dom } = mountHud({})
    await flush()
    const root = dom.all().find((n) => n.className.startsWith('dshn8n-root'))
    const head = dom.all().find((n) => n.className.startsWith('dshn8n-head'))

    grab(dom, head, 200, 200)
    fireDoc(dom, 'mousemove', { clientX: 180, clientY: 260 })
    fireDoc(dom, 'mouseup', {})

    expect(root.style.left).toBe('-20px'.replace('-20px', '0px'))
    expect(root.style.top).toBe('60px')
  })

  it('移动小于 3px 算手抖，不算拖动（点击仍有效）', async () => {
    const { dom, posCalls } = mountHud({})
    await flush()
    const root = dom.all().find((n) => n.className.startsWith('dshn8n-root'))
    const orb = dom.all().find((n) => n.className.includes('dshn8n-orb'))
    const panel = dom.all().find((n) => n.className.startsWith('dshn8n-panel'))

    grab(dom, orb)
    fireDoc(dom, 'mousemove', { clientX: 101, clientY: 100 })
    fireDoc(dom, 'mouseup', {})

    expect(root.style.left).toBeFalsy()
    expect(posCalls).toHaveLength(0)
    // 手抖之后点击应该照常展开
    orb.onclick()
    expect(panel.className).not.toContain('dshn8n-hidden')
  })

  it('拖完松手不会顺手把面板打开', async () => {
    const { dom } = mountHud({})
    await flush()
    const orb = dom.all().find((n) => n.className.includes('dshn8n-orb'))
    const panel = dom.all().find((n) => n.className.startsWith('dshn8n-panel'))
    // 先收起
    byText(dom, '—').events.click()
    expect(panel.className).toContain('dshn8n-hidden')

    grab(dom, orb)
    fireDoc(dom, 'mousemove', { clientX: 200, clientY: 200 })
    fireDoc(dom, 'mouseup', {})
    // 浏览器在 mouseup 之后会补发 click，这里模拟它
    orb.onclick()

    expect(panel.className).toContain('dshn8n-hidden')
  })

  it('拖不出视口（视口 1280×800，浮窗 60×60）', async () => {
    const { dom } = mountHud({})
    await flush()
    const root = dom.all().find((n) => n.className.startsWith('dshn8n-root'))
    const orb = dom.all().find((n) => n.className.includes('dshn8n-orb'))

    // 收起状态下只有球可见，边界按球（54×54）算 → 1280-54 / 800-54
    byText(dom, '—').events.click()

    grab(dom, orb)
    fireDoc(dom, 'mousemove', { clientX: 99999, clientY: 99999 })
    fireDoc(dom, 'mouseup', {})

    expect(root.style.left).toBe('1226px')
    expect(root.style.top).toBe('746px')
  })

  it('按在标题栏的按钮上不会开始拖动', async () => {
    const { dom, posCalls } = mountHud({})
    await flush()
    const root = dom.all().find((n) => n.className.startsWith('dshn8n-root'))
    const head = dom.all().find((n) => n.className.startsWith('dshn8n-head'))
    const refresh = dom.all().find((n) => n.tag === 'button' && n.textContent === '刷新')

    // 真实浏览器里按在按钮上，mousedown 会冒泡到标题栏，target 仍是按钮
    head.events.mousedown({
      button: 0,
      clientX: 100,
      clientY: 100,
      target: refresh,
      preventDefault() {}
    })
    fireDoc(dom, 'mousemove', { clientX: 300, clientY: 300 })
    fireDoc(dom, 'mouseup', {})

    expect(root.style.left).toBeFalsy()
    expect(posCalls).toHaveLength(0)
  })

  it('展开时边界按面板算，收起时按球算（回归：收起后球拖不到屏幕右侧）', async () => {
    const { dom } = mountHud({})
    await flush()
    const root = dom.all().find((n) => n.className.startsWith('dshn8n-root'))

    // 展开状态：面板 352×420，边界 1280-352 / 800-420
    const head = dom.all().find((n) => n.className.startsWith('dshn8n-head'))
    grab(dom, head, 100, 100)
    fireDoc(dom, 'mousemove', { clientX: 99999, clientY: 99999 })
    fireDoc(dom, 'mouseup', {})
    expect(root.style.left).toBe('928px')
    expect(root.style.top).toBe('380px')

    // 收起后只剩 54×54 的球，边界应该放宽到 1280-54 / 800-54。
    // 如果这里还按面板算，球就只能停在 928 附近，看起来「拖不远」。
    byText(dom, '—').events.click()
    const orb = dom.all().find((n) => n.className.includes('dshn8n-orb'))
    grab(dom, orb, 100, 100)
    fireDoc(dom, 'mousemove', { clientX: 99999, clientY: 99999 })
    fireDoc(dom, 'mouseup', {})
    expect(root.style.left).toBe('1226px')
    expect(root.style.top).toBe('746px')
  })

  it('收起后悬浮球回到右下角（回归：展开时的夹取会把球推走）', async () => {
    const { dom, posCalls, timers } = mountHud({})
    await flush()
    const root = dom.all().find((n) => n.className.startsWith('dshn8n-root'))
    const orb = dom.all().find((n) => n.className.includes('dshn8n-orb'))

    // 初始是展开态，先收起，这样拖动才按球（54×54）算边界
    byText(dom, '—').events.click()

    // 把球拖到最右下角 → 1226 / 746
    grab(dom, orb, 100, 100)
    fireDoc(dom, 'mousemove', { clientX: 99999, clientY: 99999 })
    fireDoc(dom, 'mouseup', {})
    expect(root.style.left).toBe('1226px')
    expect(root.style.top).toBe('746px')

    // 拖完会短暂屏蔽点击（防止"拖一下顺手把面板打开"），推进定时器让它复位
    timers.flushTimeouts()

    // 展开：面板 352 宽在这个位置放不下，会被夹到 928 —— 这里就是球"跳走"的根源
    orb.onclick()
    expect(root.style.left).toBe('928px')

    // 收起：必须回右下角默认位（left/top 清空，交回 CSS 的 right/bottom）
    byText(dom, '—').events.click()
    expect(root.style.left).toBe('')
    expect(root.style.top).toBe('')
    expect(root.style.right).toBe('')
    expect(root.style.bottom).toBe('')
    // 同时把记住的位置清掉，否则下次启动又回到被夹过的坐标
    expect(posCalls.at(-1)).toBe(null)
  })

  it('启动时按记住的位置摆放', async () => {
    const { dom } = mountHud({ pos: { left: 120, top: 80 } })
    await flush()
    const root = dom.all().find((n) => n.className.startsWith('dshn8n-root'))
    expect(root.style.left).toBe('120px')
    expect(root.style.top).toBe('80px')
  })
})
