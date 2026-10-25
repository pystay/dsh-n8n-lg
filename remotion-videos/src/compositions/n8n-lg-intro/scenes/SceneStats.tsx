import React from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { BRAND, CONTENT, FONT } from '../constants'
import { countUp, fadeUp } from '../utils'

export const SceneStats: React.FC = () => {
  const frame = useCurrentFrame()

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: 90 }}>
        {CONTENT.stats.map((s, i) => {
          const start = 8 + i * 14
          // 数字滚动：让「21 / 60 / 0」有个交代，而不是直接跳出来
          const n = countUp(frame, Number(s.v), start, 26)
          return (
            <div key={s.u} style={{ textAlign: 'center', ...fadeUp(frame, start, 16) }}>
              <div
                style={{
                  fontFamily: FONT.mono,
                  fontSize: 118,
                  fontWeight: 700,
                  color: i === 0 ? BRAND.accent : BRAND.text,
                  lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {n}
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontFamily: FONT.sans,
                  fontSize: 30,
                  color: BRAND.text,
                  letterSpacing: 1,
                }}
              >
                {s.u}
              </div>
              <div style={{ marginTop: 12, fontFamily: FONT.sans, fontSize: 19, color: BRAND.textFaint }}>
                {s.d}
              </div>
            </div>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}
