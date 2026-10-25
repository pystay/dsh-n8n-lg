import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { BRAND, FONT } from '../constants'
import { fadeUp } from '../utils'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

const WORKFLOWS = [
  { name: '订单同步', active: true },
  { name: '日报生成', active: false },
  { name: '天气播报', active: true },
]

export const SceneHud: React.FC = () => {
  const frame = useCurrentFrame()

  // 第 200 帧左右切到奶白主题，展示主题切换
  const toCream = interpolate(frame, [190, 215], [0, 1], clamp)
  const mix = (dark: string, light: string) => (toCream > 0.5 ? light : dark)

  const bg = mix(BRAND.bgSoft, BRAND.cream)
  const text = mix(BRAND.text, BRAND.creamText)
  const dim = mix(BRAND.textDim, '#7a7064')
  const border = toCream > 0.5 ? 'rgba(140,118,92,0.28)' : BRAND.borderStrong
  const accent = mix(BRAND.accent, BRAND.creamAccent)
  const itemBg = toCream > 0.5 ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.045)'

  return (
    <AbsoluteFill
      style={{
        backgroundColor: mix(BRAND.bg, '#efe9df'),
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 70 }}>
        {/* 左侧说明 */}
        <div style={{ width: 460 }}>
          <div
            style={{
              fontFamily: FONT.sans,
              fontSize: 42,
              fontWeight: 600,
              // 左侧文字必须跟着主题变色，否则奶白下浅字压米底等于看不见
              color: mix(BRAND.text, BRAND.creamText),
              lineHeight: 1.35,
              ...fadeUp(frame, 4, 18),
            }}
          >
            右下角一个玻璃浮窗
          </div>
          <div
            style={{
              marginTop: 20,
              fontFamily: FONT.sans,
              fontSize: 22,
              color: mix(BRAND.textDim, '#5f564c'),
              lineHeight: 1.7,
              ...fadeUp(frame, 16, 18),
            }}
          >
            监控工作流、一键触发、看执行结果
            <br />
            内嵌编辑器，或者只读画布
          </div>
          <div
            style={{
              marginTop: 26,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 16px',
              borderRadius: 10,
              backgroundColor: toCream > 0.5 ? 'rgba(196,135,60,0.12)' : 'rgba(96,140,255,0.12)',
              border: `1px solid ${toCream > 0.5 ? 'rgba(140,118,92,0.28)' : BRAND.border}`,
              fontFamily: FONT.sans,
              fontSize: 19,
              color: accent,
              ...fadeUp(frame, 30, 18),
            }}
          >
            <span>可以拖动到任意位置</span>
          </div>
        </div>

        {/* 右侧：浮窗本体 */}
        <div
          style={{
            width: 440,
            borderRadius: 18,
            border: `1px solid ${border}`,
            backgroundColor: bg,
            overflow: 'hidden',
            boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
            ...fadeUp(frame, 10, 20, 40),
          }}
        >
          {/* 头部 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '16px 18px',
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
            <span style={{ flex: 1, fontFamily: FONT.sans, fontSize: 19, fontWeight: 600, color: text }}>
              n8n 监控
            </span>
            <span
              style={{
                fontFamily: FONT.sans,
                fontSize: 16,
                color: text,
                border: `1px solid ${border}`,
                backgroundColor: itemBg,
                borderRadius: 8,
                padding: '4px 9px',
              }}
            >
              {toCream > 0.5 ? '☾' : '☀'}
            </span>
            <span
              style={{
                fontFamily: FONT.sans,
                fontSize: 15,
                color: text,
                border: `1px solid ${border}`,
                backgroundColor: itemBg,
                borderRadius: 8,
                padding: '5px 11px',
              }}
            >
              刷新
            </span>
          </div>

          <div style={{ padding: '14px 18px 18px' }}>
            <div style={{ fontFamily: FONT.sans, fontSize: 13, color: dim, letterSpacing: 1, marginBottom: 10 }}>
              连接
            </div>
            <div
              style={{
                fontFamily: FONT.mono,
                fontSize: 15,
                color: text,
                backgroundColor: itemBg,
                border: `1px solid ${border}`,
                borderRadius: 8,
                padding: '9px 11px',
                marginBottom: 16,
              }}
            >
              http://127.0.0.1:5678
            </div>

            <div style={{ fontFamily: FONT.sans, fontSize: 13, color: dim, letterSpacing: 1, marginBottom: 10 }}>
              工作流
            </div>
            {WORKFLOWS.map((w, i) => {
              const start = 40 + i * 10
              return (
                <div
                  key={w.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 12px',
                    borderRadius: 10,
                    backgroundColor: itemBg,
                    border: `1px solid ${border}`,
                    marginBottom: 8,
                    opacity: interpolate(frame, [start, start + 12], [0, 1], clamp),
                  }}
                >
                  <span style={{ flex: 1, fontFamily: FONT.sans, fontSize: 17, color: text }}>{w.name}</span>
                  <span
                    style={{
                      fontFamily: FONT.sans,
                      fontSize: 13,
                      padding: '2px 9px',
                      borderRadius: 999,
                      border: `1px solid ${w.active ? BRAND.ok : border}`,
                      color: w.active ? BRAND.ok : dim,
                    }}
                  >
                    {w.active ? '已启用' : '已停用'}
                  </span>
                </div>
              )
            })}

            {/* 迷你画布 */}
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 10,
                backgroundColor: toCream > 0.5 ? 'rgba(252,248,241,0.9)' : 'rgba(10,12,20,0.55)',
                border: `1px solid ${border}`,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                opacity: interpolate(frame, [70, 86], [0, 1], clamp),
              }}
            >
              <MiniNode label="Webhook" text={text} border={accent} />
              <div style={{ flex: 1, height: 1.5, backgroundColor: accent, opacity: 0.6 }} />
              <MiniNode label="HTTP" text={text} border={accent} />
              <div style={{ flex: 1, height: 1.5, backgroundColor: accent, opacity: 0.6 }} />
              <MiniNode label="DB" text={text} border={accent} />
            </div>
          </div>
        </div>
      </div>

      {/* 主题切换的说明气泡 */}
      <div
        style={{
          position: 'absolute',
          bottom: 60,
          fontFamily: FONT.sans,
          fontSize: 20,
          color: toCream > 0.5 ? '#7a7064' : BRAND.textFaint,
          opacity: interpolate(frame, [186, 206], [0, 1], clamp),
        }}
      >
        两套主题 · 深色玻璃 / 奶白
      </div>
    </AbsoluteFill>
  )
}

const MiniNode: React.FC<{ label: string; text: string; border: string }> = ({ label, text, border }) => (
  <span
    style={{
      fontFamily: FONT.sans,
      fontSize: 12,
      color: text,
      border: `1px solid ${border}`,
      borderRadius: 7,
      padding: '6px 9px',
      whiteSpace: 'nowrap',
    }}
  >
    {label}
  </span>
)
