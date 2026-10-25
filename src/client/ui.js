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

/**
 * 主题变量。挂在 `.dshn8n-root`（浮窗）和 `.dshn8n-menu`（菜单挂 body，不在 root 内）上，
 * 切换主题 = 给这两个元素加 `.dshn8n-light`。
 *
 * 为什么要抽变量：两套主题如果各写一份 CSS，体积直接翻倍；抽成变量后规则只写一次。
 */
var THEME_DARK = [
  '--n8n-fg:#e9edf7',
  '--n8n-fg-soft:#c7d0e6',
  '--n8n-fg-dim:#9aa6c4',
  '--n8n-fg-faint:#8a93a6',
  '--n8n-border:rgba(255,255,255,.12)',
  '--n8n-border-soft:rgba(255,255,255,.07)',
  '--n8n-border-strong:rgba(255,255,255,.16)',
  '--n8n-item-bg:rgba(255,255,255,.045)',
  '--n8n-input-bg:rgba(10,12,22,.55)',
  '--n8n-panel-bg:linear-gradient(160deg,rgba(24,28,44,.72),rgba(14,16,28,.66))',
  '--n8n-panel-shadow:0 18px 50px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.14)',
  '--n8n-orb-bg:radial-gradient(120% 120% at 30% 20%,rgba(120,160,255,.45),rgba(30,40,70,.55))',
  '--n8n-orb-fg:#eaf0ff',
  '--n8n-orb-shadow:0 8px 30px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.25)',
  '--n8n-canvas-bg:rgba(10,12,20,.55)',
  '--n8n-node-fill:rgba(38,46,70,.95)',
  '--n8n-node-fill-off:rgba(38,46,70,.45)',
  '--n8n-node-stroke:rgba(120,150,220,.45)',
  '--n8n-node-text:#e8eeff',
  '--n8n-node-kind:#8f9cba',
  '--n8n-edge:rgba(150,170,220,.55)',
  '--n8n-edge-alt:rgba(255,194,71,.6)',
  '--n8n-accent:#608cff',
  '--n8n-accent-2:#3ddc84',
  '--n8n-ok:#3ddc84',
  '--n8n-err:#ff5c6c',
  '--n8n-err-soft:#ff8093',
  '--n8n-warn:#ffc247',
  '--n8n-btn-bg:rgba(255,255,255,.06)',
  '--n8n-btn-bg-hover:rgba(255,255,255,.14)',
  '--n8n-btn-border:rgba(255,255,255,.18)',
  '--n8n-menu-bg:rgba(26,32,48,.985)',
  '--n8n-menu-border:rgba(120,150,220,.35)',
  '--n8n-menu-hover:rgba(90,130,220,.3)',
  '--n8n-frame-bg:#0b0d16',
  '--n8n-bar-bg:rgba(255,255,255,.12)',
  '--n8n-cred-warn-bg:rgba(255,194,71,.07)',
  '--n8n-cred-ok-bg:rgba(61,220,132,.07)',
  '--n8n-menu-shadow:0 10px 28px rgba(0,0,0,.5)',
  '--n8n-scroll-thumb:rgba(255,255,255,.16)',
  '--n8n-scroll-thumb-hover:rgba(255,255,255,.3)',
  '--n8n-focus-ring:rgba(96,140,255,.3)',
  '--n8n-selection:rgba(96,140,255,.34)'
].join(';')

var THEME_LIGHT = [
  '--n8n-fg:#332d26',
  '--n8n-fg-soft:#5f564c',
  '--n8n-fg-dim:#7a7064',
  '--n8n-fg-faint:#857b6e',
  '--n8n-border:rgba(140,118,92,.2)',
  '--n8n-border-soft:rgba(140,118,92,.13)',
  '--n8n-border-strong:rgba(140,118,92,.28)',
  '--n8n-item-bg:rgba(255,255,255,.75)',
  '--n8n-input-bg:rgba(255,255,255,.92)',
  '--n8n-panel-bg:linear-gradient(160deg,rgba(255,253,248,.95),rgba(249,244,236,.93))',
  '--n8n-panel-shadow:0 18px 46px rgba(122,96,62,.16),inset 0 1px 0 rgba(255,255,255,.95)',
  '--n8n-orb-bg:radial-gradient(120% 120% at 30% 20%,rgba(255,244,228,.98),rgba(236,222,202,.9))',
  '--n8n-orb-fg:#6b5842',
  '--n8n-orb-shadow:0 8px 24px rgba(122,96,62,.2),inset 0 1px 0 rgba(255,255,255,.9)',
  '--n8n-canvas-bg:rgba(252,248,241,.92)',
  '--n8n-node-fill:#ffffff',
  '--n8n-node-fill-off:rgba(255,255,255,.6)',
  '--n8n-node-stroke:rgba(196,166,126,.6)',
  '--n8n-node-text:#3b342c',
  '--n8n-node-kind:#a2937f',
  '--n8n-edge:rgba(184,152,114,.7)',
  '--n8n-edge-alt:rgba(206,142,54,.72)',
  '--n8n-accent:#c4873c',
  '--n8n-accent-2:#6f9750',
  '--n8n-ok:#5a9e5f',
  '--n8n-err:#c4554a',
  '--n8n-err-soft:#b0534a',
  '--n8n-warn:#c07f2a',
  '--n8n-btn-bg:rgba(255,255,255,.8)',
  '--n8n-btn-bg-hover:rgba(246,240,231,1)',
  '--n8n-btn-border:rgba(140,118,92,.3)',
  '--n8n-menu-bg:rgba(255,253,249,.99)',
  '--n8n-menu-border:rgba(160,136,106,.38)',
  '--n8n-menu-hover:rgba(196,135,60,.14)',
  '--n8n-frame-bg:#faf6ef',
  '--n8n-bar-bg:rgba(140,118,92,.2)',
  '--n8n-cred-warn-bg:rgba(192,127,42,.1)',
  '--n8n-cred-ok-bg:rgba(90,158,95,.1)',
  '--n8n-menu-shadow:0 12px 30px rgba(122,96,62,.2)',
  '--n8n-scroll-thumb:rgba(140,118,92,.24)',
  '--n8n-scroll-thumb-hover:rgba(140,118,92,.42)',
  '--n8n-focus-ring:rgba(196,135,60,.26)',
  '--n8n-selection:rgba(196,135,60,.26)'
].join(';')

