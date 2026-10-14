/*
 * dsh-n8n-lg · HUD 视图层（浏览器端）
 *
 * 由 build-client.mjs 拼进 lib/client.js 的 `factory(require)` 体内，因此这里
 * 顶层的 inject / name / apply 就是 bundle 导出的三个符号。
 *
 * 设计要点：
 *  - `inject = []`：不依赖宿主服务、不占布局槽，浮窗挂在 document.body 上自管几何。
 *  - 零依赖、不 import 任何 @deepseek-ai/*，纯 DOM + 原生 fetch。
 *  - 内嵌编辑器：n8n 未设 X-Frame-Options，故用 <iframe> 直接嵌（桌面端 webviewTag=false，
 *    且 window.open 会被桌面端转交系统浏览器打开）。
 *  - 生命周期交给 ctx.effect：卸载 / HMR 时自动销毁窗口与定时器。
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
  '.dshn8n-panel{width:352px;max-height:78vh;display:flex;flex-direction:column;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,.16);background:linear-gradient(160deg,rgba(24,28,44,.72),rgba(14,16,28,.66));backdrop-filter:blur(20px) saturate(160%);-webkit-backdrop-filter:blur(20px) saturate(160%);box-shadow:0 18px 50px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.14);transition:width .18s ease;}',
  '.dshn8n-panel.wide{width:min(920px,92vw);}',
  '.dshn8n-head{display:flex;align-items:center;gap:8px;padding:11px 12px;border-bottom:1px solid rgba(255,255,255,.1);}',
  '.dshn8n-title{font-weight:700;font-size:13px;flex:1;display:flex;align-items:center;gap:7px;}',
  '.dshn8n-dot{width:9px;height:9px;border-radius:50%;background:#8a93a6;box-shadow:0 0 8px currentColor;}',
  '.dshn8n-dot.ok{background:#3ddc84;color:#3ddc84;}',
  '.dshn8n-dot.err{background:#ff5c6c;color:#ff5c6c;}',
  '.dshn8n-dot.wait{background:#ffc247;color:#ffc247;}',
  '.dshn8n-btn{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#e9edf7;border-radius:9px;padding:5px 9px;font-size:12px;cursor:pointer;transition:background .15s;}',
  '.dshn8n-btn:hover{background:rgba(255,255,255,.14);}',
  '.dshn8n-btn.primary{background:linear-gradient(135deg,rgba(96,140,255,.85),rgba(64,96,200,.85));border-color:rgba(140,175,255,.5);}',
  '.dshn8n-btn.on{background:rgba(61,220,132,.18);border-color:rgba(61,220,132,.5);color:#8ef0bb;}',
  '.dshn8n-body{overflow:auto;padding:10px 12px 14px;}',
  '.dshn8n-sec{margin-top:10px;}',
  '.dshn8n-sec h4{margin:0 0 6px;font-size:11px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:#9aa6c4;}',
  '.dshn8n-row{display:flex;align-items:center;gap:6px;margin-bottom:6px;}',
  '.dshn8n-row input{flex:1;min-width:0;border-radius:9px;border:1px solid rgba(255,255,255,.16);background:rgba(10,12,22,.55);color:#e9edf7;padding:6px 9px;font-size:12px;outline:none;}',
  '.dshn8n-row input:focus{border-color:rgba(120,160,255,.7);}',
  '.dshn8n-item{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:11px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.07);margin-bottom:6px;}',
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
  '.dshn8n-time{font-size:10.5px;color:#8a93a6;}',
  '.dshn8n-editor{display:flex;flex-direction:column;border-bottom:1px solid rgba(255,255,255,.1);}',
  '.dshn8n-editor-bar{display:flex;align-items:center;gap:6px;padding:8px 12px;}',
  '.dshn8n-editor-bar .t{flex:1;font-size:12px;color:#c7d0e6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.dshn8n-frame{width:100%;height:min(56vh,520px);border:0;background:#0b0d16;display:block;}',
  '.dshn8n-hint{font-size:11px;color:#8a93a6;padding:6px 12px;}',
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
    timer: null,
    focusRev: 0,
    editor: { open: false, workflowId: null, autoReload: true, lastStamp: '' },
  }

  var statusDot = el('span', { class: 'dshn8n-dot wait' })
  var msgLine = el('div', { class: 'dshn8n-msg', style: 'display:none' })

  var baseInput = el('input', { type: 'text', placeholder: 'http://127.0.0.1:5678' })
  var keyInput = el('input', { type: 'password', placeholder: 'n8n API Key' })
  baseInput.value = cfg.baseUrl
  keyInput.value = cfg.apiKey

  var wfList = el('div')
  var exList = el('div')

  var saveBtn = el('button', {
    class: 'dshn8n-btn primary',
    text: '保存',
    onclick: function () {
      NS.saveConfig({ baseUrl: baseInput.value.trim(), apiKey: keyInput.value.trim() })
      flash('已保存')
      refresh()
    },
  })

  var refreshBtn = el('button', { class: 'dshn8n-btn', text: '刷新', onclick: function () { refresh() } })
  var collapseBtn = el('button', { class: 'dshn8n-btn', text: '—', onclick: function () { setCollapsed(true) } })

  // ---- 内嵌编辑器 ----
  var editorTitle = el('span', { class: 't', text: '' })
  var frame = el('iframe', { class: 'dshn8n-frame', src: 'about:blank' })
  var autoBtn = el('button', {
    class: 'dshn8n-btn on',
    text: '自动刷新',
    onclick: function () {
      state.editor.autoReload = !state.editor.autoReload
      autoBtn.className = 'dshn8n-btn' + (state.editor.autoReload ? ' on' : '')
    },
  })
  var openExternalBtn = el('button', {
    class: 'dshn8n-btn',
    text: '在系统浏览器打开',
    onclick: function () {
      /* 桌面端主窗口会把这个 http 链接转交系统浏览器打开 */
      globalThis.open(editorUrl(state.editor.workflowId), '_blank')
    },
  })
  var closeEditorBtn = el('button', { class: 'dshn8n-btn', text: '关闭', onclick: function () { closeEditor() } })
  var editorSection = el('div', { class: 'dshn8n-editor', style: 'display:none' }, [
    el('div', { class: 'dshn8n-editor-bar' }, [editorTitle, autoBtn, openExternalBtn, closeEditorBtn]),
    frame,
    el('div', {
      class: 'dshn8n-hint',
      text: '编辑器直接嵌入 n8n 页面；AI 每保存一次会自动刷新，方便你看它一步步长出来。',
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
        el('div', { class: 'dshn8n-row' }, [baseInput]),
        el('div', { class: 'dshn8n-row' }, [keyInput, saveBtn]),
      ]),
      el('div', { class: 'dshn8n-sec' }, [el('h4', { text: '工作流' }), wfList]),
      el('div', { class: 'dshn8n-sec' }, [el('h4', { text: '最近执行' }), exList]),
    ]),
  ])

  var orb = el('button', { class: 'dshn8n-orb', text: 'n8n', onclick: function () { setCollapsed(false) } })
  orb.appendChild(el('span', { class: 'dshn8n-dot wait' }))
  orb.style.display = 'none'

  var root = el('div', { class: 'dshn8n-root' }, [panel, orb])
  document.body.appendChild(root)

  function editorUrl(id) {
    var base = (NS.loadConfig().baseUrl || '').replace(/\/+$/, '')
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
    if (text) setTimeout(function () { msgLine.style.display = 'none' }, 3200)
  }

  function loadFrame() {
    var url = editorUrl(state.editor.workflowId)
    editorTitle.textContent = '编辑器 · ' + (state.editor.workflowId || '全部工作流')
    /* 先置空再赋值，确保重复打开同一 URL 也会真正重新加载 */
    frame.setAttribute('src', 'about:blank')
    setTimeout(function () { frame.setAttribute('src', url) }, 60)
  }

  function openEditor(workflowId, note) {
    state.editor.open = true
    state.editor.workflowId = workflowId || null
    state.editor.lastStamp = ''
    editorSection.style.display = 'flex'
    panel.classList.add('wide')
    loadFrame()
    if (note) flash(note)
  }

  function closeEditor() {
    state.editor.open = false
    state.editor.workflowId = null
    editorSection.style.display = 'none'
    panel.classList.remove('wide')
    frame.setAttribute('src', 'about:blank')
  }

  function renderWorkflows(list) {
    wfList.textContent = ''
    if (!list || !list.length) {
      wfList.appendChild(el('div', { class: 'dshn8n-empty', text: '（暂无工作流）' }))
      return
    }
    list.forEach(function (w) {
      var tag = el('span', { class: 'dshn8n-tag ' + (w.active ? 'on' : 'off'), text: w.active ? '已启用' : '未启用' })
      var editBtn = el('button', {
        class: 'dshn8n-btn',
        text: '编辑',
        onclick: function () { openEditor(w.id, '已打开编辑器') },
      })
      var toggle = el('button', {
        class: 'dshn8n-btn',
        text: w.active ? '停用' : '启用',
        onclick: function () {
          var act = w.active ? 'deactivate' : 'activate'
          flash(act === 'activate' ? '启用中…' : '停用中…')
          NS.api('/workflows/' + encodeURIComponent(w.id) + '/' + act, { method: 'POST' })
            .then(function (r) {
              if (r && r.ok) flash(act === 'activate' ? '已启用' : '已停用')
              else flash('操作失败：' + ((r && r.error) || '未知错误'))
              refresh()
            })
            .catch(function (e) { flash('操作失败：' + e.message) })
        },
      })
      var row = el('div', { class: 'dshn8n-item' }, [
        el('span', { class: 'nm', text: w.name || w.id }),
        tag,
        editBtn,
        toggle,
      ])
      ;(w.webhookPaths || []).forEach(function (p) {
        row.appendChild(
          el('button', {
            class: 'dshn8n-btn primary',
            text: '触发',
            onclick: function () {
              if (!w.active) {
                flash('该工作流未激活：生产 Webhook 只在激活后存在，请先点「启用」')
                return
              }
              flash('触发中…')
              NS.api('/trigger', { method: 'POST', body: { webhookPath: p, payload: {} } })
                .then(function (r) {
                  if (r && r.ok) {
                    var res = r.result
                    var execId = res && typeof res === 'object' ? res.executionId : undefined
                    flash('已触发 ' + p + (execId ? '（执行 #' + execId + '）' : ''))
                  } else {
                    flash('触发失败：' + ((r && r.error) || '未知错误'))
                  }
                  refresh()
                })
                .catch(function (e) { flash('触发失败：' + e.message) })
            },
          })
        )
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
    NS.api('/focus')
      .then(function (r) {
        if (!r || !r.ok) return
        if (typeof r.rev === 'number' && r.rev !== state.focusRev) {
          state.focusRev = r.rev
          if (r.workflowId) openEditor(r.workflowId, r.note || 'AI 正在搭建，编辑器已自动打开')
        }
      })
      .catch(function () {})
  }

  function refresh() {
    if (state.loading) return
    state.loading = true
    setStatus('wait')
    NS.api('/health')
      .then(function () {
        return Promise.all([NS.api('/workflows'), NS.api('/executions?limit=8')])
      })
      .then(function (r) {
        var wf = r[0]
        var ex = r[1]
        if (wf && wf.ok === false && wf.configured === false) {
          setStatus('wait')
          flash(wf.error || '请先填写 n8n 地址与 API Key')
          wfList.textContent = ''
          exList.textContent = ''
          return
        }
        if (wf && wf.ok) {
          setStatus('ok')
          renderWorkflows(wf.data)
          // 编辑器打开时：目标工作流一变（AI 保存了新节点）就自动刷新 iframe
          if (state.editor.open && state.editor.autoReload) {
            var cur = (wf.data || []).filter(function (w) { return w.id === state.editor.workflowId })[0]
            if (cur) {
              var stamp = String(cur.updatedAt || '') + ':' + String(cur.nodeCount || '')
              if (state.editor.lastStamp && state.editor.lastStamp !== stamp) loadFrame()
              state.editor.lastStamp = stamp
            }
          }
        } else {
          setStatus('err')
          flash((wf && wf.error) || 'n8n 连接失败')
        }
        if (ex && ex.ok) renderExecutions(ex.data)
      })
      .catch(function (e) {
        setStatus('err')
        flash('请求失败：' + e.message)
      })
      .then(function () {
        state.loading = false
      })
  }

  refresh()
  pollFocus()
  state.timer = setInterval(function () {
    refresh()
    pollFocus()
  }, POLL_MS)

  return {
    destroy: function () {
      if (state.timer) clearInterval(state.timer)
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
      return function () { hud.destroy() }
    }, 'dsh-n8n-lg: glass HUD')
    ctx.logger && ctx.logger.info && ctx.logger.info('[dsh-n8n-lg] 玻璃 HUD 已挂载')
  } catch (error) {
    /* HUD 出问题不该影响用户的工作 */
    ctx.logger && ctx.logger.error && ctx.logger.error('[dsh-n8n-lg] HUD 挂载失败:', error)
  }
}
