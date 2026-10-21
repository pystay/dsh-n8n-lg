/**
 * 主题变量的完整性守卫。
 *
 * 主题靠 CSS 变量切换，规则只写一次。所以只要某个变量在某一套主题里漏定义，
 * 那个元素就会变成透明/继承色 —— 而且**不会报错**，只是看起来不对劲，很难查。
 *
 * 这个测试把「脚本检查」固化下来：引用到的变量必须两套都定义，且两套集合一致。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = readFileSync(join(process.cwd(), 'src/client/ui.js'), 'utf-8')

function themeNames(varName: string): Set<string> {
  const block = new RegExp(`var ${varName} = \\[(.*?)\\]\\.join`, 's').exec(SRC)
  if (!block) throw new Error(`找不到 ${varName}`)
  return new Set([...block[1]!.matchAll(/'(--n8n-[a-z0-9-]+):/g)].map((m) => m[1]!))
}

const used = new Set([...SRC.matchAll(/var\((--n8n-[a-z0-9-]+)/g)].map((m) => m[1]!))
const dark = themeNames('THEME_DARK')
const light = themeNames('THEME_LIGHT')

describe('主题变量完整性', () => {
  it('两套主题定义的变量集合完全一致', () => {
    expect([...dark].sort()).toEqual([...light].sort())
  })

  it('规则里用到的每个变量在深色主题里都有定义', () => {
    const missing = [...used].filter((v) => !dark.has(v))
    expect(missing).toEqual([])
  })

  it('规则里用到的每个变量在奶白主题里都有定义', () => {
    const missing = [...used].filter((v) => !light.has(v))
    expect(missing).toEqual([])
  })

  it('没有定义了却没人用的变量（避免两套主题越堆越乱）', () => {
    const unused = [...dark].filter((v) => !used.has(v))
    expect(unused).toEqual([])
  })

  it('至少覆盖了这些关键角色', () => {
    // 不锁死具体色值，只确保「文字 / 边框 / 输入 / 画布」这些角色都抽了变量
    for (const key of ['--n8n-fg', '--n8n-border', '--n8n-input-bg', '--n8n-node-fill', '--n8n-accent']) {
      expect(dark.has(key)).toBe(true)
      expect(light.has(key)).toBe(true)
    }
  })
})

describe('动效', () => {
  it('展开/收起用 class 而不是 display（display 切换没有过渡）', () => {
    expect(SRC).toContain('.dshn8n-panel.dshn8n-hidden')
    expect(SRC).toContain('.dshn8n-orb.dshn8n-hidden')
    // 这两条若还在，说明有人把实现改回 display 了
    expect(SRC).not.toMatch(/panel\.style\.display\s*=/)
    expect(SRC).not.toMatch(/orb\.style\.display\s*=/)
  })

  it('关键动画都定义了', () => {
    expect(SRC).toContain('@keyframes dshn8n-pop')
    expect(SRC).toContain('@keyframes dshn8n-pulse')
  })

  it('只有「连接中/运行中」的状态点会脉冲，正常状态不动', () => {
    const pulseRule = /\.dshn8n-dot\.wait\{[^}]*animation:dshn8n-pulse/.test(SRC)
    expect(pulseRule).toBe(true)
    // ok / err 不该有无限动画
    expect(SRC).not.toMatch(/\.dshn8n-dot\.ok\{[^}]*animation/)
    expect(SRC).not.toMatch(/\.dshn8n-dot\.err\{[^}]*animation/)
  })

  it('尊重系统的「减少动态效果」设置', () => {
    expect(SRC).toContain('prefers-reduced-motion')
    const block = /@media \(prefers-reduced-motion:reduce\)\{([^@]*)\}/.exec(SRC)
    expect(block).toBeTruthy()
    expect(block![1]).toContain('animation:none')
    expect(block![1]).toContain('transition:none')
  })

  it('隐藏的元素必须脱离文档流（否则会占位，把另一个元素挤偏）', () => {
    // opacity:0 仍然占位。收起时面板若留在流里，会把 54px 的球挤到容器底部，
    // 而拖动记录的是容器左上角 —— 结果球只有下半截能拖。
    const panelHidden = /\.dshn8n-panel\.dshn8n-hidden\{([^}]*)\}/.exec(SRC)
    expect(panelHidden).toBeTruthy()
    expect(panelHidden![1]).toContain('position:absolute')

    const orbHidden = /\.dshn8n-orb\.dshn8n-hidden\{([^}]*)\}/.exec(SRC)
    expect(orbHidden).toBeTruthy()
    expect(orbHidden![1]).toContain('position:absolute')
  })

  it('面板从左上角展开（球所在的位置），而不是右下角', () => {
    const panel = /\.dshn8n-panel\{([^}]*)\}/.exec(SRC)
    expect(panel).toBeTruthy()
    expect(panel![1]).toContain('transform-origin:0 0')
  })
})
