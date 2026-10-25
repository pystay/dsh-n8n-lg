/**
 * n8n 画布的真实视觉还原。
 *
 * 参考 n8n 2.x 深色模式：点阵网格、圆角节点、左侧彩色图标块、
 * 贝塞尔连线、运行态绿色流动。这些细节是"实机感"的来源。
 */
import React from 'react'
import { interpolate } from 'remotion'
import { FONT } from './constants'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** n8n 各节点类型的标志色（取 n8n 官方图标配色）。 */
export const NODE_COLORS: Record<string, string> = {
  webhook: '#ff6d5a',
  http: '#2f8bff',
  code: '#f7b93e',
  db: '#e8547e',
  if: '#8b6cf0',
  set: '#4ec9a8',
  slack: '#4a154b',
  email: '#d44638',
}

export interface CanvasNode {
  id: string
  name: string
  type: string
  /** 图标块里显示的字（单字或缩写） */
  glyph: string
  x: number
  y: number
  /** 出现进度 0-1（由场景控制） */
  appear?: number
  /** 运行状态 */
  state?: 'idle' | 'running' | 'done' | 'error'
  /** 刚被修改时的高亮 0-1 */
  changed?: number
}

export interface CanvasEdge {
  from: string
  to: string
  /** 生长进度 0-1 */
  grow?: number
  /** 数据流动进度 0-1（运行态） */
  flow?: number
}

export const NODE_W = 168
export const NODE_H = 64

/** 画布背景：点阵网格 + 暗角。 */
export const CanvasBackdrop: React.FC<{ width: number; height: number }> = ({ width, height }) => (
  <>
    <defs>
      <pattern id="dots" width={22} height={22} patternUnits="userSpaceOnUse">
        <circle cx={1.4} cy={1.4} r={1.4} fill="rgba(255,255,255,0.13)" />
      </pattern>
      <radialGradient id="vignette" cx="50%" cy="45%" r="72%">
        <stop offset="55%" stopColor="rgba(0,0,0,0)" />
        <stop offset="100%" stopColor="rgba(0,0,0,0.45)" />
      </radialGradient>
    </defs>
    <rect width={width} height={height} fill="#14161d" />
    <rect width={width} height={height} fill="url(#dots)" />
    <rect width={width} height={height} fill="url(#vignette)" />
  </>
)

/** 单个节点。出现时从 0.86 弹性放大，运行完成后边框转绿。 */
export const Node: React.FC<{ node: CanvasNode; frame: number }> = ({ node, frame }) => {
  const appear = node.appear ?? 1
  const scale = interpolate(appear, [0, 1], [0.86, 1], clamp)
  const opacity = interpolate(appear, [0, 0.6], [0, 1], clamp)
  const accent = NODE_COLORS[node.type] ?? '#8a93a6'

  const stateColor =
    node.state === 'done'
      ? '#3ddc84'
      : node.state === 'running'
        ? '#ffc247'
        : node.state === 'error'
          ? '#ff5c6c'
          : 'rgba(255,255,255,0.18)'

  // 刚出现/刚改过时，外圈有一层扩散光晕
  const pulse = node.appear !== undefined && appear < 1 ? 1 - appear : 0
  const glow = Math.max(pulse * 0.55, node.changed ?? 0)

  return (
    <g
      transform={`translate(${node.x} ${node.y}) scale(${scale})`}
      opacity={opacity}
      style={{ transformOrigin: `${NODE_W / 2}px ${NODE_H / 2}px` }}
    >
      {glow > 0.01 ? (
        <rect
          x={-6 - glow * 10}
          y={-6 - glow * 10}
          width={NODE_W + 12 + glow * 20}
          height={NODE_H + 12 + glow * 20}
          rx={14}
          fill="none"
          stroke={node.changed ? '#3ddc84' : accent}
          strokeWidth={2}
          opacity={glow * 0.7}
        />
      ) : null}

      {/* 主体 */}
      <rect
        width={NODE_W}
        height={NODE_H}
        rx={10}
        fill="#232733"
        stroke={node.state === 'done' ? stateColor : 'rgba(255,255,255,0.16)'}
        strokeWidth={node.state && node.state !== 'idle' ? 1.8 : 1.2}
      />

      {/* 左侧图标块 */}
      <rect x={8} y={8} width={48} height={48} rx={8} fill={accent} opacity={0.92} />
      <text
        x={32}
        y={40}
        textAnchor="middle"
        fill="#fff"
        fontFamily={FONT.sans}
        fontSize={20}
        fontWeight={700}
      >
        {node.glyph}
      </text>

      {/* 名称与类型 */}
      <text x={66} y={30} fill="#e9edf7" fontFamily={FONT.sans} fontSize={14} fontWeight={600}>
        {node.name.length > 13 ? `${node.name.slice(0, 12)}…` : node.name}
      </text>
      <text x={66} y={47} fill="#8a93a6" fontFamily={FONT.mono} fontSize={10.5}>
        {node.type}
      </text>

      {/* 右上角状态勾 */}
      {node.state === 'done' ? (
        <circle cx={NODE_W - 14} cy={14} r={8} fill="#3ddc84" />
      ) : null}
      {node.state === 'done' ? (
        <text x={NODE_W - 14} y={18} textAnchor="middle" fill="#14161d" fontSize={11} fontWeight={700}>
          ✓
        </text>
      ) : null}
    </g>
  )
}

