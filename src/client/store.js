/*
 * dsh-n8n-lg · HUD 数据层（浏览器端）
 *
 * 配置存 localStorage（地址 + API Key）；所有 n8n 请求都打给插件 node 半注册的
 * 同源代理路由 /api/dsh-n8n-lg/*（因为 n8n 无 CORS，浏览器不能直连）。
 */
;(function () {
  'use strict'

  var NS = (globalThis.__DSH_N8N_HUD__ = globalThis.__DSH_N8N_HUD__ || {})
  var LS_KEY = 'dsh-n8n-lg:hud-config'
  var DEFAULT_BASE_URL = 'http://127.0.0.1:5678'
  var API_BASE = '/api/dsh-n8n-lg'

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

  /** 统一请求代理路由；连接信息用请求头带给服务端（服务端优先用请求头）。 */
  function api(path, options) {
    options = options || {}
    var cfg = loadConfig()
    var headers = { Accept: 'application/json' }
    if (cfg.baseUrl) headers['x-n8n-base-url'] = cfg.baseUrl
    if (cfg.apiKey) headers['x-n8n-api-key'] = cfg.apiKey
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    return globalThis
      .fetch(API_BASE + path, {
        method: options.method || 'GET',
        headers: headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      })
      .then(function (res) {
        return res.json()
      })
  }

  NS.DEFAULT_BASE_URL = DEFAULT_BASE_URL
  NS.API_BASE = API_BASE
  NS.loadConfig = loadConfig
  NS.saveConfig = saveConfig
  NS.api = api
})()
