import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { BRAND, FONT } from '../constants'
import { fadeUp, popIn, typewriter } from '../utils'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

const PROMPT = '帮我做个工作流：收到 webhook 后调用天气 API，把结果写进数据库'
const STEPS = ['读取现有结构', '追加节点并连线', '写前校验通过']

/** 节点在画布上的位置（相对画布左上角）。 */
const NODES = [
  { id: 'webhook', label: 'Webhook', kind: 'webhook', x: 30, y: 150 },
  { id: 'http', label: 'HTTP', kind: 'http', x: 250, y: 150 },
  { id: 'db', label: 'Database', kind: 'db', x: 470, y: 150 },
]

export const SceneBuild: React.FC = () => {
  const frame = useCurrentFrame()

  // 打字机：约 2.2 秒打完
  const typed = typewriter(frame, PROMPT, 16, 1.5)
  const typingDone = typed.length >= PROMPT.length

  // 节点依次出现：打完字之后
  const nodeStart = 96
  const visibleNodes = NODES.map((n, i) => {
    const start = nodeStart + i * 18
    return { ...n, show: frame >= start, start }
  })

  // 连线：节点都出来之后
  const edgeStart = nodeStart + NODES.length * 18 + 8
  const edgeProgress = (idx: number) =>
    interpolate(frame, [edgeStart + idx * 14, edgeStart + idx * 14 + 18], [0, 1], clamp)

  // 进度时间线
  const stepStart = edgeStart + 34

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg, padding: '70px 90px' }}>
      <div style={{ fontFamily: FONT.sans, fontSize: 38, fontWeight: 600, color: BRAND.text, ...fadeUp(frame, 2, 16) }}>
        说一句话，AI 直接把工作流搭出来
      </div>

      {/* 输入框 */}
      <div
        style={{
          marginTop: 28,
          padding: '20px 24px',
          borderRadius: 14,
          border: `1px solid ${typingDone ? BRAND.accent : BRAND.borderStrong}`,
          backgroundColor: BRAND.bgSoft,
          fontFamily: FONT.sans,
          fontSize: 23,
          color: BRAND.text,
          minHeight: 34,
          display: 'flex',
          alignItems: 'center',
          ...fadeUp(frame, 8, 16),
        }}
      >
        <span style={{ color: BRAND.accent, marginRight: 12, fontFamily: FONT.mono }}>{'>'}</span>
        <span>{typed}</span>
        {/* 光标：平滑闪烁，不用硬跳 */}
        <span
          style={{
            display: 'inline-block',
            width: 2,
            height: 24,
            marginLeft: 4,
            backgroundColor: BRAND.accent,
            opacity: typingDone ? 0 : interpolate(frame % 30, [0, 15, 30], [1, 0.1, 1]),
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 28, marginTop: 30, flex: 1 }}>
        {/* 画布 */}
        <div
          style={{
            flex: 1,
            borderRadius: 14,
            border: `1px solid ${BRAND.border}`,
            backgroundColor: 'rgba(10,12,20,0.6)',
            position: 'relative',
            overflow: 'hidden',
            ...fadeUp(frame, 14, 16),
          }}
        >
          <svg width="100%" height="100%" viewBox="0 0 640 340" style={{ position: 'absolute', inset: 0 }}>
            {/* 连线 */}
            {[0, 1].map((i) => {
              const p = edgeProgress(i)
              const from = NODES[i]!
              const to = NODES[i + 1]!
              const x1 = from.x + 140
              const y1 = from.y + 32
              const x2 = to.x
              const y2 = to.y + 32
              const cx = (x1 + x2) / 2
              const len = Math.hypot(x2 - x1, y2 - y1) * p
              return (
                <path
                  key={i}
                  d={`M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={BRAND.accent}
                  strokeWidth={2.2}
                  strokeDasharray={len}
                  strokeDashoffset={0}
                  opacity={p > 0 ? 0.85 : 0}
                />
              )
            })}

            {/* 节点 */}
            {visibleNodes.map((n) =>
              n.show ? (
                <g key={n.id}>
                  <rect
                    x={n.x}
                    y={n.y}
                    width={140}
                    height={64}
                    rx={12}
                    fill={BRAND.panel}
                    stroke={BRAND.accent}
                    strokeWidth={1.6}
                    opacity={interpolate(frame, [n.start, n.start + 12], [0, 1], clamp)}
                  />
                  <text
                    x={n.x + 16}
                    y={n.y + 27}
                    fill={BRAND.text}
                    fontFamily={FONT.sans}
                    fontSize={16}
                    fontWeight={600}
                    opacity={interpolate(frame, [n.start, n.start + 12], [0, 1], clamp)}
                  >
                    {n.label}
                  </text>
                  <text
                    x={n.x + 16}
                    y={n.y + 47}
                    fill={BRAND.textFaint}
                    fontFamily={FONT.mono}
                    fontSize={11}
                    opacity={interpolate(frame, [n.start, n.start + 12], [0, 1], clamp)}
                  >
                    {n.kind}
                  </text>
                </g>
              ) : null
            )}
          </svg>

          <div
            style={{
              position: 'absolute',
              left: 16,
              bottom: 12,
              fontFamily: FONT.sans,
              fontSize: 15,
              color: BRAND.textFaint,
            }}
          >
            {visibleNodes.filter((n) => n.show).length} 个节点 · {edgeProgress(0) > 0 ? 2 : 0} 条连线
          </div>
        </div>

        {/* 右侧：AI 的动作时间线 */}
        <div style={{ width: 380 }}>
          <div
            style={{
              fontFamily: FONT.sans,
              fontSize: 17,
              color: BRAND.textFaint,
              letterSpacing: 1,
              marginBottom: 16,
            }}
          >
            AI 正在做
          </div>
          {STEPS.map((s, i) => {
            const start = stepStart + i * 22
            const done = frame >= start + 14
            const active = frame >= start && !done
            return (
              <div
                key={s}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 0',
                  opacity: interpolate(frame, [start, start + 10], [0.25, 1], clamp),
                }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    border: `2px solid ${done ? BRAND.ok : active ? BRAND.warn : BRAND.borderStrong}`,
                    backgroundColor: done ? BRAND.ok : 'transparent',
                    color: BRAND.bg,
                    fontSize: 13,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {done ? '✓' : ''}
                </span>
                <span
                  style={{
                    fontFamily: FONT.sans,
                    fontSize: 21,
                    color: done ? BRAND.text : BRAND.textDim,
                  }}
                >
                  {s}
                </span>
              </div>
            )
          })}

          {/* 快照提示 */}
          <div
            style={{
              marginTop: 18,
              padding: '12px 16px',
              borderRadius: 10,
              backgroundColor: 'rgba(61,220,132,0.10)',
              border: '1px solid rgba(61,220,132,0.35)',
              fontFamily: FONT.sans,
              fontSize: 17,
              color: BRAND.ok,
              ...popIn(frame, 30, stepStart + STEPS.length * 22 + 10),
            }}
          >
            已保存快照 · 可随时回滚
          </div>
        </div>
      </div>
    </AbsoluteFill>
  )
}
