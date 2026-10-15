/**
 * 凭据向导单测：验证「需要什么 / 已有什么 / 差什么」的判定，以及**绝不涉及密钥**。
 */
import { describe, expect, it } from 'vitest'
import { analyzeCredentials, credentialHint } from '../src/n8n/credentials'

const sheets = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  type: 'n8n-nodes-base.googleSheets',
  typeVersion: 4,
  position: [0, 0],
  parameters: {},
  ...extra
})

describe('analyzeCredentials', () => {
  it('内置映射表能识别常见节点需要的凭据类型', () => {
    const report = analyzeCredentials([sheets('写入表格')], [])
    expect(report.requirements).toEqual([
      {
        node: '写入表格',
        nodeType: 'n8n-nodes-base.googleSheets',
        credentialType: 'googleSheetsOAuth2Api',
        status: 'missing',
        disabled: false
      }
    ])
    expect(report.ok).toBe(false)
    expect(report.missing[0]?.credentialType).toBe('googleSheetsOAuth2Api')
    expect(report.missing[0]?.nodes).toEqual(['写入表格'])
  })

  it('实例里已有该类型凭据时判定为 ok', () => {
    const report = analyzeCredentials([sheets('写入表格')], ['googleSheetsOAuth2Api'])
    expect(report.requirements[0]?.status).toBe('ok')
    expect(report.ok).toBe(true)
    expect(report.missing).toEqual([])
  })

  it('节点自身声明的凭据类型优先（映射表没有也能识别）', () => {
    const node = {
      name: '自定义节点',
      type: 'n8n-nodes-base.someUnknownIntegration',
      typeVersion: 1,
      position: [0, 0],
      credentials: { myCustomApi: { id: '1', name: 'c' } }
    }
    const report = analyzeCredentials([node], [])
    expect(report.requirements[0]?.credentialType).toBe('myCustomApi')
    expect(report.unverified).toEqual([])
  })

  it('被禁用的节点不会算作「缺失」（它不阻止激活）', () => {
    const report = analyzeCredentials([sheets('已禁用', { disabled: true })], [])
    expect(report.requirements[0]).toMatchObject({ status: 'missing', disabled: true })
    expect(report.missing).toEqual([])
    expect(report.ok).toBe(true)
  })

  it('同一凭据类型被多个节点需要时合并成一条', () => {
    const report = analyzeCredentials([sheets('A'), sheets('B'), sheets('C')], [])
    expect(report.missing).toHaveLength(1)
    expect(report.missing[0]?.nodes).toEqual(['A', 'B', 'C'])
  })

  it('纯逻辑节点不会进「无法判断」列表', () => {
    const nodes = [
      { name: 'Code', type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0] },
      { name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
      { name: 'If', type: 'n8n-nodes-base.if', typeVersion: 2, position: [0, 0] },
      { name: 'HTTP', type: 'n8n-nodes-base.httpRequest', typeVersion: 4, position: [0, 0] }
    ]
    const report = analyzeCredentials(nodes, [])
    expect(report.requirements).toEqual([])
    expect(report.unverified).toEqual([])
    expect(report.ok).toBe(true)
  })

  it('未知的集成节点会进「无法判断」列表（最多 10 条）', () => {
    const nodes = Array.from({ length: 13 }, (_, i) => ({
      name: `N${i}`,
      type: 'n8n-nodes-base.mysteryIntegration',
      typeVersion: 1,
      position: [0, 0]
    }))
    const report = analyzeCredentials(nodes, [])
    expect(report.unverified).toHaveLength(10)
    expect(report.unverified[0]).toEqual({ node: 'N0', nodeType: 'n8n-nodes-base.mysteryIntegration' })
  })

  it('LangChain 模型节点需要对应凭据', () => {
    const report = analyzeCredentials(
      [{ name: 'DeepSeek', type: '@n8n/n8n-nodes-langchain.lmChatDeepSeek', typeVersion: 1, position: [0, 0] }],
      []
    )
    expect(report.missing[0]?.credentialType).toBe('deepSeekApi')
  })

  it('Local Ollama 不需要凭据', () => {
    const report = analyzeCredentials(
      [{ name: 'Ollama', type: '@n8n/n8n-nodes-langchain.lmChatOllama', typeVersion: 1, position: [0, 0] }],
      []
    )
    expect(report.requirements).toEqual([])
    expect(report.unverified).toEqual([])
  })

  it('返回凭据配置入口，并在 note 里声明这是尽力而为的分析', () => {
    const report = analyzeCredentials([sheets('A')], [], 'http://n8n.test/home/credentials')
    expect(report.credentialsUrl).toBe('http://n8n.test/home/credentials')
    expect(report.note).toContain('尽力而为')
    expect(report.note).toContain('不会读取')
  })

  it('结论里不含任何密钥字段（只有类型名）', () => {
    const report = analyzeCredentials([sheets('A')], ['openAiApi'])
    const text = JSON.stringify(report)
    expect(text).not.toMatch(/apiKey|secret|password|token/i)
    expect(report.available).toEqual(['openAiApi'])
  })

  it('输入不是数组时安全返回空报告', () => {
    expect(analyzeCredentials(undefined, []).requirements).toEqual([])
    expect(analyzeCredentials({}, []).ok).toBe(true)
  })

  it('credentialHint 对已知类型给出具体指引，未知类型也能兜底', () => {
    expect(credentialHint('googleSheetsOAuth2Api')).toContain('Google')
    expect(credentialHint('somethingBrandNew')).toContain('somethingBrandNew')
  })
})
