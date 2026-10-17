/**
 * dsh-n8n-lg —— DSH 轻量化 n8n 集成插件入口。
 *
 * 定位：DSH 里的「遥控器」，触发并监控 n8n 工作流，不重造执行引擎。
 * 依据：n8n 2.44.0 公开 API 核验（无触发端点 → 触发走 Webhook）。
 *
 * 四个组成部分：
 *  1. 连接管理：{@link ConnectionManager} —— 全插件唯一的 n8n 连接来源
 *     （浮窗保存的连接与 AI 工具共享，地址与密钥始终成对）。
 *  2. 工具层：17 个 n8n 工具，写操作经过 WorkflowEditor（幂等/校验/快照）。
 *  3. 容器沙箱（可选）：用 Docker 跑 n8n，并注册 `ctx.n8nSandbox` 服务。
 *  4. 玻璃 HUD：客户端 UI 半（lib/client.js）+ node 半注册的 `/api/dsh-n8n-lg/*`
 *     代理路由（因为 n8n 无 CORS，浏览器不能直连）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Config } from './config.js'
import { ConnectionManager } from './connection.js'
import { HUD_ROUTE_PREFIX, registerHudRoutes, type WebServerLike } from './hud/routes.js'
import { sessions } from './n8n/session.js'
import { snapshots } from './n8n/snapshots.js'
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

  // 连接管理器：唯一的连接来源。未配置也**不阻断加载**——
  // 工具照常注册（执行时才要求连接），否则用户就没法在浮窗里填地址了。
  const manager = new ConnectionManager(config)
  const status = manager.status()
  if (status.configured) {
    log('info', `n8n 连接：${status.baseUrl}（来源：${status.source}）`)
  } else {
    log('warn', '尚未配置 n8n 连接；工具已注册，可在玻璃浮窗里填写地址与 API Key')
  }

  // 快照与搭建会话落盘：不落盘的话，插件重启 = 回滚点和搭建进度全丢。
  // 默认写到 ~/.dsh/n8n-lg/（不在仓库里），可用 stateDir 改；
  // persistState=false 时保持纯内存行为。
  if (config.persistState !== false) {
    const dir = config.stateDir || join(homedir(), '.dsh', 'n8n-lg')
    snapshots.useFile(join(dir, 'snapshots.json'))
    sessions.useFile(join(dir, 'sessions.json'))
    const broken = snapshots.persistenceBroken || sessions.persistenceBroken
    log(
      broken ? 'warn' : 'info',
      broken ? `状态目录不可写：${dir}（快照与会话只在内存里）` : `快照与会话落盘于 ${dir}`
    )
  }

  registerTools(ctx, manager, config)

  if (config.sandbox?.enabled) {
    const sandbox = new DockerSandbox({
      image: config.sandbox.image,
      containerName: config.sandbox.containerName,
      hostPort: config.sandbox.hostPort,
      containerPort: config.sandbox.containerPort,
      dataVolume: config.sandbox.dataVolume,
      timezone: config.sandbox.timezone,
      memoryLimitMb: config.sandbox.memoryLimitMb,
      cpus: config.sandbox.cpus,
      pidsLimit: config.sandbox.pidsLimit,
      noNewPrivileges: config.sandbox.noNewPrivileges
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
    const dispose = registerHudRoutes(ws, { manager })
    if (typeof child.effect === 'function') child.effect(() => dispose, 'dsh-n8n-lg: hud routes')
    log('info', `HUD 代理路由已注册：${HUD_ROUTE_PREFIX}/*`)
  }

  if (typeof ctxAny.inject === 'function') {
    ctxAny.inject(['webServer'], mountHudRoutes)
  } else {
    mountHudRoutes(ctx)
  }
}
