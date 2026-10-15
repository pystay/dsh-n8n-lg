/*
 * dsh-n8n-lg · HUD 数据层（浏览器端）
 *
 * 所有 n8n 请求都打给插件 node 半注册的同源代理路由 /api/dsh-n8n-lg/*
 * （因为 n8n 无 CORS，浏览器不能直连）。
 *
 * 连接信息**不再随请求发送**：浮窗保存后 POST /config 交给宿主，
 * 由宿主的 ConnectionManager 统一持有——这样 AI 工具与浮窗永远指向同一个实例，
 * 也不会出现「新地址 + 旧密钥」的错误组合。
 * localStorage 仅用于回填表单。
 */
;(function () {
  'use strict'

  var NS = (globalThis.__DSH_N8N_HUD__ = globalThis.__DSH_N8N_HUD__ || {})
  var LS_KEY = 'dsh-n8n-lg:hud-config'
  var DEFAULT_BASE_URL = 'http://127.0.0.1:5678'
  var API_BASE = '/api/dsh-n8n-lg'
  var DEFAULT_TIMEOUT_MS = 20000

  function loadConfig() {
    var cfg = null
    try {
      var raw = globalThis.localStorage && globalThis.localStorage.getItem(LS_KEY)
      if (raw) cfg = JSON.parse(raw)
    } catch (e) {
      cfg = null
    }
    cfg = cfg && typeof cfg === 'object' ? cfg : {}
    return {
      baseUrl: typeof cfg.baseUrl === 'string' && cfg.baseUrl ? cfg.baseUrl : DEFAULT_BASE_URL,
      apiKey: typeof cfg.apiKey === 'string' ? cfg.apiKey : '',
    }
  }

  function saveConfig(cfg) {
    try {
      globalThis.localStorage.setItem(LS_KEY, JSON.stringify(cfg))
      return true
    } catch (e) {
      return false
    }
  }

  /**
   * 统一请求代理路由。
   * - 同时检查 HTTP 状态与业务 ok 字段：非 2xx 一律视为失败（不再被 JSON 里的 ok:true 掩盖）。
   * - 带超时，避免请求悬挂。
   */
  function api(path, options) {
    options = options || {}
    var headers = { Accept: 'application/json' }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    var timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS
    var timer = null
    if (controller) {
      timer = setTimeout(function () {
        controller.abort()
      }, timeoutMs)
    }

    var clear = function () {
      if (timer) clearTimeout(timer)
      timer = null
    }

    var request = globalThis.fetch(API_BASE + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller ? controller.signal : options.signal,
    })

    return request
      .then(function (res) {
        return res.text().then(function (text) {
          var data = null
          try {
            data = text ? JSON.parse(text) : {}
          } catch (e) {
            /* 非 JSON 响应（例如宿主兜底 404 的纯文本）→ 结构化错误 */
            return {
              ok: false,
              httpStatus: res.status,
              error: 'HTTP ' + res.status + '：' + (text || '').slice(0, 120),
            }
          }
          if (!res.ok) {
            return {
              ok: false,
              httpStatus: res.status,
              error: (data && (data.error || data.message)) || 'HTTP ' + res.status,
            }
          }
          return data
        })
      })
      .then(
        function (value) {
          clear()
          return value
        },
        function (err) {
          clear()
          var aborted = err && (err.name === 'AbortError' || err.name === 'TimeoutError')
          throw new Error(aborted ? '请求超时（' + timeoutMs + 'ms）' : (err && err.message) || '请求失败')
        }
      )
  }

  /** 把连接交给宿主（唯一的连接来源）。 */
  function pushConfig(cfg) {
    return api('/config', { method: 'POST', body: { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey } })
  }

  /** 清除宿主的运行时覆盖（回落到配置文件 / 环境变量）。 */
  function clearHostConfig() {
    return api('/config', { method: 'DELETE' })
  }

  /** 读取宿主连接状态（已脱敏）。 */
  function fetchStatus() {
    return api('/config')
  }

  NS.DEFAULT_BASE_URL = DEFAULT_BASE_URL
  NS.API_BASE = API_BASE
  NS.loadConfig = loadConfig
  NS.saveConfig = saveConfig
  NS.pushConfig = pushConfig
  NS.clearHostConfig = clearHostConfig
  NS.fetchStatus = fetchStatus
  NS.api = api
})()
