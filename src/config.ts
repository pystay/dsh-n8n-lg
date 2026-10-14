/**
 * 插件配置（Schemastery schema）。
 *
 * 按 DSH 约定：凡是不同部署可能取不同值的参数都必须是配置字段，
 * 并由导出的 schema 在插件加载时校验、填充默认值。
 */
import Schema from '@deepseek-ai/schemastery'

export interface Config {
  /** n8n 实例基址，如 https://n8n.example.com */
  baseUrl: string
  /** n8n 公开 API Key（敏感，放入 X-N8N-API-KEY 头，勿泄露）。 */
  apiKey: string
  /** 可选：Webhook Header 认证的请求头名。 */
  webhookAuthHeader?: string
  /** 可选：Webhook Header 认证的值（敏感）。 */
  webhookAuthValue?: string
  /** Webhook 路径白名单；留空表示放行全部（MVP 默认，生产建议显式配置）。 */
  allowedWebhookPaths: string[]
  /** 请求超时（毫秒）。 */
  timeoutMs: number
  /** 是否使用 /webhook-test/ 路径（开发调试用）。 */
  useTestWebhook: boolean
}

export const Config: Schema<Config> = Schema.object({
  baseUrl: Schema.string().required(),
  apiKey: Schema.string().required(),
  webhookAuthHeader: Schema.string(),
  webhookAuthValue: Schema.string(),
  allowedWebhookPaths: Schema.array(Schema.string()).default([]),
  timeoutMs: Schema.number().default(30_000),
  useTestWebhook: Schema.boolean().default(false)
})
