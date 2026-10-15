/*
 * dsh-n8n-lg · HUD 视图层（浏览器端）
 *
 * 由 build-client.mjs 拼进 lib/client.js 的 `factory(require)` 体内，因此这里
 * 顶层的 inject / name / apply 就是 bundle 导出的三个符号。
 *
 * 设计要点：
 *  - `inject = []`：不依赖宿主服务、不占布局槽，浮窗挂在 document.body 上自管几何。
 *  - 零依赖、不 import 任何 @deepseek-ai/*，纯 DOM + 原生 fetch。
 *  - 编辑器：先问宿主 n8n 是否允许被内嵌（桌面端 webviewTag=false，用 <iframe>；
 *    但 n8n 2.43.5 会返回 X-Frame-Options: SAMEORIGIN → 此时改为给出说明 +
 *    「在系统浏览器打开」入口，避免用户面对一片空白）。
 *  - 生命周期交给 ctx.effect：卸载 / HMR 时自动销毁窗口、定时器与在途请求。
 *  - 观看模式 vs 手动编辑：关闭「自动刷新」后不再强制重载，避免打断用户正在改的内容。
 */

var inject = []
var name = 'dsh-n8n-lg-client'
var POLL_MS = 5000
var STYLE_ID = 'dsh-n8n-lg-hud-style'

