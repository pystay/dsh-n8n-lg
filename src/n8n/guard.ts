/**
 * Webhook 白名单守卫（纯函数，便于单测）。
 *
 * 安全策略：配置了 allowedWebhookPaths 时只放行列表内路径（默认拒绝）；
 * 未配置（空数组/undefined）时放行全部——便于 MVP 开箱即用，生产建议显式配置。
 */

/** 规范化 webhook 路径：去掉首尾斜杠。 */
export function normalizeWebhookPath(path: string): string {
  return path.trim().replace(/^\/+/, '').replace(/\/+$/, '')
}

/**
 * 判断某个 webhook 路径是否被允许。
 * - `allowed` 为空 → 允许（MVP 默认）
 * - 否则：精确匹配，或 `allowed` 中带 `*` 的项按通配匹配（`*` 匹配任意字符）。
 */
export function isWebhookPathAllowed(path: string, allowed?: string[]): boolean {
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
