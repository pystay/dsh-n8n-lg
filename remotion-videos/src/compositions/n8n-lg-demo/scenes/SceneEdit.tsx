import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { BRAND, FONT } from '../constants'
import { CanvasBackdrop, Edge, Node, type CanvasNode } from '../Canvas'
import { Cursor, cursorPath } from '../Cursor'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

const MENU_AT = 74
const PANEL_AT = 132
const TYPE_AT = 150
const SEND_AT = 268
const DONE_AT = 292

const REQUIREMENT = 'URL 改成 https://api.example.com，method 用 POST'

export const SceneEdit: React.FC = () => {
  const frame = useCurrentFrame()

  const typed = REQUIREMENT.slice(
    0,
    Math.floor(interpolate(frame, [TYPE_AT, TYPE_AT + 96], [0, REQUIREMENT.length], clamp))
  )
  const sent = frame >= SEND_AT
  // 改完之后节点外圈亮一下，表示参数变了
  const changed = interpolate(frame, [DONE_AT, DONE_AT + 20], [0, 1], clamp)

  const nodes: CanvasNode[] = [
    { id: 'a', name: 'Webhook', type: 'webhook', glyph: '钩', x: 110, y: 330, appear: 1, state: 'done' },
    {
      id: 'b',
      name: 'HTTP Request',
      type: 'http',
      glyph: 'HT',
      x: 370,
      y: 330,
      appear: 1,
      state: 'done',
      changed: changed > 0.5 ? 1 : 0,
    },
    { id: 'c', name: 'Database', type: 'db', glyph: 'DB', x: 630, y: 330, appear: 1, state: 'done' },
  ]

  const cursor = cursorPath(frame, [
    { at: 0, x: 780, y: 470 },
    { at: 50, x: 430, y: 362 },
    { at: 70, x: 430, y: 362 },
    { at: 116, x: 430, y: 420 },
    { at: 262, x: 300, y: 560 },
  ])

  const rightClick = frame >= 60 && frame <= 72
  const menuRipple = frame >= 60 && frame <= 80 ? (frame - 60) / 20 : 0
  const clickMenu = frame >= 108 && frame <= 120

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg }}>
      <div style={{ display: 'flex', height: '100%' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <svg width="100%" height="100%" viewBox="0 0 1000 760" style={{ position: 'absolute', inset: 0 }}>
            <CanvasBackdrop width={1000} height={760} />
            <Edge from={nodes[0]!} to={nodes[1]!} grow={1} frame={frame} />
            <Edge from={nodes[1]!} to={nodes[2]!} grow={1} frame={frame} />
            {nodes.map((n) => (
              <Node key={n.id} node={n} frame={frame} />
            ))}
            <Cursor
              x={cursor.x}
              y={cursor.y}
              press={rightClick || clickMenu ? 1 : 0}
              ripple={menuRipple}
            />
          </svg>

          {/* 右键菜单：画在 SVG 里，坐标与节点一致 */}
          {frame >= MENU_AT && frame < PANEL_AT + 6 ? (
            <svg width="100%" height="100%" viewBox="0 0 1000 760" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              <g
                transform={`translate(430 404) scale(${interpolate(frame, [MENU_AT, MENU_AT + 9], [0.93, 1], clamp)})`}
                opacity={interpolate(frame, [MENU_AT, MENU_AT + 9], [0, 1], clamp)}
                style={{ transformOrigin: '0 0' }}
              >
                <rect width={230} height={46} rx={9} fill="#1c2030" stroke="rgba(255,255,255,0.18)" />
                <rect x={5} y={5} width={220} height={36} rx={6} fill="rgba(96,140,255,0.28)" />
                <text x={18} y={29} fill="#e9edf7" fontFamily={FONT.sans} fontSize={17}>
                  修改这个节点…
                </text>
              </g>
            </svg>
          ) : null}

          {/* 输入面板 */}
          {frame >= PANEL_AT ? (
            <div
              style={{
                position: 'absolute',
                left: 40,
                right: 40,
                bottom: 30,
                padding: 20,
                borderRadius: 14,
                backgroundColor: 'rgba(24,28,42,0.97)',
                border: `1px solid ${sent ? BRAND.ok : BRAND.borderStrong}`,
                boxShadow: '0 18px 44px rgba(0,0,0,0.55)',
                opacity: interpolate(frame, [PANEL_AT, PANEL_AT + 12], [0, 1], clamp),
                transform: `translateY(${interpolate(frame, [PANEL_AT, PANEL_AT + 12], [14, 0], clamp)}px)`,
              }}
            >
              <div style={{ fontFamily: FONT.sans, fontSize: 16, color: BRAND.textDim, marginBottom: 10 }}>
                修改节点「HTTP Request」
              </div>
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: 9,
                  backgroundColor: 'rgba(10,12,20,0.85)',
                  border: `1px solid ${BRAND.border}`,
                  fontFamily: FONT.sans,
                  fontSize: 20,
                  color: BRAND.text,
                  minHeight: 30,
                }}
              >
                {typed}
                <span
                  style={{
                    display: 'inline-block',
                    width: 2,
                    height: 21,
                    marginLeft: 3,
                    backgroundColor: BRAND.accent,
                    opacity: sent ? 0 : interpolate(frame % 26, [0, 13, 26], [1, 0.15, 1]),
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 13 }}>
                <div
                  style={{
                    padding: '9px 18px',
                    borderRadius: 9,
                    backgroundColor: sent ? BRAND.ok : BRAND.accent,
                    fontFamily: FONT.sans,
                    fontSize: 18,
                    color: '#fff',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {sent ? '已交给 AI' : '交给 AI 修改'}
                </div>
                {sent ? (
                  <div
                    style={{
                      fontFamily: FONT.sans,
                      fontSize: 17,
                      color: BRAND.textFaint,
                      alignSelf: 'center',
                    }}
                  >
                    AI 正在改…
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {/* 右侧说明 */}
        <div
          style={{
            width: 430,
            backgroundColor: '#16181f',
            borderLeft: `1px solid ${BRAND.border}`,
            padding: '46px 30px',
          }}
        >
          <div
            style={{
              fontFamily: FONT.sans,
              fontSize: 34,
              fontWeight: 600,
              color: BRAND.text,
              lineHeight: 1.4,
              opacity: interpolate(frame, [10, 30], [0, 1], clamp),
            }}
          >
            不想打字？
            <br />
            右键节点直接说
          </div>

          <div style={{ marginTop: 30, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[
              { t: '只改这一个节点', d: '其他节点和布局都不动' },
              { t: '先读后改', d: '读到当前配置再动手' },
              { t: '改完自动校验', d: '不通过不会落库' },
              { t: '顺手留快照', d: '不满意可以回滚' },
            ].map((it, i) => (
              <div
                key={it.t}
                style={{
                  opacity: interpolate(frame, [34 + i * 12, 50 + i * 12], [0, 1], clamp),
                  transform: `translateX(${interpolate(frame, [34 + i * 12, 50 + i * 12], [16, 0], clamp)}px)`,
                }}
              >
                <div style={{ fontFamily: FONT.sans, fontSize: 19, color: BRAND.text, fontWeight: 600 }}>
                  {it.t}
                </div>
                <div style={{ marginTop: 4, fontFamily: FONT.sans, fontSize: 16, color: BRAND.textFaint }}>
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
