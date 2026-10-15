/**
 * 连接信息解析（纯函数，便于测试）。
 *
 * 密钥卫生：n8n 的 API Key 可以从**环境变量**读取，这样它可以完全不落配置文件、
 * 更不会被误提交到 Git。解析顺序（每一项都取「第一个非空值」）：
 *   baseUrl: config.baseUrl → env.N8N_BASE_URL → 沙箱端点（若启用沙箱）
 *   apiKey : config.apiKey  → env.N8N_API_KEY
 *
 * 注意：地址与密钥**必须成对解析**，缺失任一项都视为「未配置」，
 * 绝不允许把 A 实例的密钥配上 B 实例的地址。
 */
export interface ResolvableConnection {
  baseUrl?: string
  apiKey?: string
  sandbox?: { enabled?: boolean; hostPort?: number }
}

export interface ResolvedConnection {
  baseUrl: string
  apiKey: string
}

/**
 * 宽松解析：任一项缺失时返回 `undefined`（用于「是否已配置」判断与 HUD 状态展示）。
 */
export function tryResolveConnection(
  config: ResolvableConnection,
  env: Record<string, string | undefined> = process.env
): ResolvedConnection | undefined {
  const baseUrl = firstNonEmpty(config.baseUrl, env.N8N_BASE_URL, sandboxEndpoint(config))
  const apiKey = firstNonEmpty(config.apiKey, env.N8N_API_KEY)
  if (!baseUrl || !apiKey) return undefined
  return { baseUrl, apiKey }
}

/**
 * 严格解析：缺失时**响亮报错**（DSH 约定：配置错误要在加载时失败）。
 * 仅在明确需要连接、且希望失败可见的场合使用。
 */
export function resolveConnection(
  config: ResolvableConnection,
  env: Record<string, string | undefined> = process.env
): ResolvedConnection {
  const baseUrl = firstNonEmpty(config.baseUrl, env.N8N_BASE_URL, sandboxEndpoint(config))
  const apiKey = firstNonEmpty(config.apiKey, env.N8N_API_KEY)
  if (!baseUrl) {
    throw new Error('n8n baseUrl 未配置：请设置 config.baseUrl 或环境变量 N8N_BASE_URL')
  }
  if (!apiKey) {
    throw new Error('n8n apiKey 未配置：请设置 config.apiKey 或环境变量 N8N_API_KEY')
  }
  return { baseUrl, apiKey }
}

/** 若启用沙箱且未显式给 baseUrl，则用沙箱端点。 */
function sandboxEndpoint(config: ResolvableConnection): string | undefined {
  if (config.sandbox?.enabled) return `http://127.0.0.1:${config.sandbox.hostPort ?? 5679}`
  return undefined
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}
