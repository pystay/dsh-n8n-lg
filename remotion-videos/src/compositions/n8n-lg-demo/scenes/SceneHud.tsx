import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { BRAND, FONT } from '../constants'
import { CanvasBackdrop } from '../Canvas'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

const WORKFLOWS = [
  { name: '天气同步', active: true },
  { name: '订单推送', active: true },
  { name: '日报生成', active: false },
]

export const SceneHud: React.FC = () => {
  const frame = useCurrentFrame()

  // 第 150 帧切到奶白
  const toCream = frame >= 150 ? 1 : 0
  const bg = toCream ? BRAND.cream : 'rgba(26,30,44,0.96)'
  const text = toCream ? BRAND.creamText : BRAND.text
  const dim = toCream ? '#7a7064' : BRAND.textDim
  const border = toCream ? 'rgba(140,118,92,0.3)' : BRAND.borderStrong
  const accent = toCream ? BRAND.creamAccent : BRAND.accent
  const itemBg = toCream ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.05)'

  const enter = interpolate(frame, [10, 40], [0, 1], clamp)

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg }}>
      {/* 背景：n8n 画布（虚化，表示浮窗浮在编辑器之上） */}
      <svg width="1920" height="1080" viewBox="380 200 1420 800" style={{ position: 'absolute', inset: 0, opacity: 0.5 }}>
        <CanvasBackdrop width={1920} height={1080} />
        <rect x={180} y={740} width={168} height={64} rx={10} fill="#232733" stroke="rgba(61,220,132,0.6)" />
        <rect x={440} y={740} width={168} height={64} rx={10} fill="#232733" stroke="rgba(61,220,132,0.6)" />
        <rect x={700} y={740} width={168} height={64} rx={10} fill="#232733" stroke="rgba(61,220,132,0.6)" />
        <path d="M 348 772 C 388 772, 400 772, 440 772" stroke="rgba(61,220,132,0.7)" strokeWidth={2} fill="none" />
        <path d="M 608 772 C 648 772, 660 772, 700 772" stroke="rgba(61,220,132,0.7)" strokeWidth={2} fill="none" />
      </svg>

      {/* 浮窗 */}
      <div
        style={{
          position: 'absolute',
          right: 110,
          top: 90,
          width: 560,
          borderRadius: 18,
          border: `1px solid ${border}`,
          backgroundColor: bg,
          overflow: 'hidden',
          boxShadow: '0 30px 70px rgba(0,0,0,0.6)',
          opacity: enter,
          transform: `translateY(${interpolate(enter, [0, 1], [40, 0])}px) scale(${interpolate(enter, [0, 1], [0.96, 1])})`,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '17px 19px',
            borderBottom: `1px solid ${border}`,
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              backgroundColor: BRAND.ok,
              boxShadow: `0 0 10px ${BRAND.ok}`,
            }}
          />
          <span style={{ flex: 1, fontFamily: FONT.sans, fontSize: 20, fontWeight: 600, color: text }}>
            n8n 监控
          </span>
          <span
            style={{
              fontFamily: FONT.sans,
              fontSize: 17,
              color: text,
              border: `1px solid ${border}`,
              backgroundColor: itemBg,
              borderRadius: 8,
              padding: '4px 10px',
            }}
          >
            {toCream ? '☾' : '☀'}
          </span>
          <span
            style={{
              fontFamily: FONT.sans,
              fontSize: 16,
              color: text,
              border: `1px solid ${border}`,
              backgroundColor: itemBg,
              borderRadius: 8,
              padding: '5px 12px',
            }}
          >
            刷新
          </span>
        </div>

        <div style={{ padding: '16px 19px 20px' }}>
          <div style={{ fontFamily: FONT.sans, fontSize: 13, color: dim, letterSpacing: 1.2, marginBottom: 10 }}>
            工作流
          </div>
          {WORKFLOWS.map((w, i) => (
            <div
              key={w.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '11px 13px',
                borderRadius: 10,
                backgroundColor: itemBg,
                border: `1px solid ${border}`,
                marginBottom: 8,
                opacity: interpolate(frame, [26 + i * 10, 40 + i * 10], [0, 1], clamp),
              }}
            >
              <span style={{ flex: 1, fontFamily: FONT.sans, fontSize: 18, color: text }}>{w.name}</span>
              <span
                style={{
                  fontFamily: FONT.sans,
                  fontSize: 13,
                  padding: '2px 10px',
                  borderRadius: 999,
                  border: `1px solid ${w.active ? BRAND.ok : border}`,
                  color: w.active ? BRAND.ok : dim,
                }}
              >
                {w.active ? '已启用' : '已停用'}
              </span>
            </div>
          ))}

          <div
            style={{
              marginTop: 14,
              padding: 13,
              borderRadius: 10,
              backgroundColor: toCream ? 'rgba(252,248,241,0.92)' : 'rgba(10,12,20,0.55)',
              border: `1px solid ${border}`,
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              opacity: interpolate(frame, [58, 74], [0, 1], clamp),
            }}
          >
            {['Webhook', 'HTTP', 'DB'].map((label, i) => (
              <React.Fragment key={label}>
                {i > 0 ? <span style={{ flex: 1, height: 1.5, backgroundColor: accent, opacity: 0.55 }} /> : null}
                <span
                  style={{
                    fontFamily: FONT.sans,
                    fontSize: 13,
                    color: text,
                    border: `1px solid ${accent}`,
                    borderRadius: 7,
                    padding: '6px 10px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </span>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* 说明 */}
      <div
        style={{
          position: 'absolute',
          left: 150,
          top: 260,
          width: 520,
          opacity: interpolate(frame, [16, 40], [0, 1], clamp),
        }}
      >
        <div style={{ fontFamily: FONT.sans, fontSize: 44, fontWeight: 600, color: BRAND.text, lineHeight: 1.4 }}>
          右下角一个玻璃浮窗
        </div>
        <div
          style={{
            marginTop: 20,
            fontFamily: FONT.sans,
            fontSize: 23,
            color: BRAND.textDim,
            lineHeight: 1.75,
          }}
        >
          监控、触发、看执行结果
          <br />
          可拖动 · 两套主题
        </div>
      </div>
    </AbsoluteFill>
  )
}
