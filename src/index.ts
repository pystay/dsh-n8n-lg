/**
 * dsh-n8n-lg —— DSH 轻量化 n8n 集成插件入口。
 *
 * 定位：DSH 里的「遥控器」，触发并监控 n8n 工作流，不重造执行引擎。
 * 依据：n8n 2.44.0 公开 API 核验（无触发端点 → 触发走 Webhook）。
 *
 * 另含「容器沙箱」：用 Docker 把 n8n 跑在隔离容器里（仅绑 127.0.0.1）。
 * 启用后会把沙箱注册为 Cordis 服务 `ctx.n8nSandbox`，供其他插件复用。
 */
import type { Context } from '@deepseek-ai/cordis'
import { Config } from './config.js'
import { resolveConnection } from './config-resolve.js'
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
  // 连接信息：优先 config，其次环境变量（N8N_BASE_URL / N8N_API_KEY），缺失则响亮报错。
  const { baseUrl, apiKey } = resolveConnection(config)
  const client = new N8nClient({
    baseUrl,
    apiKey,
    timeoutMs: config.timeoutMs,
    webhookAuth:
      config.webhookAuthHeader && config.webhookAuthValue
        ? { header: config.webhookAuthHeader, value: config.webhookAuthValue }
        : undefined
  })

  registerTools(ctx, client, config)

  if (config.sandbox?.enabled) {
    const sandbox = new DockerSandbox({
      image: config.sandbox.image,
      containerName: config.sandbox.containerName,
      hostPort: config.sandbox.hostPort,
      containerPort: config.sandbox.containerPort,
      dataVolume: config.sandbox.dataVolume,
      timezone: config.sandbox.timezone
    })
    // 注册为 Cordis 服务（插件卸载时随 fiber 自动清理）
    ctx.provide('n8nSandbox', sandbox)
    registerSandboxTools(ctx, sandbox)
  }
}
