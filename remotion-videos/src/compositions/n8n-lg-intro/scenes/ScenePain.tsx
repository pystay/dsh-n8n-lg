import React from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { BRAND, CONTENT, FONT } from '../constants'
import { fadeUp, stagger } from '../utils'

export const ScenePain: React.FC = () => {
  const frame = useCurrentFrame()

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ width: 1400 }}>
        <div
          style={{
            fontFamily: FONT.sans,
            fontSize: 46,
            fontWeight: 600,
            color: BRAND.text,
            marginBottom: 56,
            textAlign: 'center',
            ...fadeUp(frame, 4, 18),
          }}
        >
          搭一个能跑的工作流，要花多久？
        </div>

        <div style={{ display: 'flex', gap: 28 }}>
          {CONTENT.pains.map((p, i) => (
            <div
              key={p.text}
              style={{
                flex: 1,
                padding: '30px 28px',
                borderRadius: 18,
                border: `1px solid ${BRAND.border}`,
                backgroundColor: BRAND.bgSoft,
                ...stagger(frame, i + 3, 12, 20),
              }}
            >
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  backgroundColor: 'rgba(255,92,108,0.14)',
                  border: '1px solid rgba(255,92,108,0.35)',
                  color: BRAND.err,
                  fontFamily: FONT.sans,
                  fontSize: 24,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 20,
                }}
              >
                {p.icon}
              </div>
              <div style={{ fontFamily: FONT.sans, fontSize: 27, color: BRAND.text, fontWeight: 600 }}>
                {p.text}
              </div>
              <div style={{ marginTop: 10, fontFamily: FONT.sans, fontSize: 20, color: BRAND.textFaint }}>
                {p.sub}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  )
}