var CSS = [
  '.dshn8n-root,.dshn8n-menu{' + THEME_DARK + '}',
  '.dshn8n-root.dshn8n-light,.dshn8n-menu.dshn8n-light{' + THEME_LIGHT + '}',
  // 动画统一用这几个曲线：进入用回弹感、退出用平顺收尾
  '@keyframes dshn8n-pop{from{opacity:0;transform:scale(.96) translateY(-3px);}to{opacity:1;transform:none;}}',
  '@keyframes dshn8n-pulse{0%,100%{opacity:1;}50%{opacity:.45;}}',
  // 动效偏好：系统开了「减少动态效果」就全关掉，别跟用户较劲
  '@media (prefers-reduced-motion:reduce){.dshn8n-root *,.dshn8n-menu *{animation:none !important;transition:none !important;}}',
  '.dshn8n-root{position:fixed;right:18px;bottom:18px;z-index:2147483000;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--n8n-fg);}',
  '.dshn8n-orb{width:54px;height:54px;border-radius:50%;border:1px solid var(--n8n-border-strong);cursor:grab;color:var(--n8n-orb-fg);font-weight:700;font-size:13px;letter-spacing:.5px;background:var(--n8n-orb-bg);backdrop-filter:blur(14px) saturate(150%);-webkit-backdrop-filter:blur(14px) saturate(150%);box-shadow:var(--n8n-orb-shadow);transition:transform .15s ease,opacity .16s ease;}',
  '.dshn8n-orb:hover{transform:translateY(-2px) scale(1.04);}',
  '.dshn8n-orb:active{transform:scale(.96);}',
  '.dshn8n-orb .dshn8n-dot{position:absolute;top:6px;right:6px;}',
  '.dshn8n-orb.dshn8n-hidden{position:absolute;right:0;bottom:0;opacity:0;transform:scale(.75);pointer-events:none;}',
  // 展开/收起用 opacity + scale，而不是 display：display 切换没有过渡
  '.dshn8n-panel{width:352px;max-width:calc(100vw - 24px);max-height:78vh;display:flex;flex-direction:column;border-radius:16px;overflow:hidden;border:1px solid var(--n8n-border-strong);background:var(--n8n-panel-bg);backdrop-filter:blur(20px) saturate(160%);-webkit-backdrop-filter:blur(20px) saturate(160%);box-shadow:var(--n8n-panel-shadow);transform-origin:0 0;transition:width .2s ease,opacity .18s ease,transform .18s cubic-bezier(.2,.9,.3,1);}',
  '.dshn8n-panel.dshn8n-hidden{position:absolute;right:0;bottom:0;opacity:0;transform:scale(.95) translateY(8px);pointer-events:none;}',
  '.dshn8n-panel.wide{width:min(920px,92vw);}',
  '.dshn8n-head{display:flex;align-items:center;gap:8px;padding:11px 12px;border-bottom:1px solid var(--n8n-border);cursor:move;user-select:none;}',
  '.dshn8n-title{font-weight:700;font-size:13px;flex:1;display:flex;align-items:center;gap:8px;}',
  '.dshn8n-dot{width:9px;height:9px;border-radius:50%;background:var(--n8n-fg-faint);box-shadow:0 0 8px currentColor;}',
  '.dshn8n-dot.ok{background:var(--n8n-ok);color:var(--n8n-ok);}',
  '.dshn8n-dot.err{background:var(--n8n-err);color:var(--n8n-err);}',
  '.dshn8n-dot.wait{background:var(--n8n-warn);color:var(--n8n-warn);animation:dshn8n-pulse 1.8s ease-in-out infinite;}',
  '.dshn8n-btn{border:1px solid var(--n8n-btn-border);background:var(--n8n-btn-bg);color:var(--n8n-fg);border-radius:8px;padding:5px 9px;font-size:12px;cursor:pointer;transition:background .15s ease,border-color .15s ease,color .15s ease,transform .1s ease;}',
  '.dshn8n-btn:hover{background:var(--n8n-btn-bg-hover);}',
  '.dshn8n-btn:active:not(:disabled){transform:scale(.97);}',
  '.dshn8n-btn:disabled{opacity:.45;cursor:not-allowed;}',
  // color-mix 需要 Chrome 111+；先用纯色兜底，不支持的宿主也不会变成「没背景的按钮」
  '.dshn8n-btn.primary{background:var(--n8n-accent);background:linear-gradient(135deg,var(--n8n-accent),color-mix(in srgb,var(--n8n-accent) 78%,#000));border-color:var(--n8n-accent);color:#fff;}',
  '.dshn8n-btn.on{background:var(--n8n-cred-ok-bg);border-color:var(--n8n-ok);color:var(--n8n-ok);}',
  '.dshn8n-body{overflow:auto;padding:10px 12px 14px;}',
  '.dshn8n-sec{margin-top:10px;}',
  '.dshn8n-sec h4{margin:0 0 6px;font-size:11px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:var(--n8n-fg-dim);}',
  '.dshn8n-row{display:flex;align-items:center;gap:6px;margin-bottom:6px;}',
  '.dshn8n-row input{flex:1;min-width:0;border-radius:8px;border:1px solid var(--n8n-border-strong);background:var(--n8n-input-bg);color:var(--n8n-fg);padding:6px 9px;font-size:12px;outline:none;transition:border-color .15s ease,box-shadow .15s ease,background .2s ease;}',
  '.dshn8n-row input:focus,.dshn8n-payload:focus,.dshn8n-nodeedit-input:focus{border-color:var(--n8n-accent);box-shadow:0 0 0 3px var(--n8n-focus-ring);outline:none;}',
  '.dshn8n-payload{width:100%;min-height:46px;resize:vertical;border-radius:8px;border:1px solid var(--n8n-border-strong);background:var(--n8n-input-bg);color:var(--n8n-fg);padding:6px 9px;font-size:12px;font-family:ui-monospace,Consolas,monospace;outline:none;box-sizing:border-box;}',
  '.dshn8n-item{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:7px 9px;border-radius:10px;background:var(--n8n-item-bg);border:1px solid var(--n8n-border-soft);margin-bottom:6px;transition:border-color .15s ease,background .15s ease;}',
  '.dshn8n-item:hover{border-color:var(--n8n-border-strong);}',
  '.dshn8n-item .nm{flex:1;min-width:0;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.dshn8n-tag{font-size:10.5px;padding:2px 7px;border-radius:999px;border:1px solid var(--n8n-border-strong);color:var(--n8n-fg-soft);}',
  '.dshn8n-tag.on{color:var(--n8n-ok);border-color:var(--n8n-ok);}',
  '.dshn8n-tag.off{color:var(--n8n-fg-dim);}',
  '.dshn8n-st{font-size:10.5px;padding:2px 7px;border-radius:999px;font-weight:600;}',
  '.dshn8n-st.success{background:var(--n8n-cred-ok-bg);color:var(--n8n-ok);}',
  '.dshn8n-st.error,.dshn8n-st.crashed{background:var(--n8n-cred-warn-bg);color:var(--n8n-err-soft);}',
  '.dshn8n-st.running,.dshn8n-st.new,.dshn8n-st.waiting{background:var(--n8n-cred-warn-bg);color:var(--n8n-warn);}',
  '.dshn8n-st.canceled,.dshn8n-st.unknown{background:var(--n8n-item-bg);color:var(--n8n-fg-soft);}',
  '.dshn8n-empty{font-size:12px;color:var(--n8n-fg-faint);padding:14px 6px;text-align:center;line-height:1.6;}',
  '.dshn8n-msg{font-size:11.5px;color:var(--n8n-warn);margin:2px 0 4px;}',
  '.dshn8n-exmsg{font-size:11.5px;color:var(--n8n-err-soft);margin:2px 0 4px;display:none;}',
  '.dshn8n-time{font-size:10.5px;color:var(--n8n-fg-faint);}',
  '.dshn8n-conninfo{font-size:11px;color:var(--n8n-fg-faint);margin:2px 0 6px;word-break:break-all;}',
  '.dshn8n-editor{display:flex;flex-direction:column;border-bottom:1px solid var(--n8n-border);}',
  '.dshn8n-editor-bar{display:flex;align-items:center;gap:6px;padding:8px 12px;}',
  '.dshn8n-editor-bar .t{flex:1;font-size:12px;color:var(--n8n-fg-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.dshn8n-frame{width:100%;height:min(56vh,520px);border:0;background:var(--n8n-frame-bg);display:block;}',
  '.dshn8n-embed-notice{padding:20px 16px;font-size:12.5px;color:var(--n8n-fg-soft);line-height:1.75;}',
  '.dshn8n-canvasbox{background:var(--n8n-canvas-bg);border:1px solid var(--n8n-border-soft);border-radius:10px;padding:8px;margin:6px 0;overflow:auto;}',
  '.dshn8n-canvas{width:100%;height:auto;max-height:min(48vh,420px);display:block;}',
  '.dshn8n-canvas .dshn8n-edge{fill:none;stroke:var(--n8n-edge);stroke-width:1.6;}',
  '.dshn8n-canvas .dshn8n-edge.alt{stroke:var(--n8n-edge-alt);stroke-dasharray:5 4;}',
  '.dshn8n-canvas .dshn8n-node rect{fill:var(--n8n-node-fill);stroke:var(--n8n-node-stroke);stroke-width:1.2;}',
  '.dshn8n-canvas .dshn8n-node.disabled rect{fill:var(--n8n-node-fill-off);stroke-dasharray:4 3;}',
  '.dshn8n-canvas .dshn8n-node text.nm{fill:var(--n8n-node-text);font-size:12px;font-weight:600;}',
  '.dshn8n-canvas .dshn8n-node text.kind{fill:var(--n8n-node-kind);font-size:10px;}',
  '.dshn8n-canvas .dshn8n-node.disabled text{opacity:.55;}',
  '.dshn8n-canvas .dshn8n-node{cursor:context-menu;}',
  '.dshn8n-menu{position:fixed;z-index:99999;background:var(--n8n-menu-bg);border:1px solid var(--n8n-menu-border);border-radius:8px;padding:4px;box-shadow:var(--n8n-menu-shadow);backdrop-filter:blur(16px);transform-origin:0 0;animation:dshn8n-pop .13s cubic-bezier(.2,.9,.3,1);}',
  '.dshn8n-menu-item{display:block;width:100%;text-align:left;background:transparent;border:0;color:var(--n8n-fg);font-size:12.5px;padding:7px 14px;border-radius:6px;cursor:pointer;white-space:nowrap;}',
  '.dshn8n-menu-item:hover{background:var(--n8n-menu-hover);}',
  '.dshn8n-nodeedit{margin:8px 0 0;padding:10px;border:1px solid var(--n8n-border-strong);border-radius:10px;background:var(--n8n-item-bg);}',
  '.dshn8n-nodeedit-label{font-size:12px;color:var(--n8n-fg-dim);margin-bottom:6px;}',
  '.dshn8n-nodeedit-input{width:100%;box-sizing:border-box;resize:vertical;min-height:46px;background:var(--n8n-input-bg);border:1px solid var(--n8n-border-strong);border-radius:8px;color:var(--n8n-fg);font-size:12.5px;padding:8px;font-family:inherit;line-height:1.5;}',
  '.dshn8n-nodeedit-actions{display:flex;gap:8px;margin-top:8px;}',
  '.dshn8n-embed-text{white-space:pre-line;margin-bottom:12px;}',
  '.dshn8n-hint{font-size:11px;color:var(--n8n-fg-faint);padding:6px 12px;}',
  '.dshn8n-sess-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;}',
  '.dshn8n-sess-goal{flex:1;min-width:0;font-size:12px;color:var(--n8n-fg-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
  '.dshn8n-bar{height:6px;border-radius:3px;background:var(--n8n-bar-bg);overflow:hidden;margin-bottom:8px;}',
  '.dshn8n-bar>span{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--n8n-accent),var(--n8n-accent-2));transition:width .25s ease;}',
  '.dshn8n-step{display:flex;gap:7px;align-items:flex-start;padding:4px 0;font-size:12px;}',
  '.dshn8n-step .ic{flex:0 0 14px;width:14px;text-align:center;}',
  '.dshn8n-step .tx{flex:1;min-width:0;word-break:break-word;}',
  '.dshn8n-step .sub{color:var(--n8n-fg-faint);font-size:10.5px;margin-top:1px;}',
  '.dshn8n-step.done .ic{color:var(--n8n-ok);}',
  '.dshn8n-step.running .ic{color:var(--n8n-warn);}',
  '.dshn8n-step.failed .ic{color:var(--n8n-err-soft);}',
  '.dshn8n-step.pending .ic,.dshn8n-step.skipped .ic{color:var(--n8n-fg-faint);}',
  '.dshn8n-step.failed .tx{color:var(--n8n-err-soft);}',
  '.dshn8n-credbox{margin-top:6px;font-size:11.5px;color:var(--n8n-fg-soft);border-left:2px solid var(--n8n-warn);padding:6px 9px;background:var(--n8n-cred-warn-bg);border-radius:0 7px 7px 0;word-break:break-word;white-space:pre-line;}',
  '.dshn8n-credbox.ok{border-left-color:var(--n8n-ok);background:var(--n8n-cred-ok-bg);}',
  // 滚动条：不做样式的话，深色面板里会冒出系统的白色滚动条，很扎眼
  '.dshn8n-body::-webkit-scrollbar,.dshn8n-canvasbox::-webkit-scrollbar{width:8px;height:8px;}',
  '.dshn8n-body::-webkit-scrollbar-track,.dshn8n-canvasbox::-webkit-scrollbar-track{background:transparent;}',
  '.dshn8n-body::-webkit-scrollbar-thumb,.dshn8n-canvasbox::-webkit-scrollbar-thumb{background:var(--n8n-scroll-thumb);border-radius:4px;}',
  '.dshn8n-body::-webkit-scrollbar-thumb:hover,.dshn8n-canvasbox::-webkit-scrollbar-thumb:hover{background:var(--n8n-scroll-thumb-hover);}',
  // 选中文字用主题色，避免深色面板里出现刺眼的系统蓝
  '.dshn8n-root ::selection{background:var(--n8n-selection);}',
  '.dshn8n-themebtn{padding:5px 8px;font-size:13px;line-height:1;}',
  '.dshn8n-root.dshn8n-dragging,.dshn8n-root.dshn8n-dragging *{transition:none !important;cursor:grabbing;}',
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

  // ---- 主题（深色玻璃 / 奶白）----
  // 主题靠 CSS 变量切换：两套主题各写一份 CSS 会让体积翻倍，所以只换变量值。
  var theme = (NS.loadTheme && NS.loadTheme()) || 'dark'

  // 位置与主题一样，要在 root 建好后立刻生效 —— 所以必须在这之前就赋好值，
  // 否则 applyPos 读到的是 undefined（var 只提升声明，不提升赋值）。
  var pos = (NS.loadPos && NS.loadPos()) || null
  // 拖完松手会补发一次 click，不拦住就会「拖一下顺便把面板打开了」
  var suppressClick = false
  var themeBtn = el('button', {
    class: 'dshn8n-btn dshn8n-themebtn',
    text: theme === 'light' ? '☾' : '☀',
    title: theme === 'light' ? '切换到深色' : '切换到奶白'
  })

  /** persist 为真时才写入 localStorage（初始化时不必回写）。 */
  function applyTheme(next, persist) {
    theme = next === 'light' ? 'light' : 'dark'
    root.className = 'dshn8n-root' + (theme === 'light' ? ' dshn8n-light' : '')
    themeBtn.textContent = theme === 'light' ? '☾' : '☀'
    themeBtn.title = theme === 'light' ? '切换到深色' : '切换到奶白'
    if (persist && NS.saveTheme) NS.saveTheme(theme)
  }

  themeBtn.onclick = function () {
    applyTheme(theme === 'light' ? 'dark' : 'light', true)
  }

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

  // 内嵌不了 n8n 时改为自绘画布（只用节点坐标+连线，不依赖 iframe）
  var canvasBox = el('div', { class: 'dshn8n-canvasbox', style: 'display:none' })
  var canvasNote = el('div', { class: 'dshn8n-hint', text: '' })

  // 右键节点 → 写下需求 → 交给 AI 改。
  // 浮窗自己改不了节点（它没有 LLM，也不该直接写库），所以这里只负责把需求
  // 描述清楚并投给 Agent，由 Agent 用 n8n 工具去改 —— 改完画布会自动刷新。
  var nodeEditLabel = el('div', { class: 'dshn8n-nodeedit-label', text: '' })
  var nodeEditInput = el('textarea', {
    class: 'dshn8n-nodeedit-input',
    rows: '2',
    placeholder: '例如：把 URL 改成 https://api.example.com，method 用 POST'
  })
  var nodeEditSend = el('button', { class: 'dshn8n-btn primary', text: '交给 AI 修改' })
  var nodeEditCancel = el('button', { class: 'dshn8n-btn', text: '取消' })
  var nodeEditBox = el('div', { class: 'dshn8n-nodeedit', style: 'display:none' }, [
    nodeEditLabel,
    nodeEditInput,
    el('div', { class: 'dshn8n-nodeedit-actions' }, [nodeEditSend, nodeEditCancel])
  ])

  var editorSection = el('div', { class: 'dshn8n-editor', style: 'display:none' }, [
    el('div', { class: 'dshn8n-editor-bar' }, [editorTitle, autoBtn, openExternalBtn, closeEditorBtn]),
    frame,
    embedNotice,
    canvasBox,
    canvasNote,
    nodeEditBox,
    el('div', {
      class: 'dshn8n-hint',
      text: 'n8n 允许内嵌时这里直接显示编辑器；不允许时改为只读画布（能看到节点与连线，改还是要打开系统浏览器）。要自己改就先关掉「自动刷新」。',
    }),
  ])

  // 标题栏单独拿出来，作为面板的拖动把手
  var head = el('div', { class: 'dshn8n-head' }, [
    el('div', { class: 'dshn8n-title' }, [statusDot, el('span', { text: 'n8n 监控' })]),
    themeBtn,
    refreshBtn,
    collapseBtn,
  ])

  var panel = el('div', { class: 'dshn8n-panel' }, [
    head,
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

  var orb = el('button', { class: 'dshn8n-orb dshn8n-hidden', text: 'n8n', title: '打开 n8n 监控' })
  orb.appendChild(el('span', { class: 'dshn8n-dot wait' }))

  var root = el('div', { class: 'dshn8n-root' }, [panel, orb])
  document.body.appendChild(root)

  // root 建好之后才能挂主题类（applyTheme 会读 root）
  applyTheme(theme, false)
  // 上次拖到哪就还放哪（没拖过则保持 CSS 的右下角默认位）
  applyPos()

  function editorUrl(id) {
    // 必须用**宿主实际连接**的地址：当连接来自环境变量/插件配置而非浮窗输入框时，
    // 本地存储里的地址可能是另一个实例，用它会把编辑器开到错误的 n8n 上。
    var base = (state.editorBaseUrl || NS.loadConfig().baseUrl || '').replace(/\/+$/, '')
    if (!base) return 'about:blank'
    return id ? base + '/workflow/' + encodeURIComponent(id) : base + '/home/workflows'
  }

  /**
   * 展开 / 收起。
   * 用 class 而不是 `display`：`display:none ↔ flex` 之间没有过渡，
   * 面板会硬生生地出现/消失；改成 opacity + scale 才有「弹出来」的感觉。
   */
  function setCollapsed(v) {
    state.collapsed = v
    toggleHidden(panel, v)
    toggleHidden(orb, !v)

    if (v) {
      // 收起时把球送回右下角默认位。
      //
      // 之前这里什么都不做，于是有个很烦的现象：球在右下角时展开面板，
      // 下面的夹取会把 pos 从 1226 压到 928（面板 352 宽放不下），
      // 再收起时球就停在 928 —— 用户看到的是「球跳到别的地方去了」。
      // 收起即归位，行为可预期，也不用记展开时的位置。
      pos = null
      applyPos()
      if (NS.savePos) NS.savePos(null)
      return
    }

    // 展开时面板比球大得多：如果之前把球拖到了屏幕最右边/最下边，
    // 直接展开会有半个面板在屏幕外，这里重新夹一下。
    if (pos) {
      var size = visibleSize()
      var vw = (globalThis.window && globalThis.window.innerWidth) || 1280
      var vh = (globalThis.window && globalThis.window.innerHeight) || 800
      if (pos.left > vw - size.w || pos.top > vh - size.h) {
        pos = {
          left: Math.max(0, Math.min(pos.left, vw - size.w)),
          top: Math.max(0, Math.min(pos.top, vh - size.h))
        }
        applyPos()
      }
    }
  }

  /** 加/去 `dshn8n-hidden`，不动元素上已有的其它 class（比如 panel 的 wide）。 */
  function toggleHidden(node, hidden) {
    var base = String(node.className || '')
      .replace(/\s*dshn8n-hidden\b/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    node.className = base + (hidden ? ' dshn8n-hidden' : '')
  }

  // ---- 拖动定位 ----
  // 球和面板共用同一个位置：面板是从球的位置长出来的，分开记反而会错位。
  // pos / suppressClick 在更上面就声明了（applyPos 在 root 建好后立刻要用）。

  function applyPos() {
    if (!pos) {
      root.style.left = ''
      root.style.top = ''
      root.style.right = ''
      root.style.bottom = ''
      return
    }
    root.style.left = pos.left + 'px'
    root.style.top = pos.top + 'px'
    // 必须同时清掉 right/bottom，否则 left 和 right 一起生效会把容器拉宽
    root.style.right = 'auto'
    root.style.bottom = 'auto'
  }

  /**
   * 边界要按**当前可见的元素**算。
   *
   * 收起时面板还在 DOM 里（用 opacity 隐藏，为了保留动画），所以 `root` 的尺寸
   * 仍然是整个面板的 —— 拿它算边界会把小球锁在屏幕左上角一小块地方，
   * 拖不到右边和下边。收起时只有球可见，就按球算。
   */
  function visibleSize() {
    var el = state.collapsed ? orb : panel
    var w = (el && el.offsetWidth) || (state.collapsed ? 54 : 352)
    var h = (el && el.offsetHeight) || (state.collapsed ? 54 : 420)
    return { w: w, h: h }
  }

  /** 夹在视口内，避免拖出屏幕后再也找不回来。 */
  function setPos(left, top) {
    var vw = (globalThis.window && globalThis.window.innerWidth) || 1280
    var vh = (globalThis.window && globalThis.window.innerHeight) || 800
    var size = visibleSize()
    pos = {
      left: Math.round(Math.max(0, Math.min(left, vw - size.w))),
      top: Math.round(Math.max(0, Math.min(top, vh - size.h)))
    }
    applyPos()
  }

  /** 按在按钮/输入框上时不要开始拖动。 */
  function isInteractive(el) {
    var tag = String((el && el.tagName) || '').toLowerCase()
    return tag === 'button' || tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'a'
  }

  function makeDraggable(handle) {
    var dragging = false
    var moved = false
    var startX = 0
    var startY = 0
    var startLeft = 0
    var startTop = 0

    handle.addEventListener('mousedown', function (ev) {
      // 把手本身可能就是按钮（悬浮球就是），这不算「按在交互元素上」；
      // 只有把手**内部**的按钮/输入框才该拦下来。
      if (ev.button !== 0 || (ev.target !== handle && isInteractive(ev.target))) return
      var rect =
        typeof root.getBoundingClientRect === 'function'
          ? root.getBoundingClientRect()
          : { left: pos ? pos.left : 0, top: pos ? pos.top : 0 }
      dragging = true
      moved = false
      startX = ev.clientX
      startY = ev.clientY
      startLeft = rect.left
      startTop = rect.top
      if (ev.preventDefault) ev.preventDefault()
    })

    // 移动/松开挂在 document 上：鼠标拖出元素范围也要继续跟手
    document.addEventListener('mousemove', function (ev) {
      if (!dragging) return
      var dx = ev.clientX - startX
      var dy = ev.clientY - startY
      // 3px 以内算手抖，不算拖动 —— 否则轻微抖动会让点击失效
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return
      if (!moved) {
        moved = true
        // 拖动期间关掉过渡，不然位置变化会「拖尾」
        root.className = root.className.replace(/\s*dshn8n-dragging\b/g, '') + ' dshn8n-dragging'
      }
      setPos(startLeft + dx, startTop + dy)
    })

    document.addEventListener('mouseup', function () {
      if (!dragging) return
      dragging = false
      if (!moved) return
      root.className = root.className.replace(/\s*dshn8n-dragging\b/g, '')
      if (NS.savePos) NS.savePos(pos)
      suppressClick = true
      setTimeout(function () {
        suppressClick = false
      }, 0)
    })
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
  // ---- 只读画布：n8n 拒绝被 iframe 内嵌时的替代方案 ----
  var SVG_NS = 'http://www.w3.org/2000/svg'
  var NODE_W = 132
  var NODE_H = 48
  var CANVAS_PAD = 18

  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag)
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, String(attrs[k]))
      }
    }
    return node
  }

  function clipText(text, max) {
    var s = String(text == null ? '' : text)
    return s.length > max ? s.slice(0, max - 1) + '…' : s
  }

  /** 把 /canvas 返回的图渲染成只读 SVG。纯展示，不绑定任何编辑动作。 */
  function renderCanvas(graph) {
    canvasBox.textContent = ''
    var nodes = (graph && graph.nodes) || []
    var edges = (graph && graph.edges) || []

    if (!nodes.length) {
      canvasBox.appendChild(el('div', { class: 'dshn8n-hint', text: '这个工作流还没有节点。' }))
      canvasNote.textContent = ''
      return
    }

    var byName = {}
    var minX = Infinity
    var minY = Infinity
    var maxX = -Infinity
    var maxY = -Infinity
    nodes.forEach(function (n) {
      byName[n.name] = n
      if (n.x < minX) minX = n.x
      if (n.y < minY) minY = n.y
      if (n.x > maxX) maxX = n.x
      if (n.y > maxY) maxY = n.y
    })

    var vbW = Math.max(NODE_W, maxX - minX + NODE_W) + CANVAS_PAD * 2
    var vbH = Math.max(NODE_H, maxY - minY + NODE_H) + CANVAS_PAD * 2

    var svg = svgEl('svg', {
      class: 'dshn8n-canvas',
      viewBox: '0 0 ' + vbW + ' ' + vbH,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img',
      'aria-label': '工作流画布（只读）',
    })

    // 连线画在底层
    edges.forEach(function (e) {
      var from = byName[e.from]
      var to = byName[e.to]
      if (!from || !to) return
      var x1 = from.x - minX + CANVAS_PAD + NODE_W
      var y1 = from.y - minY + CANVAS_PAD + NODE_H / 2
      var x2 = to.x - minX + CANVAS_PAD
      var y2 = to.y - minY + CANVAS_PAD + NODE_H / 2
      var dx = Math.max(28, Math.abs(x2 - x1) * 0.5)
      svg.appendChild(
        svgEl('path', {
          class: 'dshn8n-edge' + (e.channel === 'main' ? '' : ' alt'),
          d:
            'M' + x1 + ',' + y1 +
            ' C' + (x1 + dx) + ',' + y1 +
            ' ' + (x2 - dx) + ',' + y2 +
            ' ' + x2 + ',' + y2,
        })
      )
    })

    // 节点画在上层
    nodes.forEach(function (n) {
      var x = n.x - minX + CANVAS_PAD
      var y = n.y - minY + CANVAS_PAD
      var g = svgEl('g', { class: 'dshn8n-node' + (n.disabled ? ' disabled' : '') })

      var title = svgEl('title')
      title.textContent = n.name + '\n' + n.type + (n.disabled ? '（已禁用）' : '')
      g.appendChild(title)

      g.appendChild(svgEl('rect', { x: x, y: y, width: NODE_W, height: NODE_H, rx: 11 }))

      var nm = svgEl('text', { x: x + 10, y: y + 20, class: 'nm' })
      nm.textContent = clipText(n.name, 15)
      g.appendChild(nm)

      var kind = svgEl('text', { x: x + 10, y: y + 36, class: 'kind' })
      kind.textContent = clipText(n.kind, 18)
      g.appendChild(kind)

      // 右键节点 → 提需求交给 AI 改
      g.addEventListener('contextmenu', function (ev) {
        ev.preventDefault()
        // 阻止冒泡：否则会连带触发画布空白处的「添加节点」菜单
        ev.stopPropagation()
        showNodeMenu(n.name, ev.clientX, ev.clientY)
      })

      svg.appendChild(g)
    })

    // 画布空白处右键 → 添加节点（节点上的事件已 stopPropagation，不会走到这里）
    svg.addEventListener('contextmenu', function (ev) {
      ev.preventDefault()
      showCanvasBlankMenu(ev.clientX, ev.clientY)
    })

    canvasBox.appendChild(svg)

    var extra = []
    if (graph.danglingEdges) {
      extra.push(graph.danglingEdges + ' 条连线指向不存在的节点（未画出）')
    }
    var others = edges.filter(function (e) {
      return e.channel !== 'main'
    }).length
    if (others) extra.push(others + ' 条 AI 通道连线（虚线）')

    canvasNote.textContent =
      nodes.length + ' 个节点 · ' + edges.length + ' 条连线' +
      (extra.length ? ' · ' + extra.join(' · ') : '')
  }

  function hideCanvas() {
    canvasBox.style.display = 'none'
    canvasBox.textContent = ''
    canvasNote.textContent = ''
    closeNodeEditor()
  }

  // ---- 右键节点：写需求 → 交给 AI ----

  var nodeMenu = null

  function closeNodeMenu() {
    if (nodeMenu && nodeMenu.parentNode) nodeMenu.parentNode.removeChild(nodeMenu)
    nodeMenu = null
  }

  /** 在鼠标位置弹一个菜单。items: [{ label, onClick }] */
  function showCanvasMenu(items, clientX, clientY) {
    closeNodeMenu()
    // 菜单挂在 body 上（不在 .dshn8n-root 内），拿不到 root 的变量，所以要自己带主题类
    var menu = el('div', { class: 'dshn8n-menu' + (theme === 'light' ? ' dshn8n-light' : '') })
    items.forEach(function (it) {
      var btn = el('button', { class: 'dshn8n-menu-item', text: it.label })
      btn.onclick = function () {
        closeNodeMenu()
        it.onClick()
      }
      menu.appendChild(btn)
    })
    // 贴边时往回收，避免菜单跑到屏幕外
    menu.style.left = Math.max(8, Math.min(clientX, window.innerWidth - 190)) + 'px'
    menu.style.top = Math.max(8, Math.min(clientY, window.innerHeight - 60)) + 'px'
    document.body.appendChild(menu)
    nodeMenu = menu
    // 点别处 / 按 Esc 关掉
    setTimeout(function () {
      document.addEventListener('click', closeNodeMenu, { once: true })
      document.addEventListener(
        'keydown',
        function onEsc(ev) {
          if (ev.key === 'Escape') {
            closeNodeMenu()
            document.removeEventListener('keydown', onEsc)
          }
        }
      )
    }, 0)
  }

  /** 右键节点：只有「修改」 */
  function showNodeMenu(nodeName, clientX, clientY) {
    showCanvasMenu(
      [
        {
          label: '修改这个节点…',
          onClick: function () {
            openNodeEditor('modify', nodeName)
          }
        }
      ],
      clientX,
      clientY
    )
  }

  /** 右键画布空白处：只有「添加」 */
  function showCanvasBlankMenu(clientX, clientY) {
    showCanvasMenu(
      [
        {
          label: '添加节点…',
          onClick: function () {
            openNodeEditor('add')
          }
        }
      ],
      clientX,
      clientY
    )
  }

  /**
   * 打开需求输入框。
   * @param {'modify'|'add'} mode 修改某个节点 / 往工作流里加节点
   * @param {string} [nodeName] 仅 modify 需要
   */
  function openNodeEditor(mode, nodeName) {
    state.nodeEdit = { mode: mode, nodeName: nodeName || '' }
    if (mode === 'add') {
      nodeEditLabel.textContent = '添加节点 — 用一句话描述你要加什么'
      nodeEditInput.placeholder = '例如：加一个 HTTP 请求节点，调用 https://api.example.com，接在 Webhook 后面'
    } else {
      nodeEditLabel.textContent = '修改节点「' + nodeName + '」— 用一句话描述你想要的改动'
      nodeEditInput.placeholder = '例如：把 URL 改成 https://api.example.com，method 用 POST'
    }
    nodeEditInput.value = ''
    nodeEditBox.style.display = 'block'
    if (typeof nodeEditInput.focus === 'function') nodeEditInput.focus()
  }

  function closeNodeEditor() {
    state.nodeEdit = null
    nodeEditBox.style.display = 'none'
    nodeEditInput.value = ''
  }

  /** 把需求投给 Agent；改完由 Agent 写库，画布靠自动刷新同步。 */
  function submitNodeEdit() {
    if (!state.nodeEdit) return
    var requirement = String(nodeEditInput.value || '').trim()
    if (!requirement) {
      flash('先写下你想怎么改')
      return
    }
    var workflowId = state.editor.workflowId
    if (!workflowId) {
      flash('请先打开一个工作流')
      return
    }
    var isAdd = state.nodeEdit.mode === 'add'
    setBusy(nodeEditSend, true)
    flash(isAdd ? '已把「添加节点」需求交给 AI…' : '已把需求交给 AI，它正在改…')
    NS.api(isAdd ? '/node-add' : '/node-edit', {
      method: 'POST',
      body: isAdd
        ? { workflowId: workflowId, requirement: requirement }
        : { workflowId: workflowId, nodeName: state.nodeEdit.nodeName, requirement: requirement }
    })
      .then(function (r) {
        setBusy(nodeEditSend, false)
        if (r && r.ok) {
          flash(
            '已发送给 AI（会话 ' +
              String(r.sessionId || '').slice(0, 8) +
              '）— 改完后画布会自动刷新'
          )
          closeNodeEditor()
        } else {
          flash('发送失败：' + ((r && r.error) || '未知错误'))
        }
      })
      .catch(function (e) {
        setBusy(nodeEditSend, false)
        flash('发送失败：' + e.message)
      })
  }

  nodeEditSend.onclick = submitNodeEdit
  nodeEditCancel.onclick = closeNodeEditor
  nodeEditInput.addEventListener('keydown', function (ev) {
    // Enter 提交，Shift+Enter 换行
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault()
      submitNodeEdit()
    }
  })

  function loadCanvas(workflowId) {
    canvasBox.style.display = 'block'
    canvasBox.textContent = ''
    canvasNote.textContent = '正在读取画布…'
    // 切换工作流时收起未提交的节点编辑，避免把需求发到另一个工作流上
    closeNodeEditor()
    NS.api('/workflows/' + encodeURIComponent(workflowId) + '/canvas')
      .then(function (r) {
        if (r && r.ok) renderCanvas(r)
        else canvasNote.textContent = '画布读取失败：' + ((r && r.error) || '未知错误')
      })
      .catch(function (e) {
        canvasNote.textContent = '画布读取失败：' + e.message
      })
  }

  function applyEmbeddability(embeddable, reason) {
    state.editor.embeddable = embeddable === true
    frame.style.display = embeddable ? 'block' : 'none'
    embedNotice.style.display = embeddable ? 'none' : 'block'
    autoBtn.disabled = !embeddable
    if (embeddable) {
      hideCanvas()
      loadFrame()
      return
    }
    embedText.textContent =
      '无法在浮窗里内嵌 n8n 编辑器。\n\n' +
      (reason || 'n8n 未允许被内嵌。') +
      '\n\n下面是用节点坐标自己画的只读画布；要修改请点「在系统浏览器打开」。' +
      '其余功能（工作流列表、搭建进度、快照/回滚、触发）都不受影响。'
    // 有具体工作流就画出来 —— 至少让用户看见结构，而不是盯着一句说明
    if (state.editor.workflowId) loadCanvas(state.editor.workflowId)
    else hideCanvas()
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
    hideCanvas()
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
            if (r && r.ok) {
              // 工作流曾被删除时是按快照重建的：id 变了，必须说清楚，否则用户会在列表里
              // 看到一个陌生条目而不知道它就是刚回滚的那个
              flash(
                r.recreated
                  ? '原工作流已被删除，已按快照重建（新 id：' + r.workflowId + '）'
                  : '已回滚到快照 ' + r.restoredFrom
              )
            } else {
              flash('回滚失败：' + ((r && r.error) || '未知错误'))
            }
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
    // 刚拖动过就别顺手把面板打开
    if (suppressClick) return
    setCollapsed(false)
  }

  // 球和标题栏都能拖
  makeDraggable(orb)
  makeDraggable(head)

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
