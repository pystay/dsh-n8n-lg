import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { BRAND, CONTENT, FONT } from '../constants'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export const SceneEnd: React.FC = () => {
  const frame = useCurrentFrame()

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg, justifyContent: 'center', alignItems: 'center' }}>
      <div
        style={{
          position: 'absolute',
          width: 1000,
          height: 560,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${BRAND.accent} 0%, transparent 70%)`,
          opacity: interpolate(frame, [0, 40], [0.06, 0.18], clamp),
          filter: 'blur(90px)',
        }}
      />

      <div style={{ textAlign: 'center', zIndex: 1 }}>
        <div
          style={{
            fontFamily: FONT.mono,
            fontSize: 66,
            fontWeight: 700,
            color: BRAND.text,
            opacity: interpolate(frame, [4, 24], [0, 1], clamp),
            transform: `translateY(${interpolate(frame, [4, 28], [18, 0], clamp)}px)`,
          }}
        >
          {CONTENT.title}
        </div>

        <div
          style={{
            marginTop: 20,
            fontFamily: FONT.sans,
            fontSize: 30,
            color: BRAND.textDim,
            opacity: interpolate(frame, [20, 40], [0, 1], clamp),
          }}
        >
          {CONTENT.tagline}
        </div>

        <div
          style={{
            marginTop: 52,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 14,
            padding: '17px 28px',
            borderRadius: 12,
            backgroundColor: 'rgba(10,12,20,0.85)',
            border: `1px solid ${BRAND.borderStrong}`,
            fontFamily: FONT.mono,
            fontSize: 21,
            color: BRAND.text,
            opacity: interpolate(frame, [36, 56], [0, 1], clamp),
            transform: `translateY(${interpolate(frame, [36, 60], [14, 0], clamp)}px)`,
          }}
        >
          <span style={{ color: BRAND.ok }}>$</span>
          <span>{CONTENT.install}</span>
        </div>

        <div
          style={{
            marginTop: 28,
            fontFamily: FONT.mono,
            fontSize: 20,
            color: BRAND.accent,
            opacity: interpolate(frame, [52, 72], [0, 1], clamp),
          }}
        >
          {CONTENT.repo}
        </div>

        <div
          style={{
            marginTop: 44,
            fontFamily: FONT.sans,
            fontSize: 17,
            color: BRAND.textFaint,
            opacity: interpolate(frame, [66, 86], [0, 1], clamp),
          }}
        >
          MIT License · 21 个工具 · 运行时零依赖
        </div>
      </div>
    </AbsoluteFill>
  )
}
