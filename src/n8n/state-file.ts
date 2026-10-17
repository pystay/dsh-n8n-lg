/**
 * 极简的 JSON 状态文件读写。
 *
 * 只做两件事，但这两件都容易做错：
 *  1. **原子写** —— 先写 `.tmp` 再 rename。进程在写一半被杀时，rename 是原子的，
 *     原文件要么是旧的完整内容、要么是新的完整内容，不会变成半截 JSON。
 *  2. **容错读** —— 文件不存在 / 空 / 不是合法 JSON / 结构不对，一律返回兜底值。
 *     「上次的数据坏了」不该把插件搞崩 —— 丢快照比插件起不来轻得多。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** 读 JSON；任何异常都退化为 fallback。 */
export function readJsonFile<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback
    const text = readFileSync(path, 'utf8')
    if (!text.trim()) return fallback
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

/**
 * 原子写 JSON。
 * @returns 是否写入成功（调用方可以据此提示「持久化不可用」，但不必中断主流程）。
 */
export function writeJsonFile(path: string, value: unknown): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.tmp`
    writeFileSync(tmp, JSON.stringify(value), 'utf8')
    renameSync(tmp, path)
    return true
  } catch {
    return false
  }
}
