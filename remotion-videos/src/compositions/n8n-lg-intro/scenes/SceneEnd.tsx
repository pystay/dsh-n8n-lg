import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { BRAND, CONTENT, FONT } from '../constants'
import { fadeUp } from '../utils'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export const SceneEnd: React.FC = () => {
  const frame = useCurrentFrame()

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg, justifyContent: 'center', alignItems: 'center' }}>
      <div
        style={{
          position: 'absolute',
          width: 900,
          height: 520,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${BRAND.accent} 0%, transparent 70%)`,
          opacity: interpolate(frame, [0, 40], [0.05, 0.16], clamp),
          filter: 'blur(80px)',
        }}
      />

      <div style={{ textAlign: 'center', zIndex: 1 }}>
        <div
          style={{
            fontFamily: FONT.mono,
            fontSize: 62,
            fontWeight: 700,
            color: BRAND.text,
            ...fadeUp(frame, 4, 18),
          }}
        >
          {CONTENT.title}
        </div>

        <div
          style={{
            marginTop: 18,
            fontFamily: FONT.sans,
            fontSize: 26,
            color: BRAND.textDim,
            ...fadeUp(frame, 16, 18),
          }}
        >
          {CONTENT.tagline}
        </div>

        {/* 安装命令 */}
        <div
          style={{
            marginTop: 46,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 14,
            padding: '16px 26px',
            borderRadius: 12,
            backgroundColor: 'rgba(10,12,20,0.8)',
            border: `1px solid ${BRAND.borderStrong}`,
            fontFamily: FONT.mono,
            fontSize: 20,
            color: BRAND.text,
            ...fadeUp(frame, 30, 18),
          }}
        >
          <span style={{ color: BRAND.ok }}>$</span>
          <span>{CONTENT.install}</span>
        </div>

        <div
          style={{
            marginTop: 26,
            fontFamily: FONT.mono,
            fontSize: 19,
            color: BRAND.accent,
            ...fadeUp(frame, 46, 18),
          }}
        >
          {CONTENT.repo}
        </div>

        <div
          style={{
            marginTop: 40,
            fontFamily: FONT.sans,
            fontSize: 17,
            color: BRAND.textFaint,
            ...fadeUp(frame, 58, 18),
          }}
        >
          MIT License · 已在 DSH 桌面端 0.2.1-rc.3 验证
        </div>
      </div>
    </AbsoluteFill>
  )
}
