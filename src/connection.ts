/**
 * 连接管理器：全插件**唯一**的 n8n 连接来源。
 *
 * 为什么需要它：此前 HUD 路由与 AI 工具各自解析连接信息，导致两个真实问题：
 *  1. 只覆盖地址时会沿用另一实例的 API Key（密钥可能被发到错误主机）；
 *  2. 在浮窗里填写的配置对 AI 工具不可见（工具仍用旧的/空的连接）。
 *
 * 现在统一走这里：
 *  - 解析顺序：运行时覆盖（浮窗填写）→ config → 环境变量 → 沙箱端点
 *  - 地址与密钥**成对**返回，绝不跨实例拼接
 *  - 对前端只暴露脱敏状态（仅 origin），不返回密钥
 */
import type { Config } from './config.js'
import { tryResolveConnection, type ResolvedConnection } from './config-resolve.js'
import { N8nClient } from './n8n/client.js'

export type ConnectionSource = 'runtime' | 'config' | 'env' | 'sandbox'

export interface ConnectionStatus {
  /** 是否已经具备可用的地址 + 密钥。 */
  configured: boolean
  /** 脱敏后的地址（仅协议 + 主机 + 端口）；未配置为 null。 */
  baseUrl: string | null
  /** 连接来自哪里，便于用户理解为什么“填了没生效”。 */
  source: ConnectionSource | null
}

/** 只暴露 origin，隐藏路径与查询串，避免泄漏内网结构。 */
export function maskBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin
  } catch {
    return '(invalid)'
  }
}

/** 校验并规范化用户填写的 n8n 地址（抛错表示非法）。 */
export function normalizeBaseUrl(input: string): string {
  const trimmed = (input ?? '').trim()
  if (!trimmed) throw new Error('n8n 地址不能为空')
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error(`n8n 地址不是合法 URL：${trimmed}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('n8n 地址必须以 http:// 或 https:// 开头')
  }
  return trimmed.replace(/\/+$/, '')
}

/** 工具层只依赖这个最小接口，便于测试注入假客户端。 */
export interface ClientProvider {
  client(): N8nClient
}

export class ConnectionManager implements ClientProvider {
  private runtime?: ResolvedConnection

  constructor(
    readonly config: Config,
    private readonly env: Record<string, string | undefined> = process.env
  ) {}

  /** 浮窗保存连接后调用；仅存内存，不落盘。 */
  setRuntime(conn: ResolvedConnection): void {
    this.runtime = { ...conn }
  }

  clearRuntime(): void {
    this.runtime = undefined
  }

  hasRuntime(): boolean {
    return Boolean(this.runtime)
  }

  private source(): ConnectionSource | null {
    if (this.runtime) return 'runtime'
    if (this.config.baseUrl?.trim()) return 'config'
    if (this.env.N8N_BASE_URL?.trim()) return 'env'
    if (this.config.sandbox?.enabled) return 'sandbox'
    return null
  }

  /** 宽松解析：未配置返回 undefined。 */
  resolve(): ResolvedConnection | undefined {
    if (this.runtime) return { ...this.runtime }
    return tryResolveConnection(this.config, this.env)
  }

  /** 严格解析：未配置抛错（错误信息可直接展示给用户）。 */
  require(): ResolvedConnection {
    const conn = this.resolve()
    if (!conn) {
      throw new Error(
        '尚未配置 n8n 连接：请在玻璃浮窗里填写地址与 API Key，或设置环境变量 N8N_BASE_URL / N8N_API_KEY'
      )
    }
    return conn
  }

  /** 供前端展示的脱敏状态。 */
  status(): ConnectionStatus {
    const conn = this.resolve()
    return {
      configured: Boolean(conn),
      baseUrl: conn ? maskBaseUrl(conn.baseUrl) : null,
      source: conn ? this.source() : null
    }
  }

  /** 构造 n8n 客户端（含 Webhook Header 鉴权，与工具侧一致）。 */
  client(): N8nClient {
    const conn = this.require()
    return new N8nClient({
      baseUrl: conn.baseUrl,
      apiKey: conn.apiKey,
      timeoutMs: this.config.timeoutMs,
      webhookAuth:
        this.config.webhookAuthHeader && this.config.webhookAuthValue
          ? { header: this.config.webhookAuthHeader, value: this.config.webhookAuthValue }
          : undefined
    })
  }
}
