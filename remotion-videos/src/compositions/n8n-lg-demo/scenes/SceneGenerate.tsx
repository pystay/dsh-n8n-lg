import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { BRAND, CONTENT, FONT } from '../constants'
import { CanvasBackdrop, Edge, Node, type CanvasNode } from '../Canvas'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** 每个节点出现的帧（相对本场景）。 */
const NODE_APPEAR = { a: 40, b: 160, c: 400 }
const LINK_GROW = { l1: 280, l2: 520 }

/** 8 条 AI 日志各自出现的帧。 */
const LOG_AT = [8, 48, 108, 168, 228, 348, 408, 528]

export const SceneGenerate: React.FC = () => {
  const frame = useCurrentFrame()

  const mk = (
    id: string,
    name: string,
    type: string,
    glyph: string,
    x: number,
    y: number,
    at: number
  ): CanvasNode => ({
    id,
    name,
    type,
    glyph,
    x,
    y,
    appear: interpolate(frame, [at, at + 16], [0, 1], clamp),
  })

  const nodes = [
    mk('a', 'Webhook', 'webhook', '钩', 130, 330, NODE_APPEAR.a),
    mk('b', 'HTTP Request', 'http', 'HT', 380, 330, NODE_APPEAR.b),
    mk('c', 'Database', 'db', 'DB', 630, 330, NODE_APPEAR.c),
  ]

  const l1 = interpolate(frame, [LINK_GROW.l1, LINK_GROW.l1 + 26], [0, 1], clamp)
  const l2 = interpolate(frame, [LINK_GROW.l2, LINK_GROW.l2 + 26], [0, 1], clamp)

  // 整体进度：按"节点+连线"的完成度算，不是假进度条
  const progress = interpolate(
    frame,
    [0, NODE_APPEAR.a, NODE_APPEAR.b, LINK_GROW.l1, NODE_APPEAR.c, LINK_GROW.l2, 600],
    [0, 0.14, 0.34, 0.5, 0.72, 0.9, 1],
    clamp
  )
  const finished = frame >= 600

  const visibleLogs = LOG_AT.map((at, i) => ({ text: CONTENT.aiSteps[i]!, at, show: frame >= at })).filter(
    (x) => x.show
  )

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg }}>
      {/* 顶部：生成进度条 */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          backgroundColor: 'rgba(255,255,255,0.06)',
          opacity: interpolate(frame, [0, 14], [0, 1], clamp),
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progress * 100}%`,
            background: finished
              ? `linear-gradient(90deg, ${BRAND.ok}, ${BRAND.ok})`
              : `linear-gradient(90deg, ${BRAND.accent}, ${BRAND.ok})`,
          }}
        />
      </div>

      <div style={{ display: 'flex', height: '100%' }}>
        {/* 左：画布 */}
        <div style={{ flex: 1, position: 'relative' }}>
          <svg width="100%" height="100%" viewBox="0 0 1000 760" style={{ position: 'absolute', inset: 0 }}>
            <CanvasBackdrop width={1000} height={760} />
            {l1 > 0 ? <Edge from={nodes[0]!} to={nodes[1]!} grow={l1} frame={frame} /> : null}
            {l2 > 0 ? <Edge from={nodes[1]!} to={nodes[2]!} grow={l2} frame={frame} /> : null}
            {nodes.map((n) => (n.appear! > 0 ? <Node key={n.id} node={n} frame={frame} /> : null))}
          </svg>

          {/* 画布左上角：状态标签 */}
          <div
            style={{
              position: 'absolute',
              top: 40,
              left: 48,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 18px',
              borderRadius: 999,
              backgroundColor: finished ? 'rgba(61,220,132,0.14)' : 'rgba(96,140,255,0.14)',
              border: `1px solid ${finished ? 'rgba(61,220,132,0.5)' : 'rgba(96,140,255,0.45)'}`,
              fontFamily: FONT.sans,
              fontSize: 19,
              color: finished ? BRAND.ok : BRAND.accent,
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                backgroundColor: finished ? BRAND.ok : BRAND.accent,
                // 生成中闪烁，完成后常亮
                opacity: finished ? 1 : interpolate(frame % 24, [0, 12, 24], [1, 0.25, 1]),
              }}
            />
            {finished ? '生成完成 · 校验通过' : 'AI 正在生成…'}
          </div>
        </div>

        {/* 右：AI 日志面板 */}
        <div
          style={{
            width: 470,
            backgroundColor: '#16181f',
            borderLeft: `1px solid ${BRAND.border}`,
            padding: '46px 30px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              fontFamily: FONT.sans,
              fontSize: 15,
              color: BRAND.textFaint,
              letterSpacing: 1.4,
              marginBottom: 22,
            }}
          >
            AI 操作记录
          </div>

          <div style={{ flex: 1, overflow: 'hidden' }}>
            {visibleLogs.map((log, i) => {
              const age = frame - log.at
              const isLast = i === visibleLogs.length - 1
              const done = !isLast || finished
              return (
                <div
                  key={log.text}
                  style={{
                    display: 'flex',
                    gap: 12,
                    alignItems: 'flex-start',
                    marginBottom: 16,
                    opacity: interpolate(age, [0, 10], [0, 1], clamp),
                    transform: `translateX(${interpolate(age, [0, 12], [14, 0], clamp)}px)`,
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      border: `1.6px solid ${done ? BRAND.ok : BRAND.warn}`,
                      backgroundColor: done ? BRAND.ok : 'transparent',
                      color: '#12141c',
                      fontSize: 11,
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      marginTop: 2,
                    }}
                  >
                    {done ? '✓' : ''}
                  </span>
                  <span
                    style={{
                      fontFamily: FONT.sans,
                      fontSize: 19,
                      lineHeight: 1.45,
                      color: done ? BRAND.textDim : BRAND.text,
                    }}
                  >
                    {log.text}
                  </span>
                </div>
              )
            })}
          </div>

          {/* 底部：节点/连线计数 */}
          <div
            style={{
              paddingTop: 18,
              borderTop: `1px solid ${BRAND.border}`,
              fontFamily: FONT.mono,
              fontSize: 16,
              color: BRAND.textFaint,
            }}
          >
            {nodes.filter((n) => n.appear! >= 1).length} 节点 ·{' '}
            {(l1 >= 1 ? 1 : 0) + (l2 >= 1 ? 1 : 0)} 连线
          </div>
        </div>
      </div>
    </AbsoluteFill>
  )
}
