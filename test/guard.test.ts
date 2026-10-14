import { describe, it, expect } from 'vitest'
import { isWebhookPathAllowed, normalizeWebhookPath } from '../src/n8n/guard'

describe('normalizeWebhookPath', () => {
  it('去掉首尾斜杠', () => {
    expect(normalizeWebhookPath('/a/b/')).toBe('a/b')
    expect(normalizeWebhookPath('///a///')).toBe('a')
    expect(normalizeWebhookPath('a')).toBe('a')
  })
})

describe('isWebhookPathAllowed', () => {
  it('白名单为空 → 放行全部（MVP 默认）', () => {
    expect(isWebhookPathAllowed('anything', [])).toBe(true)
    expect(isWebhookPathAllowed('anything', undefined)).toBe(true)
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
