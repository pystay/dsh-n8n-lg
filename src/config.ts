/**
 * 插件配置（Schemastery schema）。
 *
 * 按 DSH 约定：凡是不同部署可能取不同值的参数都必须是配置字段，
 * 并由导出的 schema 在插件加载时校验、填充默认值。
 */
import Schema from '@deepseek-ai/schemastery'

/** 容器沙箱配置（用 Docker 把 n8n 跑在隔离容器里）。 */
export interface SandboxOptions {
  /** 是否启用沙箱工具（n8n_sandbox_*）。 */
  enabled: boolean
  /** n8n 镜像。 */
  image: string
  /** 容器名。 */
  containerName: string
  /** 宿主端口（仅绑定 127.0.0.1）。 */
  hostPort: number
  /** 容器内 n8n 端口。 */
  containerPort: number
  /** 数据卷名（挂到 /home/node/.n8n）。 */
  dataVolume: string
  /** 容器时区。 */
  timezone: string
}

export interface Config {
  /** n8n 实例基址（可留空：改用环境变量 N8N_BASE_URL 或沙箱端点）。 */
  baseUrl?: string
  /** n8n 公开 API Key（敏感）。建议改用环境变量 N8N_API_KEY，避免写入配置文件。 */
  apiKey?: string
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
  /** 容器沙箱配置。 */
  sandbox: SandboxOptions
}

export const Config: Schema<Config> = Schema.object({
  baseUrl: Schema.string(),
  apiKey: Schema.string(),
  webhookAuthHeader: Schema.string(),
  webhookAuthValue: Schema.string(),
  allowedWebhookPaths: Schema.array(Schema.string()).default([]),
  timeoutMs: Schema.number().default(30_000),
  useTestWebhook: Schema.boolean().default(false),
  sandbox: Schema.object({
    enabled: Schema.boolean().default(false),
    image: Schema.string().default('docker.n8n.io/n8nio/n8n:latest'),
    containerName: Schema.string().default('dsh-n8n-lg'),
    hostPort: Schema.number().default(5679),
    containerPort: Schema.number().default(5678),
    dataVolume: Schema.string().default('dsh-n8n-lg-data'),
    timezone: Schema.string().default('Asia/Shanghai')
  }).default({})
})
