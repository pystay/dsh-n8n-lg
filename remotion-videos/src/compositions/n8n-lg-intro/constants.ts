/**
 * 全片的设计常量与文案。
 * 想改颜色/文字/时长，只需要改这个文件。
 */

export const BRAND = {
  // 取浮窗深色主题的真实配色，保证视频里的界面和实际产品一致
  bg: '#12141c',
  bgSoft: '#1a1e2c',
  panel: '#1e2230',
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
  // 奶白主题，用于结尾/对比
  cream: '#fffdf8',
  creamText: '#332d26',
  creamAccent: '#c4873c',
} as const

export const FONT = {
  sans: '"Microsoft YaHei", "PingFang SC", system-ui, sans-serif',
  mono: 'Consolas, "Courier New", monospace',
} as const

export const FPS = 30

/** 各场景时长（秒）。改这里就能调片子节奏。 */
export const DURATIONS = {
  hook: 6,
  pain: 8,
  solution: 7,
  build: 12,
  hud: 12,
  edit: 10,
  safety: 9,
  stats: 7,
  end: 7,
} as const

export const CONTENT = {
  title: 'dsh-n8n-lg',
  tagline: '让 AI 直接帮你搭 n8n 工作流',
  subtitle: '一个轻量的 DSH 插件',

  pains: [
    { icon: '拖', text: '拖节点、连线条、填参数', sub: '一个流程几十次点击' },
    { icon: '盲', text: 'AI 看不到你的 n8n', sub: '只能在聊天里贴配置' },
    { icon: '险', text: '改错了不好回滚', sub: '没有快照，只能凭记忆重来' },
  ],

  toolCount: 21,
  toolGroups: [
    { n: '6', label: '读与查', desc: '工作流、执行、凭据' },
    { n: '5', label: '建与改', desc: '加节点、连边、改参数' },
    { n: '4', label: '验证与回滚', desc: '写前校验、快照、恢复' },
    { n: '6', label: '运行与沙箱', desc: '触发、日志、本地试跑' },
  ],

  safety: [
    { t: '写前校验', d: '改完先验证，通过才落库' },
    { t: '自动快照', d: '每次写入前留一份' },
    { t: '一键回滚', d: '改坏了随时退回' },
  ],

  stats: [
    { v: '21', u: '个工具', d: '覆盖搭建全流程' },
    { v: '60', u: 'kB', d: '发布包体积' },
    { v: '0', u: '依赖', d: '运行时零依赖' },
  ],

  install: 'dsh plugin --profile desktop add dsh-n8n-lg',
  repo: 'github.com/pystay/dsh-n8n-lg',
} as const

/** 场景在时间轴上的起点（帧），由 DURATIONS 累加得出。 */
export const SCENE_STARTS = (() => {
  const order: Array<keyof typeof DURATIONS> = [
    'hook',
    'pain',
    'solution',
    'build',
    'hud',
    'edit',
    'safety',
    'stats',
    'end',
  ]
  const out: Record<string, number> = {}
  let acc = 0
  for (const k of order) {
    out[k] = acc
    acc += DURATIONS[k] * FPS
  }
  return { starts: out, totalFrames: acc } as const
})()
