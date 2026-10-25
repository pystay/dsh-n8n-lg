import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { BRAND, CONTENT, FONT } from '../constants'
import { fadeUp, stagger } from '../utils'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export const SceneSafety: React.FC = () => {
  const frame = useCurrentFrame()

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ width: 1420 }}>
        <div
          style={{
            fontFamily: FONT.sans,
            fontSize: 46,
            fontWeight: 600,
            color: BRAND.text,
            textAlign: 'center',
            ...fadeUp(frame, 4, 18),
          }}
        >
          让 AI 动手，但不让它乱来
        </div>
        <div
          style={{
            marginTop: 14,
            fontFamily: FONT.sans,
            fontSize: 22,
            color: BRAND.textFaint,
            textAlign: 'center',
            ...fadeUp(frame, 16, 18),
          }}
        >
          每一层都有硬约束，不是靠「提示词小心点」
        </div>

        <div style={{ display: 'flex', gap: 26, marginTop: 54 }}>
          {CONTENT.safety.map((s, i) => (
            <div
              key={s.t}
              style={{
                flex: 1,
                padding: '28px 26px',
                borderRadius: 16,
                backgroundColor: BRAND.bgSoft,
                border: `1px solid ${BRAND.border}`,
                ...stagger(frame, i + 2, 12, 20),
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  backgroundColor: 'rgba(61,220,132,0.14)',
                  border: '1px solid rgba(61,220,132,0.4)',
                  color: BRAND.ok,
                  fontSize: 22,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 18,
                }}
              >
                ✓
              </div>
              <div style={{ fontFamily: FONT.sans, fontSize: 26, fontWeight: 600, color: BRAND.text }}>
                {s.t}
              </div>
              <div style={{ marginTop: 10, fontFamily: FONT.sans, fontSize: 19, color: BRAND.textFaint, lineHeight: 1.6 }}>
                {s.d}
              </div>
            </div>
          ))}
        </div>

        {/* 底部：一条"护栏"示意 */}
        <div
          style={{
            marginTop: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0,
            opacity: interpolate(frame, [56, 74], [0, 1], clamp),
          }}
        >
          {['AI 写入请求', '校验', '快照', '落库'].map((label, i) => (
            <React.Fragment key={label}>
              <span
                style={{
                  fontFamily: FONT.sans,
                  fontSize: 17,
                  color: i === 0 ? BRAND.accent : i === 3 ? BRAND.ok : BRAND.textDim,
                  border: `1px solid ${i === 0 ? BRAND.accent : i === 3 ? BRAND.ok : BRAND.border}`,
                  borderRadius: 8,
                  padding: '8px 16px',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </span>
              {i < 3 ? (
                <span style={{ width: 44, height: 1.5, backgroundColor: BRAND.borderStrong, opacity: 0.8 }} />
              ) : null}
            </React.Fragment>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  )
}
