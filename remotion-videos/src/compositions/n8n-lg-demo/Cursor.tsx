/**
 * 鼠标光标与点击涟漪。
 *
 * 实机感的另一半来自"有人在操作"——光标要真的移动、按下、拖动。
 */
import React from 'react'
import { interpolate } from 'remotion'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export const Cursor: React.FC<{
  x: number
  y: number
  /** 0-1：按下时的缩放反馈 */
  press?: number
  /** 0-1：点击涟漪进度，0 表示不显示 */
  ripple?: number
  /** 拖动中显示抓取态 */
  dragging?: boolean
  opacity?: number
}> = ({ x, y, press = 0, ripple = 0, dragging = false, opacity = 1 }) => {
  const scale = interpolate(press, [0, 1], [1, 0.86], clamp)

  return (
    <g opacity={opacity} transform={`translate(${x} ${y})`}>
      {/* 涟漪：点击后向外扩散并淡出 */}
      {ripple > 0 && ripple < 1 ? (
        <>
          <circle
            r={interpolate(ripple, [0, 1], [6, 34], clamp)}
            fill="none"
            stroke="rgba(96,140,255,0.75)"
            strokeWidth={2}
            opacity={interpolate(ripple, [0, 0.7, 1], [0.9, 0.35, 0], clamp)}
          />
          <circle
            r={interpolate(ripple, [0, 1], [2, 12], clamp)}
            fill="rgba(96,140,255,0.28)"
            opacity={interpolate(ripple, [0, 1], [0.8, 0], clamp)}
          />
        </>
      ) : null}

      <g transform={`scale(${scale})`}>
        {/* 标准箭头光标 */}
        <path
          d="M 0 0 L 0 22 L 5.5 16.5 L 9.5 25 L 13 23.5 L 9 15 L 16 15 Z"
          fill="#ffffff"
          stroke="#1a1e2c"
          strokeWidth={1.4}
          strokeLinejoin="round"
        />
        {dragging ? (
          <circle cx={-3} cy={-3} r={9} fill="none" stroke="rgba(96,140,255,0.6)" strokeWidth={1.5} />
        ) : null}
      </g>
    </g>
  )
}

/** 在一组关键帧之间做缓动移动，返回当前坐标。 */
export function cursorPath(
  frame: number,
  keys: Array<{ at: number; x: number; y: number }>
): { x: number; y: number } {
  if (keys.length === 0) return { x: 0, y: 0 }
  if (frame <= keys[0]!.at) return { x: keys[0]!.x, y: keys[0]!.y }
  const last = keys[keys.length - 1]!
  if (frame >= last.at) return { x: last.x, y: last.y }

  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!
    const b = keys[i + 1]!
    if (frame >= a.at && frame <= b.at) {
      const t = interpolate(frame, [a.at, b.at], [0, 1], clamp)
      // 缓入缓出，避免光标匀速平移显得机械
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e }
    }
  }
  return { x: last.x, y: last.y }
}
