/**
 * Webhook 路径守卫（纯函数，便于单测）。
 *
 * 安全策略分两层：
 *  1. **路径本身必须安全**（{@link isSafeWebhookPath}）：拒绝点段、编码点段、
 *     反斜杠、查询串/片段、协议与协议相对写法。否则 `deploy/../other` 这类
 *     字符串能命中 `deploy/*` 白名单，却在 URL 解析后访问到别的前缀。
 *  2. **白名单**（{@link isWebhookPathAllowed}）：配置了 `allowedWebhookPaths`
 *     时只放行列表内路径（默认拒绝）；未配置时放行全部（MVP 开箱即用）。
 */

/** 规范化 webhook 路径：去掉首尾斜杠。 */
export function normalizeWebhookPath(path: string): string {
  return path.trim().replace(/^\/+/, '').replace(/\/+$/, '')
}

/**
 * 判断 webhook 路径是否安全（不会改变 URL 语义）。
 *
 * 这是白名单之外的第一道闸门：即使白名单为空（放行全部），
 * 危险路径也必须被拒绝。
 */
export function isSafeWebhookPath(path: string): boolean {
  if (typeof path !== 'string') return false
  const raw = path.trim()
  if (!raw) return false
  // 查询串 / 片段 / 反斜杠：都会改变实际请求目标
  if (/[?#\\]/.test(raw)) return false
  // 协议前缀（http:、file: 等）与协议相对写法（//evil.com）
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return false
  if (raw.startsWith('//')) return false

  for (const segment of normalizeWebhookPath(raw).split('/')) {
    if (!segment) continue
    if (!isSafeSegment(segment)) return false
  }
  return true
}

/** 单个路径段：不允许 `.` / `..`（含二次编码形式），也不允许段内出现分隔符。 */
function isSafeSegment(segment: string): boolean {
  let decoded = segment
  for (let depth = 0; depth < 2; depth += 1) {
    if (decoded === '.' || decoded === '..') return false
    if (decoded.includes('/') || decoded.includes('\\')) return false
    let next: string
    try {
      next = decodeURIComponent(decoded)
    } catch {
      // 非法百分号编码：保守拒绝
      return false
    }
    if (next === decoded) return true
    decoded = next
  }
  return decoded !== '.' && decoded !== '..'
}

/**
 * 判断某个 webhook 路径是否被允许。
 * - 路径不安全 → 一律拒绝
 * - `allowed` 为空 → 允许（MVP 默认）
 * - 否则：精确匹配，或 `allowed` 中带 `*` 的项按通配匹配（`*` 匹配任意字符）
 */
export function isWebhookPathAllowed(path: string, allowed?: string[]): boolean {
  if (!isSafeWebhookPath(path)) return false
  if (!allowed || allowed.length === 0) return true
  const target = normalizeWebhookPath(path)
  return allowed.some((rule) => matchRule(target, normalizeWebhookPath(rule)))
}

function matchRule(target: string, rule: string): boolean {
  if (rule === target) return true
  if (!rule.includes('*')) return false
  // 将 `*` 视为通配符，其余字符转义后构造正则。
  const pattern = '^' + rule.split('*').map(escapeRegExp).join('.*') + '$'
  return new RegExp(pattern).test(target)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 构造 Webhook 请求 URL，并校验最终 URL 仍落在**同一源站**与**同一前缀**内。
 * 这是纵深防御的第二层：即便路径通过了白名单，解析后的 URL 也必须自证没有越界。
 */
export function buildWebhookUrl(
  baseUrl: string,
  webhookPath: string,
  options: { test?: boolean } = {}
): string {
  if (!isSafeWebhookPath(webhookPath)) {
    throw new Error(`Webhook 路径不安全（含点段/分隔符/查询串等）：${webhookPath}`)
  }
  const prefix = options.test ? 'webhook-test' : 'webhook'
  const base = baseUrl.trim().replace(/\/+$/, '')
  const basePath = new URL(base).pathname.replace(/\/+$/, '')
  const expectedPrefix = `${basePath}/${prefix}/`

  const url = new URL(`${base}/${prefix}/${normalizeWebhookPath(webhookPath)}`)
  if (url.origin !== new URL(base).origin) {
    throw new Error('Webhook URL 越过了 n8n 源站')
  }
  if (!url.pathname.startsWith(expectedPrefix)) {
    throw new Error('Webhook URL 越过了预期前缀')
  }
  return url.toString()
}
