/**
 * 真实 n8n 端到端脚本（手动运行，非单元测试）。
 *
 * 用法（不要在仓库里写死密钥）：
 *   N8N_BASE_URL=http://127.0.0.1:5678 N8N_API_KEY=xxxx node scripts/e2e-real.mjs
 *
 * 流程：建临时 Webhook 工作流 → 激活 → 用插件的 N8nClient 触发 → 校验结果 → 删除（自清理）。
 */
import { N8nClient } from '../lib/n8n/client.js'

const baseUrl = process.env.N8N_BASE_URL
const apiKey = process.env.N8N_API_KEY
if (!baseUrl || !apiKey) {
  console.error('缺少 N8N_BASE_URL / N8N_API_KEY 环境变量')
  process.exit(1)
}

const WEBHOOK_PATH = 'dsh-n8n-lg-e2e'
const WF_NAME = 'DSH-N8N-LG E2E (temporary)'

const headers = { 'X-N8N-API-KEY': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' }

async function api(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await res.text()
  let json
  try {
    json = text ? JSON.parse(text) : undefined
  } catch {
    json = text
  }
  return { status: res.status, json }
}

const workflow = {
  name: WF_NAME,
  nodes: [
    {
      parameters: { httpMethod: 'POST', path: WEBHOOK_PATH, responseMode: 'lastNode', options: {} },
      id: 'wh-1',
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [0, 0],
      webhookId: WEBHOOK_PATH
    },
    {
      parameters: { mode: 'runOnceForAllItems', jsCode: 'return [{ json: { ok: true, echo: $json } }];' },
      id: 'code-1',
      name: 'Echo',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [220, 0]
    }
  ],
  connections: { Webhook: { main: [[{ node: 'Echo', type: 'main', index: 0 }]] } },
  settings: {}
}

let createdId
const client = new N8nClient({ baseUrl, apiKey, timeoutMs: 15000 })

try {
  console.log('1) 创建工作流 …')
  const created = await api('POST', '/api/v1/workflows', workflow)
  if (created.status !== 200 && created.status !== 201) {
    throw new Error(`创建工作流失败 HTTP ${created.status}: ${JSON.stringify(created.json).slice(0, 300)}`)
  }
  createdId = created.json?.id
  console.log('   workflowId =', createdId)

  console.log('2) 激活工作流 …')
  let pub = await api('POST', `/api/v1/workflows/${createdId}/publish`, {})
  if (pub.status >= 400) pub = await api('POST', `/api/v1/workflows/${createdId}/activate`, {})
  console.log('   publish status =', pub.status)

  // 核对激活后 n8n 到底怎么表达"已启用"（active vs activeVersionId）
  const afterPublish = await api('GET', `/api/v1/workflows/${createdId}`)
  console.log(
    '   after publish: active =',
    afterPublish.json?.active,
    '; activeVersionId =',
    afterPublish.json?.activeVersionId
  )
  const listAfter = await api('GET', '/api/v1/workflows?limit=100')
  const row = (listAfter.json?.data ?? []).find((w) => w.id === createdId)
  console.log(
    '   list row: active =',
    row?.active,
    '; activeVersionId =',
    row?.activeVersionId
  )

  console.log('3) 用插件 N8nClient 触发 webhook …')
  let triggered
  for (let i = 0; i < 10; i++) {
    try {
      triggered = await client.triggerWebhook(WEBHOOK_PATH, { hello: 'world', n: i })
      break
    } catch (e) {
      if (i === 9) throw e
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  console.log('   trigger 结果 =', JSON.stringify(triggered).slice(0, 300))

  console.log('4) 用插件 N8nClient 列出工作流 …')
  const list = await client.listWorkflows({ limit: 50 })
  console.log('   工作流数量 =', list.data.length, '；包含临时工作流 =', list.data.some((w) => w.id === createdId))

  const ok = triggered?.result?.ok === true
  console.log(ok ? '\n✅ 真实端到端通过' : '\n❌ 端到端失败')
  process.exitCode = ok ? 0 : 2
} catch (err) {
  console.error('\n❌ 端到端异常：', err?.message ?? err)
  process.exitCode = 1
} finally {
  if (createdId) {
    console.log('5) 清理：停用并删除临时工作流 …')
    // n8n 不允许直接删除激活中的工作流（会 409），必须先停用
    await api('POST', `/api/v1/workflows/${createdId}/deactivate`, {})
    const del = await api('DELETE', `/api/v1/workflows/${createdId}`)
    console.log('   delete status =', del.status)
  }
}