var CSS = [
  '.dshn8n-root{position:fixed;right:18px;bottom:18px;z-index:2147483000;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;color:#e9edf7;}',
  '.dshn8n-orb{width:54px;height:54px;border-radius:50%;border:1px solid rgba(255,255,255,.22);cursor:pointer;color:#eaf0ff;font-weight:700;font-size:13px;letter-spacing:.5px;background:radial-gradient(120% 120% at 30% 20%,rgba(120,160,255,.45),rgba(30,40,70,.55));backdrop-filter:blur(14px) saturate(150%);-webkit-backdrop-filter:blur(14px) saturate(150%);box-shadow:0 8px 30px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.25);transition:transform .15s ease;}',
  '.dshn8n-orb:hover{transform:translateY(-2px) scale(1.04);}',
  '.dshn8n-orb .dshn8n-dot{position:absolute;top:6px;right:6px;}',
  '.dshn8n-panel{width:352px;max-width:calc(100vw - 24px);max-height:78vh;display:flex;flex-direction:column;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,.16);background:linear-gradient(160deg,rgba(24,28,44,.72),rgba(14,16,28,.66));backdrop-filter:blur(20px) saturate(160%);-webkit-backdrop-filter:blur(20px) saturate(160%);box-shadow:0 18px 50px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.14);transition:width .18s ease;}',
  '.dshn8n-panel.wide{width:min(920px,92vw);}',
  '.dshn8n-head{display:flex;align-items:center;gap:8px;padding:11px 12px;border-bottom:1px solid rgba(255,255,255,.1);}',
  '.dshn8n-title{font-weight:700;font-size:13px;flex:1;display:flex;align-items:center;gap:7px;}',
  '.dshn8n-dot{width:9px;height:9px;border-radius:50%;background:#8a93a6;box-shadow:0 0 8px currentColor;}',
  '.dshn8n-dot.ok{background:#3ddc84;color:#3ddc84;}',
  '.dshn8n-dot.err{background:#ff5c6c;color:#ff5c6c;}',
  '.dshn8n-dot.wait{background:#ffc247;color:#ffc247;}',
  '.dshn8n-btn{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#e9edf7;border-radius:9px;padding:5px 9px;font-size:12px;cursor:pointer;transition:background .15s;}',
  '.dshn8n-btn:hover{background:rgba(255,255,255,.14);}',
  '.dshn8n-btn:disabled{opacity:.45;cursor:not-allowed;}',
  '.dshn8n-btn.primary{background:linear-gradient(135deg,rgba(96,140,255,.85),rgba(64,96,200,.85));border-color:rgba(140,175,255,.5);}',
  '.dshn8n-btn.on{background:rgba(61,220,132,.18);border-color:rgba(61,220,132,.5);color:#8ef0bb;}',
  '.dshn8n-body{overflow:auto;padding:10px 12px 14px;}',
  '.dshn8n-sec{margin-top:10px;}',
  '.dshn8n-sec h4{margin:0 0 6px;font-size:11px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:#9aa6c4;}',
  '.dshn8n-row{display:flex;align-items:center;gap:6px;margin-bottom:6px;}',
  '.dshn8n-row input{flex:1;min-width:0;border-radius:9px;border:1px solid rgba(255,255,255,.16);background:rgba(10,12,22,.55);color:#e9edf7;padding:6px 9px;font-size:12px;outline:none;}',
  '.dshn8n-row input:focus{border-color:rgba(120,160,255,.7);}',
  '.dshn8n-payload{width:100%;min-height:46px;resize:vertical;border-radius:9px;border:1px solid rgba(255,255,255,.16);background:rgba(10,12,22,.55);color:#e9edf7;padding:6px 9px;font-size:12px;font-family:ui-monospace,Consolas,monospace;outline:none;box-sizing:border-box;}',
  '.dshn8n-item{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:7px 9px;border-radius:11px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.07);margin-bottom:6px;}',
  '.dshn8n-item .nm{flex:1;min-width:0;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.dshn8n-tag{font-size:10.5px;padding:2px 7px;border-radius:999px;border:1px solid rgba(255,255,255,.16);color:#c7d0e6;}',
  '.dshn8n-tag.on{color:#3ddc84;border-color:rgba(61,220,132,.5);}',
  '.dshn8n-tag.off{color:#9aa6c4;}',
  '.dshn8n-st{font-size:10.5px;padding:2px 7px;border-radius:999px;font-weight:600;}',
  '.dshn8n-st.success{background:rgba(61,220,132,.16);color:#3ddc84;}',
  '.dshn8n-st.error,.dshn8n-st.crashed{background:rgba(255,92,108,.16);color:#ff8093;}',
  '.dshn8n-st.running,.dshn8n-st.new,.dshn8n-st.waiting{background:rgba(255,194,71,.16);color:#ffc247;}',
  '.dshn8n-st.canceled,.dshn8n-st.unknown{background:rgba(255,255,255,.1);color:#c7d0e6;}',
  '.dshn8n-empty{font-size:12px;color:#8a93a6;padding:4px 2px;}',
  '.dshn8n-msg{font-size:11.5px;color:#ffc247;margin:2px 0 4px;}',
  '.dshn8n-exmsg{font-size:11.5px;color:#ff8093;margin:2px 0 4px;display:none;}',
  '.dshn8n-time{font-size:10.5px;color:#8a93a6;}',
  '.dshn8n-conninfo{font-size:11px;color:#8a93a6;margin:2px 0 6px;word-break:break-all;}',
  '.dshn8n-editor{display:flex;flex-direction:column;border-bottom:1px solid rgba(255,255,255,.1);}',
  '.dshn8n-editor-bar{display:flex;align-items:center;gap:6px;padding:8px 12px;}',
  '.dshn8n-editor-bar .t{flex:1;font-size:12px;color:#c7d0e6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.dshn8n-frame{width:100%;height:min(56vh,520px);border:0;background:#0b0d16;display:block;}',
  '.dshn8n-embed-notice{padding:20px 16px;font-size:12.5px;color:#c7d0e6;line-height:1.75;}',
  '.dshn8n-embed-text{white-space:pre-line;margin-bottom:12px;}',
  '.dshn8n-hint{font-size:11px;color:#8a93a6;padding:6px 12px;}',
  '.dshn8n-sess-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;}',
  '.dshn8n-sess-goal{flex:1;min-width:0;font-size:12px;color:#c7d0e6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
  '.dshn8n-bar{height:6px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden;margin-bottom:8px;}',
  '.dshn8n-bar>span{display:block;height:100%;width:0;background:linear-gradient(90deg,#608cff,#3ddc84);transition:width .25s ease;}',
  '.dshn8n-step{display:flex;gap:7px;align-items:flex-start;padding:4px 0;font-size:12px;}',
  '.dshn8n-step .ic{flex:0 0 14px;width:14px;text-align:center;}',
  '.dshn8n-step .tx{flex:1;min-width:0;word-break:break-word;}',
  '.dshn8n-step .sub{color:#8a93a6;font-size:10.5px;margin-top:1px;}',
  '.dshn8n-step.done .ic{color:#3ddc84;}',
  '.dshn8n-step.running .ic{color:#ffc247;}',
  '.dshn8n-step.failed .ic{color:#ff8093;}',
  '.dshn8n-step.pending .ic,.dshn8n-step.skipped .ic{color:#8a93a6;}',
  '.dshn8n-step.failed .tx{color:#ff8093;}',
  '.dshn8n-credbox{margin-top:6px;font-size:11.5px;color:#c7d0e6;border-left:2px solid rgba(255,194,71,.6);padding:6px 9px;background:rgba(255,194,71,.07);border-radius:0 7px 7px 0;word-break:break-word;white-space:pre-line;}',
  '.dshn8n-credbox.ok{border-left-color:rgba(61,220,132,.6);background:rgba(61,220,132,.07);}',
].join('\n')

function el(tag, props, children) {
  var node = document.createElement(tag)
  if (props) {
    for (var k in props) {
      if (k === 'class') node.className = props[k]
      else if (k === 'text') node.textContent = props[k]
      else if (k === 'style') node.setAttribute('style', props[k])
      else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2).toLowerCase(), props[k])
      else node.setAttribute(k, props[k])
    }
  }
  ;(children || []).forEach(function (c) {
    if (c) node.appendChild(c)
  })
  return node
}

