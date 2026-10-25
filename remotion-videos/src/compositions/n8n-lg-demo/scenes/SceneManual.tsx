import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { BRAND, FONT } from '../constants'
import { CanvasBackdrop, Edge, NODE_H, NODE_W, Node, TopBar, type CanvasNode } from '../Canvas'
import { Cursor, cursorPath } from '../Cursor'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** 三次「拖出节点」的时间安排：按下 / 拖到 / 松开 */
const DRAGS = [
  { press: 24, drop: 96, from: { x: 620, y: 470 }, to: { x: 520, y: 470 } },
  { press: 108, drop: 180, from: { x: 840, y: 470 }, to: { x: 740, y: 470 } },
  { press: 192, drop: 264, from: { x: 1060, y: 470 }, to: { x: 960, y: 470 } },
]

const NODE_DEFS: Array<Omit<CanvasNode, 'x' | 'y'>> = [
  { id: 'a', name: 'Webhook', type: 'webhook', glyph: '钩' },
  { id: 'b', name: 'HTTP Request', type: 'http', glyph: 'HT' },
  { id: 'c', name: 'Database', type: 'db', glyph: 'DB' },
]

export const SceneManual: React.FC = () => {
  const frame = useCurrentFrame()

  // 每个节点的出现进度与位置：拖动期间跟随光标，松手后固定
  const nodes: CanvasNode[] = DRAGS.map((d, i) => {
    const def = NODE_DEFS[i]!
    const appear = interpolate(frame, [d.press, d.press + 8], [0, 1], clamp)
    // 拖拽阶段节点跟着光标走（光标位置 = 节点左上角 + 一点偏移）
    const dragT = interpolate(frame, [d.press, d.drop], [0, 1], clamp)
    const x = d.from.x + (d.to.x - d.from.x) * dragT
    const y = d.from.y + (d.to.y - d.from.y) * dragT
    return { ...def, x, y, appear }
  })

  // 连线：光标从节点右边缘拖到下一个节点左边缘
  const LINK1 = { start: 276, end: 318 }
  const LINK2 = { start: 320, end: 360 }

  const link1T = interpolate(frame, [LINK1.start, LINK1.end], [0, 1], clamp)
  const link2T = interpolate(frame, [LINK2.start, LINK2.end], [0, 1], clamp)

  // 光标路径：依次去三个拖拽起点，再连线
  const cursor = cursorPath(frame, [
    { at: 0, x: 1200, y: 760 },
    { at: 20, x: 620, y: 470 },
    { at: 96, x: 520, y: 470 },
    { at: 104, x: 840, y: 470 },
    { at: 180, x: 740, y: 470 },
    { at: 188, x: 1060, y: 470 },
    { at: 264, x: 960, y: 470 },
    { at: 272, x: 520 + NODE_W, y: 470 + NODE_H / 2 },
    { at: 318, x: 740, y: 470 + NODE_H / 2 },
    { at: 324, x: 740 + NODE_W, y: 470 + NODE_H / 2 },
    { at: 360, x: 960, y: 470 + NODE_H / 2 },
  ])

  const pressing = [24, 108, 192, 276, 320].some((t) => frame >= t && frame <= t + 6)
  const ripples = [24, 108, 192, 276, 320].map((t) =>
    frame >= t && frame <= t + 16 ? (frame - t) / 16 : 0
  )

  // 底部说明：分两段出现
  const line1 = interpolate(frame, [30, 50], [0, 1], clamp)
  const line2 = interpolate(frame, [150, 172], [0, 1], clamp)

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg }}>
      <TopBar name="天气同步" status="未保存" action={{ label: 'Save', tone: 'accent' }} opacity={interpolate(frame, [0, 16], [0, 1], clamp)} />

      <svg width="1920" height="1080" viewBox="380 200 1420 800" style={{ position: 'absolute', inset: 0 }}>
        <g>
          <CanvasBackdrop width={1920} height={1080} />

          {/* 已完成的连线 */}
          {link1T > 0 ? <Edge from={nodes[0]!} to={nodes[1]!} grow={link1T} frame={frame} /> : null}
          {link2T > 0 ? <Edge from={nodes[1]!} to={nodes[2]!} grow={link2T} frame={frame} /> : null}

          {/* 正在拖拽中的临时连线 */}
          {frame >= LINK1.start && frame < LINK1.end ? (
            <line
              x1={520 + NODE_W}
              y1={470 + NODE_H / 2}
              x2={cursor.x}
              y2={cursor.y}
              stroke="rgba(96,140,255,0.7)"
              strokeWidth={2}
              strokeDasharray="6 6"
            />
          ) : null}
          {frame >= LINK2.start && frame < LINK2.end ? (
            <line
              x1={740 + NODE_W}
              y1={470 + NODE_H / 2}
              x2={cursor.x}
              y2={cursor.y}
              stroke="rgba(96,140,255,0.7)"
              strokeWidth={2}
              strokeDasharray="6 6"
            />
          ) : null}

          {nodes.map((n, i) =>
            n.appear! > 0 ? <Node key={n.id} node={n} frame={frame} /> : null
          )}

          {ripples.map((r, i) => (r > 0 ? <Cursor key={i} x={cursor.x} y={cursor.y} ripple={r} opacity={0} /> : null))}
          <Cursor x={cursor.x} y={cursor.y} press={pressing ? 1 : 0} dragging={pressing} />
        </g>
      </svg>

      {/* 说明文字 */}
      <div
        style={{
          position: 'absolute',
          bottom: 92,
          left: 0,
          right: 0,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontFamily: FONT.sans,
            fontSize: 40,
            fontWeight: 600,
            color: BRAND.text,
            opacity: line1,
            transform: `translateY(${interpolate(line1, [0, 1], [16, 0])}px)`,
          }}
        >
          手动搭：拖节点、连线条、逐个填参数
        </div>
        <div
          style={{
            marginTop: 14,
            fontFamily: FONT.sans,
            fontSize: 24,
            color: BRAND.textFaint,
            opacity: line2,
          }}
        >
          一个能跑的三节点流程，几十次点击
        </div>
      </div>
    </AbsoluteFill>
  )
}
