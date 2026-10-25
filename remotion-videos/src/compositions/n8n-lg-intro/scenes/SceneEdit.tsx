import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { BRAND, FONT } from '../constants'
import { fadeUp, typewriter } from '../utils'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

const REQUIREMENT = '把 URL 改成 https://api.example.com，method 用 POST'

export const SceneEdit: React.FC = () => {
  const frame = useCurrentFrame()

  // 时间节点
  const menuAt = 66 // 右键 → 菜单出现
  const panelAt = 104 // 点菜单 → 输入框出现
  const typeAt = 118 // 开始打字
  const sendAt = 232 // 点「交给 AI 修改」
  const doneAt = 256 // 提示已发送

  const typed = typewriter(frame, REQUIREMENT, typeAt, 1.5)
  const menuVisible = frame >= menuAt && frame < panelAt + 8
  const panelVisible = frame >= panelAt
  const sent = frame >= sendAt

  // 节点被"改过"后的高亮
  const changed = interpolate(frame, [doneAt, doneAt + 18], [0, 1], clamp)

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg, padding: '64px 90px' }}>
      <div
        style={{
          fontFamily: FONT.sans,
          fontSize: 38,
          fontWeight: 600,
          color: BRAND.text,
          ...fadeUp(frame, 2, 16),
        }}
      >
        右键任意节点，一句话让它改
      </div>

      <div style={{ display: 'flex', gap: 30, marginTop: 28, flex: 1 }}>
        {/* 画布 */}
        <div
          style={{
            flex: 1,
            borderRadius: 14,
            border: `1px solid ${BRAND.border}`,
            backgroundColor: 'rgba(10,12,20,0.6)',
            position: 'relative',
            ...fadeUp(frame, 8, 16),
          }}
        >
          <svg width="100%" height="100%" viewBox="0 0 700 380" style={{ position: 'absolute', inset: 0 }}>
            <path d="M 180 130 C 235 130, 245 130, 290 130" fill="none" stroke={BRAND.accent} strokeWidth={2} opacity={0.7} />
            <path d="M 440 130 C 495 130, 505 130, 540 130" fill="none" stroke={BRAND.accent} strokeWidth={2} opacity={0.7} />

            <CanvasNode x={40} y={98} label="Webhook" kind="webhook" />
            <CanvasNode
              x={300}
              y={98}
              label="HTTP Request"
              kind="http"
              highlight={changed}
              // 被改过之后边框变绿，表示参数已更新
              highlightColor={BRAND.ok}
            />
            <CanvasNode x={540} y={98} label="Database" kind="db" />
          </svg>

          {/* 右键菜单 */}
          {menuVisible ? (
            <div
              style={{
                position: 'absolute',
                left: 330,
                top: 172,
                minWidth: 180,
                padding: 5,
                borderRadius: 9,
                backgroundColor: '#1a2030',
                border: `1px solid ${BRAND.borderStrong}`,
                boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
                transformOrigin: '0 0',
                transform: `scale(${interpolate(frame, [menuAt, menuAt + 8], [0.94, 1], clamp)})`,
                opacity: interpolate(frame, [menuAt, menuAt + 8], [0, 1], clamp),
              }}
            >
              <div
                style={{
                  fontFamily: FONT.sans,
                  fontSize: 17,
                  color: BRAND.text,
                  padding: '9px 14px',
                  borderRadius: 6,
                  backgroundColor: 'rgba(96,140,255,0.28)',
                }}
              >
                修改这个节点…
              </div>
            </div>
          ) : null}

          {/* 输入面板 */}
          {panelVisible ? (
            <div
              style={{
                position: 'absolute',
                left: 40,
                right: 40,
                bottom: 26,
                padding: 16,
                borderRadius: 12,
                backgroundColor: 'rgba(20,26,40,0.96)',
                border: `1px solid ${sent ? BRAND.ok : BRAND.borderStrong}`,
                opacity: interpolate(frame, [panelAt, panelAt + 10], [0, 1], clamp),
                transform: `translateY(${interpolate(frame, [panelAt, panelAt + 10], [12, 0], clamp)}px)`,
              }}
            >
              <div style={{ fontFamily: FONT.sans, fontSize: 15, color: BRAND.textDim, marginBottom: 9 }}>
                修改节点「HTTP Request」
              </div>
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  backgroundColor: 'rgba(10,12,20,0.85)',
                  border: `1px solid ${BRAND.borderStrong}`,
                  fontFamily: FONT.sans,
                  fontSize: 17,
                  color: BRAND.text,
                  minHeight: 26,
                }}
              >
                {typed}
                <span
                  style={{
                    display: 'inline-block',
                    width: 2,
                    height: 18,
                    marginLeft: 3,
                    backgroundColor: BRAND.accent,
                    opacity: sent ? 0 : interpolate(frame % 26, [0, 13, 26], [1, 0.1, 1]),
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 11 }}>
                <div
                  style={{
                    fontFamily: FONT.sans,
                    fontSize: 16,
                    color: '#fff',
                    backgroundColor: sent ? BRAND.ok : BRAND.accent,
                    borderRadius: 8,
                    padding: '7px 14px',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {sent ? '已发送' : '交给 AI 修改'}
                </div>

              </div>
            </div>
          ) : null}
        </div>

        {/* 右侧说明 */}
        <div style={{ width: 360 }}>
          <div
            style={{
              fontFamily: FONT.sans,
              fontSize: 21,
              color: BRAND.textDim,
              lineHeight: 1.8,
              ...fadeUp(frame, 20, 16),
            }}
          >
            浮窗自己不改库 ——
            <br />
            它只是把需求说清楚，交给 AI 去改
          </div>

          <div style={{ marginTop: 26, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { t: '只改这个节点', d: '不动其他节点、不重排布局' },
              { t: '先读后改', d: '读当前配置再动手' },
              { t: '改完校验', d: '不通过不落库' },
            ].map((it, i) => (
              <div
                key={it.t}
                style={{
                  padding: '12px 14px',
                  borderRadius: 10,
                  backgroundColor: BRAND.bgSoft,
                  border: `1px solid ${BRAND.border}`,
                  opacity: interpolate(frame, [34 + i * 12, 48 + i * 12], [0, 1], clamp),
                }}
              >
                <div style={{ fontFamily: FONT.sans, fontSize: 18, color: BRAND.text, fontWeight: 600 }}>
                  {it.t}
                </div>
                <div style={{ marginTop: 5, fontFamily: FONT.sans, fontSize: 15, color: BRAND.textFaint }}>
                  {it.d}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  )
}

const CanvasNode: React.FC<{
  x: number
  y: number
  label: string
  kind: string
  highlight?: number
  highlightColor?: string
}> = ({ x, y, label, kind, highlight = 0, highlightColor = BRAND.accent }) => (
  <g>
    <rect
      x={x}
      y={y}
      width={150}
      height={64}
      rx={12}
      fill={BRAND.panel}
      stroke={highlight > 0.5 ? highlightColor : BRAND.borderStrong}
      strokeWidth={highlight > 0.5 ? 2.4 : 1.4}
    />
    <text x={x + 16} y={y + 27} fill={BRAND.text} fontFamily={FONT.sans} fontSize={15} fontWeight={600}>
      {label}
    </text>
    <text x={x + 16} y={y + 47} fill={BRAND.textFaint} fontFamily={FONT.mono} fontSize={11}>
      {kind}
    </text>
  </g>
)