/** 计算两个节点之间的贝塞尔路径。 */
export function edgePath(from: CanvasNode, to: CanvasNode): string {
  const x1 = from.x + NODE_W
  const y1 = from.y + NODE_H / 2
  const x2 = to.x
  const y2 = to.y + NODE_H / 2
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

/** 连线：grow 控制生长，flow 控制运行时的绿色流动。 */
export const Edge: React.FC<{
  from: CanvasNode
  to: CanvasNode
  grow?: number
  flow?: number
  frame: number
}> = ({ from, to, grow = 1, flow = 0, frame }) => {
  const d = edgePath(from, to)
  const approxLen = Math.hypot(to.x - from.x, to.y - from.y) + 60

  return (
    <g>
      {/* 底：灰色连线，按 grow 生长 */}
      <path
        d={d}
        fill="none"
        stroke="rgba(150,170,220,0.55)"
        strokeWidth={2}
        strokeDasharray={approxLen}
        strokeDashoffset={approxLen * (1 - grow)}
        opacity={grow > 0 ? 1 : 0}
      />

      {/* 运行态：绿色虚线沿路径流动 */}
      {flow > 0 ? (
        <path
          d={d}
          fill="none"
          stroke="#3ddc84"
          strokeWidth={2.6}
          strokeDasharray="7 13"
          strokeDashoffset={-frame * 2.4}
          opacity={flow * 0.95}
        />
      ) : null}
    </g>
  )
}

/**
 * n8n 编辑器顶部工具栏。
 * 有这条栏，画面才像"编辑器"而不是一块黑板。
 */
export const TopBar: React.FC<{
  name: string
  status?: string
  action?: { label: string; tone: 'accent' | 'warn' | 'ok' }
  opacity?: number
}> = ({ name, status = '已保存', action, opacity = 1 }) => {
  const tone =
    action?.tone === 'ok'
      ? { bg: 'rgba(61,220,132,0.18)', border: '#3ddc84', fg: '#3ddc84' }
      : action?.tone === 'warn'
        ? { bg: 'rgba(255,194,71,0.18)', border: '#ffc247', fg: '#ffc247' }
        : { bg: 'rgba(96,140,255,0.9)', border: '#608cff', fg: '#ffffff' }

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 66,
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '0 26px',
        backgroundColor: 'rgba(20,22,29,0.92)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        opacity,
      }}
    >
      {/* 左侧 logo 方块，n8n 工具栏的锚点 */}
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: 'linear-gradient(135deg, #ff6d5a, #e8547e)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: FONT.mono,
          fontSize: 13,
          fontWeight: 700,
          color: '#fff',
        }}
      >
        n8
      </div>
      <span style={{ fontFamily: FONT.sans, fontSize: 17, color: '#e9edf7', fontWeight: 600 }}>{name}</span>
      <span style={{ fontFamily: FONT.sans, fontSize: 13, color: '#8a93a6' }}>{status}</span>
      <div style={{ flex: 1 }} />
      {action ? (
        <div
          style={{
            padding: '8px 16px',
            borderRadius: 7,
            backgroundColor: tone.bg,
            border: `1px solid ${tone.border}`,
            fontFamily: FONT.sans,
            fontSize: 14,
            fontWeight: 600,
            color: tone.fg,
            whiteSpace: 'nowrap',
          }}
        >
          {action.label}
        </div>
      ) : null}
    </div>
  )
}
