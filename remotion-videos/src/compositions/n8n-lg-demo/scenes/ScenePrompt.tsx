import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { BRAND, CONTENT, FONT } from '../constants'
import { CanvasBackdrop, TopBar } from '../Canvas'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

export const ScenePrompt: React.FC = () => {
  const frame = useCurrentFrame()

  // 打字机：约 3 秒打完（这场景只有 6 秒）
  const chars = Math.floor(interpolate(frame, [46, 130], [0, CONTENT.prompt.length], clamp))
  const typed = CONTENT.prompt.slice(0, chars)
  const done = chars >= CONTENT.prompt.length

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg }}>
      <TopBar name="天气同步" status="未保存" action={{ label: 'Save', tone: 'accent' }} opacity={interpolate(frame, [0, 16], [0, 1], clamp)} />

      <svg width="1920" height="1080" viewBox="380 200 1420 800" style={{ position: 'absolute', inset: 0 }}>
        <CanvasBackdrop width={1920} height={1080} />
        {/* 刚才那些手工节点淡出，画布回到空 */}
        <g opacity={interpolate(frame, [0, 24], [1, 0], clamp)}>
          <rect x={520} y={470} width={168} height={64} rx={10} fill="#232733" stroke="rgba(255,255,255,0.16)" />
          <rect x={740} y={470} width={168} height={64} rx={10} fill="#232733" stroke="rgba(255,255,255,0.16)" />
          <rect x={960} y={470} width={168} height={64} rx={10} fill="#232733" stroke="rgba(255,255,255,0.16)" />
        </g>
      </svg>

      {/* 输入框：从下方滑入，像个真实的输入栏 */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 190,
          width: 1120,
          transform: `translateX(-50%) translateY(${interpolate(frame, [20, 46], [30, 0], clamp)}px)`,
          opacity: interpolate(frame, [20, 46], [0, 1], clamp),
        }}
      >
        <div
          style={{
            padding: '26px 30px',
            borderRadius: 16,
            backgroundColor: 'rgba(30,34,48,0.97)',
            border: `1px solid ${done ? BRAND.accent : BRAND.borderStrong}`,
            boxShadow: '0 20px 50px rgba(0,0,0,0.55)',
          }}
        >
          <div style={{ fontFamily: FONT.sans, fontSize: 18, color: BRAND.textFaint, marginBottom: 12 }}>
            告诉 AI 你想要什么
          </div>
          <div
            style={{
              fontFamily: FONT.sans,
              fontSize: 30,
              color: BRAND.text,
              display: 'flex',
              alignItems: 'center',
              minHeight: 40,
            }}
          >
            <span style={{ color: BRAND.accent, marginRight: 12, fontFamily: FONT.mono }}>{'>'}</span>
            <span>{typed}</span>
            <span
              style={{
                display: 'inline-block',
                width: 2.5,
                height: 32,
                marginLeft: 5,
                backgroundColor: BRAND.accent,
                opacity: done ? 0 : interpolate(frame % 26, [0, 13, 26], [1, 0.15, 1]),
              }}
            />
          </div>
        </div>
      </div>

      {/* 提示：一句话就够了 */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 130,
          textAlign: 'center',
          fontFamily: FONT.sans,
          fontSize: 22,
          color: BRAND.textFaint,
          opacity: interpolate(frame, [130, 154], [0, 1], clamp),
        }}
      >
        不用拖、不用连 —— 说清楚要什么就行
      </div>
    </AbsoluteFill>
  )
}
