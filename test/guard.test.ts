import { describe, it, expect } from 'vitest'
import { buildWebhookUrl, isSafeWebhookPath, isWebhookPathAllowed, normalizeWebhookPath } from '../src/n8n/guard'

describe('normalizeWebhookPath', () => {
  it('去掉首尾斜杠', () => {
    expect(normalizeWebhookPath('/a/b/')).toBe('a/b')
    expect(normalizeWebhookPath('///a///')).toBe('a')
    expect(normalizeWebhookPath('a')).toBe('a')
  })
})

describe('isSafeWebhookPath（点段 / 分隔符 / 查询串一律拒绝）', () => {
  it('接受普通路径', () => {
    expect(isSafeWebhookPath('deploy')).toBe(true)
    expect(isSafeWebhookPath('my/hook/v2')).toBe(true)
    expect(isSafeWebhookPath('/leading/slash/')).toBe(true)
  })

  it('拒绝点段（含编码形式）', () => {
    expect(isSafeWebhookPath('deploy/../other')).toBe(false)
    expect(isSafeWebhookPath('deploy/%2e%2e/other')).toBe(false)
    expect(isSafeWebhookPath('..')).toBe(false)
    expect(isSafeWebhookPath('./x')).toBe(false)
  })

  it('拒绝查询串 / 片段 / 反斜杠 / 协议', () => {
    expect(isSafeWebhookPath('deploy?x=1')).toBe(false)
    expect(isSafeWebhookPath('deploy#frag')).toBe(false)
    expect(isSafeWebhookPath('deploy\\other')).toBe(false)
    expect(isSafeWebhookPath('http://evil.test/x')).toBe(false)
    expect(isSafeWebhookPath('//evil.test/x')).toBe(false)
  })

  it('拒绝空值与非法编码', () => {
    expect(isSafeWebhookPath('')).toBe(false)
    expect(isSafeWebhookPath('   ')).toBe(false)
    expect(isSafeWebhookPath('%zz')).toBe(false)
  })
})

describe('isWebhookPathAllowed', () => {
  it('白名单为空 → 放行全部（MVP 默认）', () => {
    expect(isWebhookPathAllowed('anything', [])).toBe(true)
    expect(isWebhookPathAllowed('anything', undefined)).toBe(true)
  })

  it('路径不安全时，即使白名单为空也拒绝', () => {
    expect(isWebhookPathAllowed('deploy/../other', [])).toBe(false)
    expect(isWebhookPathAllowed('http://evil.test/x', [])).toBe(false)
  })

  it('点段无法绕过通配白名单（回归：此前 deploy/../other 会命中 deploy/*）', () => {
    expect(isWebhookPathAllowed('deploy/../other', ['deploy/*'])).toBe(false)
  })

  it('精确匹配', () => {
    expect(isWebhookPathAllowed('deploy/prod', ['deploy/prod'])).toBe(true)
    expect(isWebhookPathAllowed('deploy/dev', ['deploy/prod'])).toBe(false)
  })

  it('忽略首尾斜杠差异', () => {
    expect(isWebhookPathAllowed('/deploy/prod/', ['deploy/prod'])).toBe(true)
  })

  it('通配符匹配', () => {
    expect(isWebhookPathAllowed('deploy/prod', ['deploy/*'])).toBe(true)
    expect(isWebhookPathAllowed('deploy/prod/x', ['deploy/*'])).toBe(true)
    expect(isWebhookPathAllowed('other/prod', ['deploy/*'])).toBe(false)
  })

  it('正则特殊字符被转义（不误判）', () => {
    expect(isWebhookPathAllowed('a.b', ['a.b'])).toBe(true)
    expect(isWebhookPathAllowed('axb', ['a.b'])).toBe(false)
  })

  it('默认拒绝未命中项', () => {
    expect(isWebhookPathAllowed('random', ['known'])).toBe(false)
  })
})

describe('buildWebhookUrl（纵深防御：最终 URL 必须自证没越界）', () => {
  it('构造生产 / 测试 URL', () => {
    expect(buildWebhookUrl('https://n8n.test', 'my/hook')).toBe('https://n8n.test/webhook/my/hook')
    expect(buildWebhookUrl('https://n8n.test', '/my/hook/', { test: true })).toBe(
      'https://n8n.test/webhook-test/my/hook'
    )
  })

  it('保留子路径部署前缀', () => {
    expect(buildWebhookUrl('https://host/n8n', 'deploy')).toBe('https://host/n8n/webhook/deploy')
  })

  it('不安全路径直接抛错', () => {
    expect(() => buildWebhookUrl('https://n8n.test', 'deploy/../other')).toThrow(/不安全/)
  })
})
