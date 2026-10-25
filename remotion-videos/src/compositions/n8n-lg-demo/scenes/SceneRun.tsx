import React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { BRAND, CONTENT, FONT } from '../constants'
import { CanvasBackdrop, Edge, Node, type CanvasNode } from '../Canvas'
import { Cursor, cursorPath } from '../Cursor'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** 每个节点开始执行的帧 */
const RUN_AT = { a: 62, b: 150, c: 238 }
const FLOW_AT = { l1: 118, l2: 206 }

export const SceneRun: React.FC = () => {
  const frame = useCurrentFrame()

  const stateOf = (at: number): CanvasNode['state'] => {
    if (frame < at) return 'idle'
    if (frame < at + 26) return 'running'
    return 'done'
  }

  const nodes: CanvasNode[] = [
    { id: 'a', name: 'Webhook', type: 'webhook', glyph: '钩', x: 110, y: 330, appear: 1, state: stateOf(RUN_AT.a) },
    { id: 'b', name: 'HTTP Request', type: 'http', glyph: 'HT', x: 370, y: 330, appear: 1, state: stateOf(RUN_AT.b) },
    { id: 'c', name: 'Database', type: 'db', glyph: 'DB', x: 630, y: 330, appear: 1, state: stateOf(RUN_AT.c) },
  ]

  const flow1 = interpolate(frame, [FLOW_AT.l1, FLOW_AT.l1 + 24], [0, 1], clamp)
  const flow2 = interpolate(frame, [FLOW_AT.l2, FLOW_AT.l2 + 24], [0, 1], clamp)

  // 光标：移到 Execute 按钮 → 点一下 → 移开
  const cursor = cursorPath(frame, [
    { at: 0, x: 760, y: 420 },
    { at: 30, x: 905, y: 74 },
    { at: 52, x: 905, y: 74 },
    { at: 90, x: 700, y: 460 },
  ])
  const clicking = frame >= 46 && frame <= 56
  const ripple = frame >= 46 && frame <= 66 ? (frame - 46) / 20 : 0

  const running = frame >= RUN_AT.a && frame < RUN_AT.c + 26
  const allDone = frame >= RUN_AT.c + 26

  // 输出 JSON 逐行出现
  const outStart = 268
  const outLines = CONTENT.runOutput.filter((_, i) => frame >= outStart + i * 11)

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg }}>
      <div style={{ display: 'flex', height: '100%' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <svg width="100%" height="100%" viewBox="0 0 1000 760" style={{ position: 'absolute', inset: 0 }}>
            <CanvasBackdrop width={1000} height={760} />
            <Edge from={nodes[0]!} to={nodes[1]!} grow={1} flow={flow1} frame={frame} />
            <Edge from={nodes[1]!} to={nodes[2]!} grow={1} flow={flow2} frame={frame} />
            {nodes.map((n) => (
              <Node key={n.id} node={n} frame={frame} />
            ))}
            <Cursor x={cursor.x} y={cursor.y} press={clicking ? 1 : 0} ripple={ripple} />
          </svg>

          {/* 顶部工具条：工作流名 + Execute 按钮 */}
          <div
            style={{
              position: 'absolute',
              top: 34,
              left: 40,
              right: 40,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <span style={{ fontFamily: FONT.sans, fontSize: 22, color: BRAND.text, fontWeight: 600 }}>
              天气同步
            </span>
            <span style={{ fontFamily: FONT.sans, fontSize: 15, color: BRAND.textFaint }}>已保存</span>
            <div style={{ flex: 1 }} />
            <div
              style={{
                padding: '11px 22px',
                borderRadius: 9,
                backgroundColor: allDone ? 'rgba(61,220,132,0.18)' : running ? 'rgba(255,194,71,0.18)' : BRAND.accent,
                border: `1px solid ${allDone ? BRAND.ok : running ? BRAND.warn : BRAND.accent}`,
                fontFamily: FONT.sans,
                fontSize: 18,
                fontWeight: 600,
                color: allDone ? BRAND.ok : running ? BRAND.warn : '#fff',
              }}
            >
              {allDone ? '执行完成' : running ? '执行中…' : 'Execute Workflow'}
            </div>
          </div>

          {/* 执行统计 */}
          <div
            style={{
              position: 'absolute',
              bottom: 42,
              left: 44,
              fontFamily: FONT.mono,
              fontSize: 17,
              color: BRAND.textFaint,
              opacity: interpolate(frame, [300, 322], [0, 1], clamp),
            }}
          >
            {allDone ? '3 节点执行成功 · 耗时 412ms' : ''}
          </div>
        </div>

        {/* 右侧输出面板 */}
        <div
          style={{
            width: 470,
            backgroundColor: '#16181f',
            borderLeft: `1px solid ${BRAND.border}`,
            padding: '44px 30px',
            opacity: interpolate(frame, [250, 272], [0, 1], clamp),
          }}
        >
          <div
            style={{
              fontFamily: FONT.sans,
              fontSize: 15,
              color: BRAND.textFaint,
              letterSpacing: 1.4,
              marginBottom: 20,
            }}
          >
            输出
          </div>

          <div
            style={{
              padding: '18px 20px',
              borderRadius: 10,
              backgroundColor: 'rgba(10,12,20,0.8)',
              border: `1px solid ${BRAND.border}`,
              fontFamily: FONT.mono,
              fontSize: 17,
              lineHeight: 1.85,
              color: BRAND.text,
              minHeight: 200,
            }}
          >
            {outLines.map((line) => (
              <div key={line} style={{ color: line.includes('true') ? BRAND.ok : BRAND.text }}>
                {line}
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 22,
              padding: '12px 16px',
              borderRadius: 9,
              backgroundColor: 'rgba(61,220,132,0.10)',
              border: '1px solid rgba(61,220,132,0.35)',
              fontFamily: FONT.sans,
              fontSize: 17,
              color: BRAND.ok,
              opacity: interpolate(frame, [322, 344], [0, 1], clamp),
            }}
          >
            执行成功 · 已写入 1 条记录
          </div>
        </div>
      </div>
    </AbsoluteFill>
  )
}
