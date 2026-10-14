/**
 * dsh-n8n-lg —— DSH 轻量化 n8n 集成插件入口。
 *
 * 定位：DSH 里的「遥控器」，触发并监控 n8n 工作流，不重造执行引擎。
 * 依据：n8n 2.44.0 公开 API 核验（无触发端点 → 触发走 Webhook）。
 *
 * 三个组成部分：
 *  1. 工具层：12 个 n8n 工具（list/create/trigger/...）。
 *  2. 容器沙箱（可选）：用 Docker 跑 n8n，并注册 `ctx.n8nSandbox` 服务。
 *  3. 玻璃 HUD：客户端 UI 半（lib/client.js）+ node 半注册的 `/api/dsh-n8n-lg/*`
 *     代理路由（因为 n8n 无 CORS，浏览器不能直连）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { Config } from './config.js'
import { resolveConnection } from './config-resolve.js'
import { HUD_ROUTE_PREFIX, registerHudRoutes, type WebServerLike } from './hud/routes.js'
import { N8nClient } from './n8n/client.js'
import { DockerSandbox } from './sandbox/docker.js'
import { registerTools } from './tools/index.js'
import { registerSandboxTools } from './tools/sandbox.js'

export const name = 'n8n-lg'
export const inject = ['tools']

/** 导出配置 schema，供 Cordis 在加载时校验并填充默认值。 */
export { Config }
export type { Config as N8nConfig } from './config.js'

/** 向 Cordis 声明本插件提供的服务，便于其他插件 `inject: ['n8nSandbox']`。 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** n8n 容器沙箱服务（仅当 config.sandbox.enabled 时提供）。 */
    n8nSandbox?: DockerSandbox
  }
}

export function apply(ctx: Context, config: Config): void {
  const log = (level: 'info' | 'warn', msg: string): void => {
    const logger = (ctx as unknown as { logger?: Record<string, (m: string) => void> }).logger
    logger?.[level]?.(`[n8n-lg] ${msg}`)
  }

  // 连接信息：优先 config，其次环境变量；缺失时不阻断加载（HUD 里可再填）。
  let connection: { baseUrl: string; apiKey: string } | undefined
  try {
    connection = resolveConnection(config)
  } catch (err) {
    log('warn', `${err instanceof Error ? err.message : String(err)}；工具将不可用，可在 HUD 中配置`)
  }

  if (connection) {
    const client = new N8nClient({
      baseUrl: connection.baseUrl,
      apiKey: connection.apiKey,
      timeoutMs: config.timeoutMs,
      webhookAuth:
        config.webhookAuthHeader && config.webhookAuthValue
          ? { header: config.webhookAuthHeader, value: config.webhookAuthValue }
          : undefined
    })
    registerTools(ctx, client, config)
  }

  if (config.sandbox?.enabled) {
    const sandbox = new DockerSandbox({
      image: config.sandbox.image,
      containerName: config.sandbox.containerName,
      hostPort: config.sandbox.hostPort,
      containerPort: config.sandbox.containerPort,
      dataVolume: config.sandbox.dataVolume,
      timezone: config.sandbox.timezone
    })
    ctx.provide('n8nSandbox', sandbox)
    registerSandboxTools(ctx, sandbox)
  }

  // 玻璃 HUD 的服务端代理路由。
  // 用 `ctx.inject(['webServer'], cb)` 等 webServer 就绪后再注册——直接读
  // `ctx.webServer` 可能在它尚未 provide 时拿到 undefined，导致路由缺失
  // （前端就会收到 DSH 兜底的纯文本 "not found"，JSON 解析报错）。
  const ctxAny = ctx as unknown as {
    webServer?: WebServerLike
    inject?: (deps: string[], cb: (child: unknown) => void) => unknown
  }

  const mountHudRoutes = (target: unknown): void => {
    const ws = (target as { webServer?: WebServerLike }).webServer ?? ctxAny.webServer
    if (!ws) {
      log('warn', '宿主无 webServer，HUD 代理路由未注册')
      return
    }
    const child = target as { effect?: (cb: () => unknown, label?: string) => unknown }
    const dispose = registerHudRoutes(ws, { getConfig: () => config })
    if (typeof child.effect === 'function') child.effect(() => dispose, 'dsh-n8n-lg: hud routes')
    log('info', `HUD 代理路由已注册：${HUD_ROUTE_PREFIX}/*`)
  }

  if (typeof ctxAny.inject === 'function') {
    ctxAny.inject(['webServer'], mountHudRoutes)
  } else {
    mountHudRoutes(ctx)
  }
}
