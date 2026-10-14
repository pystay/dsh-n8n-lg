/**
 * dsh-n8n-lg —— DSH 轻量化 n8n 集成插件入口。
 *
 * 定位：DSH 里的「遥控器」，触发并监控 n8n 工作流，不重造执行引擎。
 * 依据：n8n 2.44.0 公开 API 核验（无触发端点 → 触发走 Webhook）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { Config } from './config.js'
import { N8nClient } from './n8n/client.js'
import { registerTools } from './tools/index.js'

export const name = 'n8n-lg'
export const inject = ['tools']

/** 导出配置 schema，供 Cordis 在加载时校验并填充默认值。 */
export { Config }
export type { Config as N8nConfig } from './config.js'

export function apply(ctx: Context, config: Config): void {
  const client = new N8nClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
    webhookAuth:
      config.webhookAuthHeader && config.webhookAuthValue
        ? { header: config.webhookAuthHeader, value: config.webhookAuthValue }
        : undefined
  })

  registerTools(ctx, client, config)
}
