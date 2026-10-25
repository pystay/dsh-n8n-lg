/**
 * 新版（实机演示向）的设计常量。
 * 改颜色/文案/节奏都从这里改。
 */

export const BRAND = {
  bg: '#12141c',
  canvas: '#14161d',
  panel: '#1e2230',
  panelSolid: '#232733',
  border: 'rgba(255,255,255,0.10)',
  borderStrong: 'rgba(255,255,255,0.18)',
  text: '#e9edf7',
  textDim: '#9aa6c4',
  textFaint: '#8a93a6',
  accent: '#608cff',
  accentSoft: 'rgba(96,140,255,0.16)',
  ok: '#3ddc84',
  warn: '#ffc247',
  err: '#ff5c6c',
  cream: '#fffdf8',
  creamText: '#332d26',
  creamAccent: '#c4873c',
} as const

export const FONT = {
  sans: '"Microsoft YaHei", "PingFang SC", system-ui, sans-serif',
  mono: 'Consolas, "Courier New", monospace',
} as const

export const FPS = 30

/** 各场景时长（秒）。 */
export const DURATIONS = {
  empty: 6,
  manual: 11,
  prompt: 6,
  generate: 22,
  run: 14,
  edit: 12,
  hud: 9,
  end: 7,
} as const

export const CONTENT = {
  title: 'dsh-n8n-lg',
  tagline: '说一句话，AI 把 n8n 工作流搭出来',
  prompt: '收到 webhook 后调用天气 API，把结果写进数据库',
  install: 'dsh plugin --profile desktop add dsh-n8n-lg',
  repo: 'github.com/pystay/dsh-n8n-lg',

  /** 生成阶段的 AI 步骤日志 */
  aiSteps: [
    '读取工作流当前结构',
    '创建 Webhook 触发节点',
    '添加 HTTP Request 节点',
    '配置请求 URL 与 method',
    '连接 Webhook → HTTP',
    '添加 Database 写入节点',
    '连接 HTTP → Database',
    '校验节点参数与连线',
  ],

  /** 运行阶段的输出 */
  runOutput: [
    '{',
    '  "ok": true,',
    '  "city": "Hangzhou",',
    '  "temp": 21,',
    '  "saved": true',
    '}',
  ],
} as const

export const SCENE_STARTS = (() => {
  const order: Array<keyof typeof DURATIONS> = ['empty', 'manual', 'prompt', 'generate', 'run', 'edit', 'hud', 'end']
  const out: Record<string, number> = {}
  let acc = 0
  for (const k of order) {
    out[k] = acc
    acc += DURATIONS[k] * FPS
  }
  return { starts: out, totalFrames: acc } as const
})()
