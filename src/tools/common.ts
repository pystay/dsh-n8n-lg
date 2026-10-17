/** 工具层公共工具：统一的 JSON 输出与渲染。 */

/**
 * Canonical JSON 值（与 DSH 内部 `@deepseek-ai/dsh-util-values` 的 `JsonValue` 同构）。
 *
 * 为什么不直接从 dsh 包 import：
 *  - DSH 0.2.1-rc.2 起 `dsh-tools` 不再转发这个类型，它挪到了 `dsh-util-values`；
 *  - 而 `dsh-util-values` 是 `dsh-tools` 的**传递依赖**，不是本插件的直接依赖，
 *    在 pnpm 的隔离布局下直接 import 并不可靠（本地能过、别人装可能失败）。
 *
 * 定义本身是标准的递归 JSON 联合，与 DSH 的完全同构，结构类型天然兼容。
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

/** 输出为原样 JSON（DSH 要求 execute 返回 canonical lossless-JSON 值）。 */
export const jsonOutput = {
  schema: { type: 'json' as const },
  render: (_args: unknown, value: JsonValue): Array<{ type: 'text'; text: string }> => [
    { type: 'text', text: JSON.stringify(value, null, 2) }
  ]
}

/** 把任意可序列化值转为 DSH 要求的 JSON 值。 */
export function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}
