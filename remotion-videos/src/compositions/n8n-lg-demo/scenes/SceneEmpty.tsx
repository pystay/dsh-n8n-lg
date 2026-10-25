import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { BRAND, CONTENT, FONT } from '../constants'
import { CanvasBackdrop } from '../Canvas'
import { Cursor, cursorPath } from '../Cursor'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export const SceneEmpty: React.FC = () => {
  const frame = useCurrentFrame()

  const cursor = cursorPath(frame, [
    { at: 0, x: 1500, y: 720 },
    { at: 40, x: 1180, y: 470 },
    { at: 100, x: 1080, y: 420 },
  ])

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg }}>
      <svg width="1920" height="1080" viewBox="380 200 1420 800" style={{ position: 'absolute', inset: 0 }}>
        <CanvasBackdrop width={1920} height={1080} />
        <Cursor x={cursor.x} y={cursor.y} opacity={interpolate(frame, [0, 20], [0, 1], clamp)} />
      </svg>

      {/* 标题浮在画布上方 */}
      <div
        style={{
          position: 'absolute',
          top: 170,
          left: 0,
          right: 0,
          textAlign: 'center',
          opacity: interpolate(frame, [50, 78], [0, 1], clamp),
          transform: `translateY(${interpolate(frame, [50, 82], [22, 0], clamp)}px)`,
        }}
      >
        <div
          style={{
            fontFamily: FONT.mono,
            fontSize: 26,
            color: BRAND.accent,
            letterSpacing: 3,
            marginBottom: 18,
          }}
        >
          {CONTENT.title}
        </div>
        <div
          style={{
            fontFamily: FONT.sans,
            fontSize: 54,
            fontWeight: 600,
            color: BRAND.text,
            textShadow: '0 4px 30px rgba(0,0,0,0.85)',
          }}
        >
          {CONTENT.tagline}
        </div>
      </div>
    </AbsoluteFill>
  )
}