function fmtTime(iso) {
  if (!iso) return ''
  var d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString()
}

/** 构建并挂载浮窗；返回 destroy。 */
function createHud() {
  var NS = globalThis.__DSH_N8N_HUD__
  if (!NS) return { destroy: function () {} }

  if (!document.getElementById(STYLE_ID)) {
    document.head.appendChild(el('style', { id: STYLE_ID, text: CSS }))
  }

  var cfg = NS.loadConfig()
  var state = {
    collapsed: false,
    loading: false,
    focusLoading: false,
    timer: null,
    frameTimer: null,
    msgTimer: null,
    focusRev: 0,
    configured: null,
    /** 宿主实际连接的完整基址（来自 /health 或 /config），用于拼接编辑器链接。 */
    editorBaseUrl: null,
    /** 当前展示的搭建会话（时间线）。 */
    session: null,
    editor: { open: false, workflowId: null, autoReload: true, lastStamp: '', embeddable: null },
  }

  var statusDot = el('span', { class: 'dshn8n-dot wait' })
  var msgLine = el('div', { class: 'dshn8n-msg', style: 'display:none' })
  var exMsg = el('div', { class: 'dshn8n-exmsg' })
  var connInfo = el('div', { class: 'dshn8n-conninfo', text: '连接：读取中…' })

  var baseInput = el('input', { type: 'text', placeholder: 'http://127.0.0.1:5678', 'aria-label': 'n8n 地址' })
  var keyInput = el('input', { type: 'password', placeholder: 'n8n API Key', 'aria-label': 'n8n API Key' })
  baseInput.value = cfg.baseUrl
  keyInput.value = cfg.apiKey

  var payloadInput = el('textarea', {
    class: 'dshn8n-payload',
    placeholder: '触发 body（JSON），例如 {"name":"world"}',
    'aria-label': '触发 body（JSON）',
  })
  payloadInput.value = '{}'

  var wfList = el('div')
  var exList = el('div')
  var credBox = el('div', { class: 'dshn8n-credbox', style: 'display:none' })

  // ---- 搭建会话时间线 ----
  var sessGoal = el('span', { class: 'dshn8n-sess-goal', text: '' })
  var sessChip = el('span', { class: 'dshn8n-tag', text: '' })
  var sessBar = el('span')
  var sessSteps = el('div')
  var sessPauseBtn = el('button', { class: 'dshn8n-btn', text: '暂停' })
  var sessCancelBtn = el('button', { class: 'dshn8n-btn', text: '终止' })
  var sessionSection = el('div', { class: 'dshn8n-sec', style: 'display:none' }, [
    el('h4', { text: '搭建进度' }),
    el('div', { class: 'dshn8n-sess-head' }, [sessGoal, sessChip]),
    el('div', { class: 'dshn8n-bar' }, [sessBar]),
    sessSteps,
    el('div', { class: 'dshn8n-row' }, [sessPauseBtn, sessCancelBtn]),
  ])

  var saveBtn = el('button', { class: 'dshn8n-btn primary', text: '保存' })
  var refreshBtn = el('button', { class: 'dshn8n-btn', text: '刷新' })
  var collapseBtn = el('button', { class: 'dshn8n-btn', text: '—', title: '收起为玻璃球' })

  // ---- 内嵌编辑器 ----
  var editorTitle = el('span', { class: 't', text: '' })
  var frame = el('iframe', { class: 'dshn8n-frame', src: 'about:blank', title: 'n8n 编辑器' })
  var autoBtn = el('button', { class: 'dshn8n-btn on', text: '自动刷新' })
  var openExternalBtn = el('button', { class: 'dshn8n-btn', text: '在系统浏览器打开' })
  var closeEditorBtn = el('button', { class: 'dshn8n-btn', text: '关闭' })

  // n8n 可能禁止被内嵌（X-Frame-Options / CSP frame-ancestors）→ 用说明替代空白
  var embedText = el('div', { class: 'dshn8n-embed-text', text: '' })
  var embedOpenBtn = el('button', { class: 'dshn8n-btn primary', text: '在系统浏览器打开编辑器' })
  var embedNotice = el('div', { class: 'dshn8n-embed-notice', style: 'display:none' }, [
    embedText,
    el('div', { class: 'dshn8n-row' }, [embedOpenBtn]),
  ])

  var editorSection = el('div', { class: 'dshn8n-editor', style: 'display:none' }, [
    el('div', { class: 'dshn8n-editor-bar' }, [editorTitle, autoBtn, openExternalBtn, closeEditorBtn]),
    frame,
    embedNotice,
    el('div', {
      class: 'dshn8n-hint',
      text: '若 n8n 允许被内嵌，这里会直接显示编辑器并随保存自动刷新；若不允许，会给出说明与外部打开入口。要自己改就先关掉「自动刷新」。',
    }),
  ])

  var panel = el('div', { class: 'dshn8n-panel' }, [
    el('div', { class: 'dshn8n-head' }, [
      el('div', { class: 'dshn8n-title' }, [statusDot, el('span', { text: 'n8n 监控' })]),
      refreshBtn,
      collapseBtn,
    ]),
    editorSection,
    el('div', { class: 'dshn8n-body' }, [
      msgLine,
      el('div', { class: 'dshn8n-sec' }, [
        el('h4', { text: '连接' }),
        connInfo,
        el('div', { class: 'dshn8n-row' }, [baseInput]),
        el('div', { class: 'dshn8n-row' }, [keyInput, saveBtn]),
      ]),
      sessionSection,
      el('div', { class: 'dshn8n-sec' }, [
        el('h4', { text: '触发 body（JSON）' }),
        payloadInput,
      ]),
      el('div', { class: 'dshn8n-sec' }, [el('h4', { text: '工作流' }), credBox, wfList]),
      el('div', { class: 'dshn8n-sec' }, [el('h4', { text: '最近执行' }), exMsg, exList]),
    ]),
  ])

  var orb = el('button', { class: 'dshn8n-orb', text: 'n8n', title: '打开 n8n 监控' })
  orb.appendChild(el('span', { class: 'dshn8n-dot wait' }))
  orb.style.display = 'none'

  var root = el('div', { class: 'dshn8n-root' }, [panel, orb])
  document.body.appendChild(root)

  function editorUrl(id) {
    // 必须用**宿主实际连接**的地址：当连接来自环境变量/插件配置而非浮窗输入框时，
    // 本地存储里的地址可能是另一个实例，用它会把编辑器开到错误的 n8n 上。
    var base = (state.editorBaseUrl || NS.loadConfig().baseUrl || '').replace(/\/+$/, '')
    if (!base) return 'about:blank'
    return id ? base + '/workflow/' + encodeURIComponent(id) : base + '/home/workflows'
  }

  function setCollapsed(v) {
    state.collapsed = v
    panel.style.display = v ? 'none' : 'flex'
    orb.style.display = v ? 'block' : 'none'
  }

  function setStatus(kind) {
    statusDot.className = 'dshn8n-dot ' + kind
    var d = orb.querySelector('.dshn8n-dot')
    if (d) d.className = 'dshn8n-dot ' + kind
  }

  function flash(text) {
    msgLine.textContent = text
    msgLine.style.display = text ? 'block' : 'none'
    if (state.msgTimer) clearTimeout(state.msgTimer)
    if (text) {
      state.msgTimer = setTimeout(function () {
        msgLine.style.display = 'none'
      }, 6000)
    }
  }

  function setBusy(btn, busy) {
    if (btn) btn.disabled = Boolean(busy)
  }

  function loadFrame() {
    if (state.editor.embeddable !== true) return
    var url = editorUrl(state.editor.workflowId)
    editorTitle.textContent = '编辑器 · ' + (state.editor.workflowId || '全部工作流')
    if (state.frameTimer) {
      clearTimeout(state.frameTimer)
      state.frameTimer = null
    }
    frame.setAttribute('src', 'about:blank')
    /* 先置空再赋值，确保重复打开同一 URL 也会真正重新加载 */
    state.frameTimer = setTimeout(function () {
      state.frameTimer = null
      if (!state.editor.open) return
      frame.setAttribute('src', url)
    }, 60)
  }

  /** 根据探测结果决定：显示 iframe，还是显示「无法内嵌」的说明。 */
  function applyEmbeddability(embeddable, reason) {
    state.editor.embeddable = embeddable === true
    frame.style.display = embeddable ? 'block' : 'none'
    embedNotice.style.display = embeddable ? 'none' : 'block'
    autoBtn.disabled = !embeddable
    if (!embeddable) {
      embedText.textContent =
        '无法在浮窗里内嵌 n8n 编辑器。\n\n' +
        (reason || 'n8n 未允许被内嵌。') +
        '\n\n这不影响其他功能：工作流列表、搭建进度时间线、快照/回滚、触发都照常可用。' +
        '点下面的按钮会在系统浏览器里打开这个工作流。'
    }
    if (embeddable) loadFrame()
  }

  /** 询问宿主：n8n 是否允许被内嵌（前端读不到跨域响应头，必须由服务端探测）。 */
  function checkEmbed() {
    frame.style.display = 'none'
    embedNotice.style.display = 'block'
    embedText.textContent = '正在检查 n8n 是否允许被内嵌…'
    editorTitle.textContent = '编辑器 · ' + (state.editor.workflowId || '全部工作流')
    var query = state.editor.workflowId
      ? '?workflowId=' + encodeURIComponent(state.editor.workflowId)
      : ''
    NS.api('/embed-check' + query)
      .then(function (r) {
        if (r && r.ok) applyEmbeddability(r.embeddable === true, r.reason)
        else applyEmbeddability(false, (r && r.error) || '探测失败')
      })
      .catch(function (e) {
        applyEmbeddability(false, '探测失败：' + e.message)
      })
  }

  /**
   * 打开编辑器。
   * - 一定会把浮窗展开（AI 说「打开编辑器」时用户可能刚收起面板）；
   * - workflowId 为 null 表示打开工作流列表；
   * - 同一目标 + 关闭自动刷新时不重载，避免打断手动编辑。
   */
  function openEditor(workflowId, note) {
    var target = workflowId || null
    var sameTarget = state.editor.open && state.editor.workflowId === target
    state.editor.open = true
    state.editor.workflowId = target
    editorSection.style.display = 'flex'
    panel.classList.add('wide')
    setCollapsed(false)
    if (!sameTarget) {
      state.editor.lastStamp = ''
      checkEmbed()
    } else {
      editorTitle.textContent = '编辑器 · ' + (target || '全部工作流')
    }
    if (note) flash(note)
  }

  function closeEditor() {
    state.editor.open = false
    state.editor.workflowId = null
    state.editor.embeddable = null
    editorSection.style.display = 'none'
    panel.classList.remove('wide')
    if (state.frameTimer) {
      clearTimeout(state.frameTimer)
      state.frameTimer = null
    }
    frame.setAttribute('src', 'about:blank')
  }

  function renderConn(info) {
    if (!info || info.configured === false) {
      state.editorBaseUrl = null
      connInfo.textContent = '连接：未配置（填好地址与 API Key 后点「保存」）'
      return
    }
    // 编辑器链接以宿主为准
    state.editorBaseUrl = info.editorBaseUrl || null
    var src = info.source || 'config'
    var label = { runtime: '浮窗设置', config: '插件配置', env: '环境变量', sandbox: '沙箱' }[src] || src
    connInfo.textContent = '连接：' + (info.baseUrl || '') + '（来源：' + label + '）'
  }

  /** 渲染搭建会话时间线（AI 声明的计划 + 每步真实结果）。 */
  function renderSession(session, progress) {
    if (!session) {
      sessionSection.style.display = 'none'
      state.session = null
      return
    }
    state.session = session
    sessionSection.style.display = 'block'

    var statusLabel = {
      planning: '计划中',
      running: '进行中',
      paused: '已暂停',
      completed: '已完成',
      failed: '失败',
      cancelled: '已终止',
    }[session.status] || session.status
    var percent = progress ? progress.percent : 0

    sessGoal.textContent = session.goal || '(未填写目标)'
    sessChip.textContent = statusLabel + ' ' + percent + '%'
    sessChip.className =
      'dshn8n-tag' + (session.status === 'completed' ? ' on' : session.status === 'running' ? '' : ' off')
    sessBar.style.width = percent + '%'

    var icons = { done: '✓', running: '◐', failed: '✕', pending: '○', skipped: '–' }
    sessSteps.textContent = ''
    ;(session.steps || []).forEach(function (step) {
      var sub = []
      if (typeof step.added === 'number') sub.push('+' + step.added + ' 节点')
      if (typeof step.nodeCount === 'number') sub.push('共 ' + step.nodeCount + ' 节点')
      if (step.verified === false) sub.push('读回验证未通过')
      if (step.snapshotId) sub.push('快照 ' + step.snapshotId)
      if (step.error) sub.push(step.error)
      if (step.issues && step.issues.length) sub.push(step.issues[0])
      sessSteps.appendChild(
        el('div', { class: 'dshn8n-step ' + (step.status || 'pending') }, [
          el('span', { class: 'ic', text: icons[step.status] || '○' }),
          el('div', { class: 'tx' }, [
            el('div', { text: step.title || step.id }),
            sub.length ? el('div', { class: 'sub', text: sub.join(' · ') }) : null,
          ]),
        ])
      )
    })

    var live = session.status === 'running' || session.status === 'paused'
    sessPauseBtn.textContent = session.status === 'paused' ? '恢复' : '暂停'
    sessPauseBtn.disabled = !live
    sessCancelBtn.disabled = !live
  }

  /** 渲染凭据体检结果（只展示类型与入口，不涉及任何密钥）。 */
  function renderCredReport(report) {
    if (!report) {
      credBox.style.display = 'none'
      return
    }
    credBox.style.display = 'block'
    credBox.className = 'dshn8n-credbox' + (report.ok ? ' ok' : '')
    var lines = []
    if (report.ok) {
      lines.push('凭据检查通过：需要的 ' + ((report.requirements || []).length) + ' 项都已存在。')
    } else {
      lines.push('缺少 ' + (report.missing || []).length + ' 类凭据：')
      ;(report.missing || []).forEach(function (m) {
        var nodes = m.nodes.slice(0, 3).join('、') + (m.nodes.length > 3 ? ' 等' : '')
        lines.push('· ' + m.credentialType + '（' + nodes + '）→ ' + m.hint)
      })
    }
    if (report.credentialsUrl) lines.push('配置入口：' + report.credentialsUrl)
    if (report.unverified && report.unverified.length) {
      lines.push('无法判断是否需要凭据的节点：' + report.unverified.map(function (u) { return u.node }).join('、'))
    }
    if (report.scopeWarning) lines.push(report.scopeWarning)
    credBox.textContent = lines.join('\n')
  }

  function renderWorkflows(list) {
    wfList.textContent = ''
    if (!list || !list.length) {
      wfList.appendChild(el('div', { class: 'dshn8n-empty', text: '（暂无工作流）' }))
      return
    }
    list.forEach(function (w) {
      var tag = el('span', {
        class: 'dshn8n-tag ' + (w.active ? 'on' : 'off'),
        text: w.active ? '已启用' : '未启用',
      })
      var editBtn = el('button', { class: 'dshn8n-btn', text: '编辑' })
      var toggle = el('button', { class: 'dshn8n-btn', text: w.active ? '停用' : '启用' })
      var snapBtn = el('button', { class: 'dshn8n-btn', text: '快照' })
      var restoreBtn = el('button', { class: 'dshn8n-btn', text: '回滚' })
      var credBtn = el('button', { class: 'dshn8n-btn', text: '凭据' })

      var row = el('div', { class: 'dshn8n-item' }, [
        el('span', { class: 'nm', text: w.name || w.id }),
        tag,
        editBtn,
        toggle,
        snapBtn,
        restoreBtn,
        credBtn,
      ])

      credBtn.onclick = function () {
        setBusy(credBtn, true)
        flash('检查凭据中…')
        NS.api('/workflows/' + encodeURIComponent(w.id) + '/credentials')
          .then(function (r) {
            setBusy(credBtn, false)
            if (r && typeof r.ok === 'boolean') {
              renderCredReport(r)
              flash(r.ok ? '凭据齐全' : '缺少 ' + (r.missing || []).length + ' 类凭据（见下方）')
            } else {
              flash('检查失败：' + ((r && r.error) || '未知错误'))
            }
          })
          .catch(function (e) {
            setBusy(credBtn, false)
            flash('检查失败：' + e.message)
          })
      }

      editBtn.onclick = function () {
        openEditor(w.id, '已打开编辑器')
      }

      toggle.onclick = function () {
        var act = w.active ? 'deactivate' : 'activate'
        setBusy(toggle, true)
        flash(act === 'activate' ? '启用中…' : '停用中…')
        NS.api('/workflows/' + encodeURIComponent(w.id) + '/' + act, { method: 'POST' })
          .then(function (r) {
            setBusy(toggle, false)
            if (r && r.ok) flash(act === 'activate' ? '已启用' : '已停用')
            else flash('操作失败：' + ((r && r.error) || '未知错误'))
            refresh()
          })
          .catch(function (e) {
            setBusy(toggle, false)
            flash('操作失败：' + e.message)
          })
      }

      snapBtn.onclick = function () {
        setBusy(snapBtn, true)
        NS.api('/workflows/' + encodeURIComponent(w.id) + '/snapshots', { method: 'POST' })
          .then(function (r) {
            setBusy(snapBtn, false)
            if (r && r.ok) flash('已记录快照 ' + r.snapshotId)
            else flash('快照失败：' + ((r && r.error) || '未知错误'))
          })
          .catch(function (e) {
            setBusy(snapBtn, false)
            flash('快照失败：' + e.message)
          })
      }

      restoreBtn.onclick = function () {
        setBusy(restoreBtn, true)
        flash('回滚中…')
        NS.api('/workflows/' + encodeURIComponent(w.id) + '/restore', { method: 'POST', body: {} })
          .then(function (r) {
            setBusy(restoreBtn, false)
            if (r && r.ok) flash('已回滚到快照 ' + r.restoredFrom)
            else flash('回滚失败：' + ((r && r.error) || '未知错误'))
            refresh()
          })
          .catch(function (e) {
            setBusy(restoreBtn, false)
            flash('回滚失败：' + e.message)
          })
      }

      ;(w.webhooks || []).forEach(function (wh) {
        var path = wh && wh.path
        if (!path) return
        var triggerBtn = el('button', { class: 'dshn8n-btn primary', text: '触发' })
        triggerBtn.onclick = function () {
          if (!w.active) {
            flash('该工作流未激活：生产 Webhook 只在激活后存在，请先点「启用」')
            return
          }
          var payload
          try {
            payload = JSON.parse(payloadInput.value || '{}')
          } catch (e) {
            flash('触发 body 不是合法 JSON')
            return
          }
          setBusy(triggerBtn, true)
          flash('触发中…')
          NS.api('/trigger', {
            method: 'POST',
            body: { webhookPath: path, payload: payload, method: (wh && wh.method) || 'POST' },
          })
            .then(function (r) {
              setBusy(triggerBtn, false)
              if (r && r.ok) {
                var inner = r.result && r.result.result
                var execId = (inner && inner.executionId) || (r.result && r.result.executionId)
                flash(
                  '已触发 ' +
                    path +
                    (execId ? '（执行 #' + execId + '）' : '（已接收；该 Webhook 未返回执行 ID）')
                )
              } else {
                flash('触发失败：' + ((r && r.error) || '未知错误'))
              }
              refresh()
            })
            .catch(function (e) {
              setBusy(triggerBtn, false)
              flash('触发失败：' + e.message)
            })
        }
        row.appendChild(triggerBtn)
      })

      wfList.appendChild(row)
    })
  }

  function renderExecutions(list) {
    exList.textContent = ''
    if (!list || !list.length) {
      exList.appendChild(el('div', { class: 'dshn8n-empty', text: '（暂无执行）' }))
      return
    }
    list.forEach(function (e) {
      exList.appendChild(
        el('div', { class: 'dshn8n-item' }, [
          el('span', { class: 'nm', text: '#' + e.id }),
          el('span', { class: 'dshn8n-st ' + (e.status || 'unknown'), text: e.status || 'unknown' }),
          el('span', { class: 'dshn8n-time', text: fmtTime(e.startedAt) }),
        ])
      )
    })
  }

  /** 拉取 AI 的"聚焦"指令：有新 rev 就自动打开对应工作流的编辑器。 */
  function pollFocus() {
    if (state.focusLoading) return
    state.focusLoading = true
    NS.api('/focus')
      .then(function (r) {
        if (!r || !r.ok) return
        if (typeof r.rev === 'number' && r.rev > state.focusRev) {
          state.focusRev = r.rev
          openEditor(r.workflowId || null, r.note || 'AI 正在搭建，编辑器已自动打开')
        }
      })
      .catch(function () {
        /* 聚焦是锦上添花，失败静默 */
      })
      .then(function () {
        state.focusLoading = false
      })
  }

  /** 编辑器打开时：目标工作流一变（AI 保存了新节点）就自动刷新 iframe。 */
  function autoReloadIfChanged(list) {
    if (!state.editor.open || !state.editor.autoReload || state.editor.embeddable !== true) return
    var id = state.editor.workflowId
    if (!id) return
    var cur = null
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === id) {
        cur = list[i]
        break
      }
    }
    if (!cur) return
    var stamp = String(cur.updatedAt || '') + ':' + String(cur.nodeCount || '')
    if (state.editor.lastStamp && state.editor.lastStamp !== stamp) loadFrame()
    state.editor.lastStamp = stamp
  }

  function refresh() {
    if (state.loading) return
    state.loading = true
    setStatus('wait')
    NS.api('/health')
      .then(function (h) {
        renderConn(h)
        state.configured = Boolean(h && h.ok === true && h.configured !== false)
        if (!state.configured) {
          setStatus('wait')
          flash('尚未连接 n8n：填好地址与 API Key 后点「保存」')
          wfList.textContent = ''
          exList.textContent = ''
          return null
        }
        return Promise.all([NS.api('/workflows'), NS.api('/executions?limit=8')])
      })
      .then(function (r) {
        if (!r) return
        var wf = r[0]
        var ex = r[1]
        if (wf && wf.ok) {
          setStatus('ok')
          renderWorkflows(wf.data)
          autoReloadIfChanged(wf.data || [])
        } else {
          setStatus('err')
          flash((wf && wf.error) || 'n8n 连接失败')
        }
        if (ex && ex.ok) {
          exMsg.style.display = 'none'
          renderExecutions(ex.data)
        } else {
          exMsg.textContent = '执行列表获取失败：' + ((ex && ex.error) || '未知错误')
          exMsg.style.display = 'block'
        }
        // 搭建会话时间线：优先看编辑器当前打开的工作流，否则看最近一次会话
        var sessionWf = state.editor.open ? state.editor.workflowId : null
        return NS.api('/session' + (sessionWf ? '?workflowId=' + encodeURIComponent(sessionWf) : ''))
          .then(function (sr) {
            if (sr && sr.ok) renderSession(sr.session, sr.progress)
          })
          .catch(function () {
            /* 时间线是锦上添花，失败静默 */
          })
      })
      .catch(function (e) {
        setStatus('err')
        flash('请求失败：' + e.message)
      })
      .then(function () {
        state.loading = false
      })
  }

  // ---- 事件绑定 ----

  saveBtn.onclick = function () {
    var next = {
      baseUrl: baseInput.value.trim() || NS.DEFAULT_BASE_URL,
      apiKey: keyInput.value.trim(),
    }
    if (!next.apiKey) {
      flash('请填写 n8n API Key')
      return
    }
    setBusy(saveBtn, true)
    var localSaved = NS.saveConfig(next)
    NS.pushConfig(next)
      .then(function (r) {
        setBusy(saveBtn, false)
        if (r && r.ok) {
          flash(localSaved ? '已保存并生效' : '已保存到宿主（浏览器本地存储不可用，下次需重填）')
          renderConn(r)
        } else {
          flash('保存失败：' + ((r && r.error) || '未知错误'))
        }
        refresh()
      })
      .catch(function (e) {
        setBusy(saveBtn, false)
        flash('保存失败：' + e.message)
      })
  }

  refreshBtn.onclick = function () {
    refresh()
  }

  collapseBtn.onclick = function () {
    setCollapsed(true)
  }

  orb.onclick = function () {
    setCollapsed(false)
  }

  autoBtn.onclick = function () {
    if (state.editor.embeddable !== true) return
    state.editor.autoReload = !state.editor.autoReload
    autoBtn.className = 'dshn8n-btn' + (state.editor.autoReload ? ' on' : '')
    autoBtn.textContent = state.editor.autoReload ? '自动刷新' : '自动刷新已关'
    flash(state.editor.autoReload ? '已开启自动刷新' : '已关闭自动刷新（自己改时更安全）')
  }

  function openInBrowser() {
    /* 桌面端主窗口会把这个 http 链接转交系统浏览器打开 */
    globalThis.open(editorUrl(state.editor.workflowId), '_blank')
  }

  openExternalBtn.onclick = openInBrowser
  embedOpenBtn.onclick = openInBrowser

  closeEditorBtn.onclick = function () {
    closeEditor()
  }

  /** 暂停 / 恢复 / 终止搭建会话（暂停期间写操作会被宿主拦下）。 */
  function setSessionState(next, btn) {
    var session = state.session
    if (!session) return
    setBusy(btn, true)
    NS.api('/session/state', { method: 'POST', body: { sessionId: session.id, state: next } })
      .then(function (r) {
        setBusy(btn, false)
        if (r && r.ok) {
          flash(
            next === 'paused'
              ? '已暂停：后续写入会被拦下'
              : next === 'running'
                ? '已恢复'
                : '已终止'
          )
          renderSession(r.session, r.progress)
        } else {
          flash('操作失败：' + ((r && r.error) || '未知错误'))
        }
      })
      .catch(function (e) {
        setBusy(btn, false)
        flash('操作失败：' + e.message)
      })
  }

  sessPauseBtn.onclick = function () {
    setSessionState(state.session && state.session.status === 'paused' ? 'running' : 'paused', sessPauseBtn)
  }

  sessCancelBtn.onclick = function () {
    setSessionState('cancelled', sessCancelBtn)
  }

  // ---- 启动 ----

  setCollapsed(false)
  if (cfg.apiKey) {
    // 本地有配置：交给宿主，让 AI 工具与浮窗指向同一实例
    NS.pushConfig(cfg)
      .then(function (r) {
        if (r && r.ok) renderConn(r)
        refresh()
      })
      .catch(function () {
        refresh()
      })
  } else {
    refresh()
  }
  pollFocus()
  state.timer = setInterval(function () {
    refresh()
    pollFocus()
  }, POLL_MS)

  return {
    destroy: function () {
      if (state.timer) clearInterval(state.timer)
      if (state.frameTimer) clearTimeout(state.frameTimer)
      if (state.msgTimer) clearTimeout(state.msgTimer)
      state.editor.open = false
      root.remove()
      var style = document.getElementById(STYLE_ID)
      if (style) style.remove()
    },
  }
}

/**
 * 挂载玻璃浮窗（折叠成玻璃球）。
 * @param {object} ctx - 浏览器端 cordis 上下文。
 */
function apply(ctx) {
  try {
    ctx.effect(function () {
      var hud = createHud()
      return function () {
        hud.destroy()
      }
    }, 'dsh-n8n-lg: glass HUD')
    ctx.logger && ctx.logger.info && ctx.logger.info('[dsh-n8n-lg] 玻璃 HUD 已挂载')
  } catch (error) {
    /* HUD 出问题不该影响用户的工作 */
    ctx.logger && ctx.logger.error && ctx.logger.error('[dsh-n8n-lg] HUD 挂载失败:', error)
  }
}
