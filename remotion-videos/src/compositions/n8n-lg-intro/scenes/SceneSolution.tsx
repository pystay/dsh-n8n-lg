import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { BRAND, CONTENT, FONT } from '../constants'
import { fadeUp, stagger } from '../utils'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export const SceneSolution: React.FC = () => {
  const frame = useCurrentFrame()

  // 从「AI」到「n8n」之间画一条线，表示打通
  const lineWidth = interpolate(frame, [22, 60], [0, 300], clamp)

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ width: 1400, textAlign: 'center' }}>
        <div
          style={{
            fontFamily: FONT.sans,
            fontSize: 48,
            fontWeight: 600,
            color: BRAND.text,
            ...fadeUp(frame, 4, 18),
          }}
        >
          把 n8n 直接交到 AI 手里
        </div>

        {/* AI —— n8n 的连接示意 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0,
            marginTop: 54,
            marginBottom: 58,
            ...fadeUp(frame, 14, 18),
          }}
        >
          <Node label="DSH · AI" tone={BRAND.accent} />
          <div
            style={{
              width: lineWidth,
              height: 3,
              background: `linear-gradient(90deg, ${BRAND.accent}, ${BRAND.ok})`,
              position: 'relative',
            }}
          >
            <div
              style={{
                position: 'absolute',
                right: -4,
                top: -5,
                width: 13,
                height: 13,
                borderRadius: '50%',
                backgroundColor: BRAND.ok,
                boxShadow: `0 0 16px ${BRAND.ok}`,
                opacity: lineWidth > 10 ? 1 : 0,
              }}
            />
          </div>
          <Node label="n8n" tone={BRAND.ok} />
        </div>

        <div style={{ display: 'flex', gap: 20, justifyContent: 'center' }}>
          {CONTENT.toolGroups.map((g, i) => (
            <div
              key={g.label}
              style={{
                width: 300,
                padding: '22px 20px',
                borderRadius: 14,
                border: `1px solid ${BRAND.border}`,
                backgroundColor: BRAND.bgSoft,
                textAlign: 'left',
                ...stagger(frame, i + 24, 10, 16),
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontFamily: FONT.mono, fontSize: 34, fontWeight: 700, color: BRAND.accent }}>
                  {g.n}
                </span>
                <span style={{ fontFamily: FONT.sans, fontSize: 22, color: BRAND.text }}>{g.label}</span>
              </div>
              <div style={{ marginTop: 8, fontFamily: FONT.sans, fontSize: 18, color: BRAND.textFaint }}>
                {g.desc}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 34,
            fontFamily: FONT.sans,
            fontSize: 20,
            color: BRAND.textFaint,
            ...fadeUp(frame, 56, 16),
          }}
        >
          共 {CONTENT.toolCount} 个工具，覆盖从读取到回滚的整个流程
        </div>
      </div>
    </AbsoluteFill>
  )
}

const Node: React.FC<{ label: string; tone: string }> = ({ label, tone }) => (
  <div
    style={{
      padding: '18px 30px',
      borderRadius: 14,
      border: `1.5px solid ${tone}`,
      backgroundColor: 'rgba(255,255,255,0.03)',
      fontFamily: FONT.sans,
      fontSize: 26,
      fontWeight: 600,
      color: tone,
      whiteSpace: 'nowrap',
    }}
  >
    {label}
  </div>
)
