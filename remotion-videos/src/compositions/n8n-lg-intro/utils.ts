/**
 * 动画小工具。
 *
 * 全部基于 frame 计算 —— Remotion 里不能用 CSS transition/animation，
 * 否则逐帧渲染时状态是不确定的。
 */
import { interpolate, spring } from 'remotion'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** 淡入 + 上浮，最常用的入场。 */
export function fadeUp(frame: number, start: number, duration = 18, distance = 26) {
  return {
    opacity: interpolate(frame, [start, start + duration], [0, 1], clamp),
    transform: `translateY(${interpolate(frame, [start, start + duration + 4], [distance, 0], clamp)}px)`,
  }
}

/** 淡入 + 从左侧滑入。 */
export function fadeRight(frame: number, start: number, duration = 18, distance = 40) {
  return {
    opacity: interpolate(frame, [start, start + duration], [0, 1], clamp),
    transform: `translateX(${interpolate(frame, [start, start + duration + 4], [-distance, 0], clamp)}px)`,
  }
}

/** 淡入 + 缩放，适合数字/卡片。 */
export function popIn(frame: number, fps: number, start: number, damping = 14) {
  const s = spring({ frame: frame - start, fps, config: { damping, stiffness: 160 } })
  return {
    opacity: interpolate(frame, [start, start + 10], [0, 1], clamp),
    transform: `scale(${interpolate(s, [0, 1], [0.86, 1])})`,
  }
}

/** 列表逐条出现（错开）。 */
export function stagger(frame: number, index: number, gap = 10, duration = 16) {
  const start = index * gap
  return {
    opacity: interpolate(frame, [start, start + duration], [0, 1], clamp),
    transform: `translateX(${interpolate(frame, [start, start + duration + 4], [-26, 0], clamp)}px)`,
  }
}

/** 打字机：按帧数截断字符串。 */
export function typewriter(frame: number, text: string, start: number, charsPerFrame = 1.1) {
  const n = Math.max(0, Math.floor((frame - start) * charsPerFrame))
  return text.slice(0, Math.min(n, text.length))
}

/** 数字滚动到目标值。 */
export function countUp(frame: number, target: number, start: number, duration = 24) {
  const p = interpolate(frame, [start, start + duration], [0, 1], clamp)
  return Math.round(target * p)
}

/** 场景整体淡出（结尾用）。 */
export function fadeOut(frame: number, total: number, tail = 12) {
  return interpolate(frame, [total - tail, total], [1, 0], clamp)
}
