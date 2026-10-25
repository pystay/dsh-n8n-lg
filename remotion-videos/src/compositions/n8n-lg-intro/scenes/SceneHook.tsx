import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { BRAND, CONTENT, FONT } from '../constants'
import { fadeUp } from '../utils'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export const SceneHook: React.FC = () => {
  const frame = useCurrentFrame()

  // 标题字距从宽到正常收拢，比单纯放大更耐看
  const spacing = interpolate(frame, [8, 42], [14, 1], clamp)
  const glow = interpolate(frame, [0, 60, 150], [0.25, 0.5, 0.3], clamp)

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg, justifyContent: 'center', alignItems: 'center' }}>
      {/* 背后一团冷光，给纯色背景一点层次 */}
      <div
        style={{
          position: 'absolute',
          width: 1100,
          height: 700,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${BRAND.accent} 0%, transparent 68%)`,
          opacity: glow * 0.22,
          filter: 'blur(70px)',
        }}
      />

      <div style={{ textAlign: 'center', zIndex: 1 }}>
        <div
          style={{
            fontFamily: FONT.mono,
            fontSize: 96,
            fontWeight: 700,
            color: BRAND.text,
            letterSpacing: spacing,
            ...fadeUp(frame, 4, 22),
          }}
        >
          {CONTENT.title}
        </div>

        <div
          style={{
            marginTop: 26,
            fontFamily: FONT.sans,
            fontSize: 40,
            color: BRAND.textDim,
            letterSpacing: 2,
            ...fadeUp(frame, 26, 22),
          }}
        >
          {CONTENT.tagline}
        </div>

        <div
          style={{
            marginTop: 40,
            display: 'inline-block',
            padding: '10px 22px',
            borderRadius: 999,
            border: `1px solid ${BRAND.borderStrong}`,
            backgroundColor: BRAND.accentSoft,
            fontFamily: FONT.sans,
            fontSize: 22,
            color: BRAND.accent,
            ...fadeUp(frame, 48, 20),
          }}
        >
          {CONTENT.subtitle}
        </div>
      </div>
    </AbsoluteFill>
  )
}
