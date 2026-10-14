/** 工具层公共工具：统一的 JSON 输出与渲染。 */
import type { JsonValue } from '@deepseek-ai/dsh-tools'

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
