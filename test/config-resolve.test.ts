import { describe, expect, it } from 'vitest'
import { resolveConnection } from '../src/config-resolve'

describe('resolveConnection', () => {
  it('config 提供时直接用 config', () => {
    expect(resolveConnection({ baseUrl: 'http://a', apiKey: 'k1' }, {})).toEqual({
      baseUrl: 'http://a',
      apiKey: 'k1'
    })
  })

  it('config 缺失时回退到环境变量（密钥可完全不入配置文件）', () => {
    expect(
      resolveConnection({}, { N8N_BASE_URL: 'http://env', N8N_API_KEY: 'envkey' })
    ).toEqual({ baseUrl: 'http://env', apiKey: 'envkey' })
  })

  it('config 优先于环境变量', () => {
    expect(
      resolveConnection({ baseUrl: 'http://cfg', apiKey: 'cfgk' }, {
        N8N_BASE_URL: 'http://env',
        N8N_API_KEY: 'envkey'
      })
    ).toEqual({ baseUrl: 'http://cfg', apiKey: 'cfgk' })
  })

  it('启用沙箱且无 baseUrl 时用沙箱端点', () => {
    expect(
      resolveConnection({ apiKey: 'k', sandbox: { enabled: true, hostPort: 5679 } }, {})
    ).toEqual({ baseUrl: 'http://127.0.0.1:5679', apiKey: 'k' })
  })

  it('baseUrl 缺失时响亮报错', () => {
    expect(() => resolveConnection({ apiKey: 'k' }, {})).toThrow(/baseUrl/)
  })

  it('apiKey 缺失时响亮报错（即使 baseUrl 有）', () => {
    expect(() => resolveConnection({ baseUrl: 'http://a' }, {})).toThrow(/apiKey/)
  })

  it('忽略空白字符串', () => {
    expect(
      resolveConnection({ baseUrl: '  ', apiKey: '  ' }, { N8N_BASE_URL: 'http://e', N8N_API_KEY: 'ek' })
    ).toEqual({ baseUrl: 'http://e', apiKey: 'ek' })
  })
})
