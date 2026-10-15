/**
 * 真实 n8n 端到端脚本（手动运行，非单元测试）。
 *
 * 用法（不要在仓库里写死密钥）：
 *   N8N_BASE_URL=http://127.0.0.1:5678 N8N_API_KEY=xxxx node scripts/e2e-real.mjs
 *
 * 流程：建临时 Webhook 工作流 → 激活 → 用插件的 N8nClient 触发 → 校验回显 →
 *       停用并删除 → **确认真的删干净**。
 *
 * 防「假绿灯」的三条纪律：
 *  1. webhook 路径与工作流名带随机后缀，绝不撞上既有工作流；
 *  2. publish 只在 404/405 时才回退 /activate，并**校验 active 状态**；
 *  3. 触发断言回显的 nonce，清理断言删除结果，任一步失败都以非 0 退出。
 */
import { N8nClient } from '../lib/n8n/client.js'

const baseUrl = process.env.N8N_BASE_URL
const apiKey = process.env.N8N_API_KEY
if (!baseUrl || !apiKey) {
  console.error('缺少 N8N_BASE_URL / N8N_API_KEY 环境变量')
  process.exit(1)
}

const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const WEBHOOK_PATH = `dsh-n8n-lg-e2e/${RUN_ID}`
const WF_NAME = `DSH-N8N-LG E2E (temporary ${RUN_ID})`
const NONCE = `nonce-${RUN_ID}`

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
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: 'return [{ json: { ok: true, nonce: $json.body?.nonce ?? null } }];'
      },
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
let ok = false
const client = new N8nClient({ baseUrl, apiKey, timeoutMs: 15000 })

try {
  console.log('1) 创建工作流 …')
  const created = await api('POST', '/api/v1/workflows', workflow)
  if (created.status !== 200 && created.status !== 201) {
    throw new Error(`创建工作流失败 HTTP ${created.status}: ${JSON.stringify(created.json).slice(0, 300)}`)
  }
  createdId = created.json?.id
  if (!createdId) throw new Error('创建响应里没有 workflow id')
  console.log('   workflowId =', createdId)

  console.log('2) 激活工作流 …')
  let pub = await api('POST', `/api/v1/workflows/${createdId}/publish`, {})
  if (pub.status === 404 || pub.status === 405) {
    console.log('   /publish 不可用，回退 /activate')
    pub = await api('POST', `/api/v1/workflows/${createdId}/activate`, {})
  }
  if (pub.status >= 400) {
    throw new Error(`激活失败 HTTP ${pub.status}: ${JSON.stringify(pub.json).slice(0, 300)}`)
  }
  const afterPublish = await api('GET', `/api/v1/workflows/${createdId}`)
  const isActive = afterPublish.json?.active === true || afterPublish.json?.activeVersionId != null
  console.log('   active =', afterPublish.json?.active, '; activeVersionId =', afterPublish.json?.activeVersionId)
  if (!isActive) throw new Error('激活后工作流仍未处于 active 状态')

  console.log('3) 用插件 N8nClient 触发 webhook …')
  let triggered
  for (let i = 0; i < 10; i++) {
    try {
      triggered = await client.triggerWebhook(WEBHOOK_PATH, { nonce: NONCE })
      break
    } catch (e) {
      if (i === 9) throw e
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  console.log('   trigger 结果 =', JSON.stringify(triggered).slice(0, 300))
  if (triggered?.status !== 200) throw new Error(`触发未返回 200：${triggered?.status}`)
  if (triggered?.result?.nonce !== NONCE) {
    throw new Error(`回显不匹配（可能触发了别的工作流）：期望 ${NONCE}，实际 ${triggered?.result?.nonce}`)
  }

  console.log('4) 用插件 N8nClient 列出工作流 …')
  const list = await client.listWorkflows({ limit: 50 })
  const found = list.data.some((w) => w.id === createdId)
  console.log('   工作流数量 =', list.data.length, '；包含临时工作流 =', found)
  if (!found) throw new Error('列表里找不到刚创建的工作流')

  ok = true
} catch (err) {
  console.error('\n❌ 端到端异常：', err?.message ?? err)
} finally {
  if (createdId) {
    console.log('5) 清理：停用并删除临时工作流 …')
    const deact = await api('POST', `/api/v1/workflows/${createdId}/deactivate`, {})
    console.log('   deactivate status =', deact.status)
    // 停用后 webhook 拆除是异步的，立刻删除会撞竞态
    await new Promise((r) => setTimeout(r, 1500))
    const del = await api('DELETE', `/api/v1/workflows/${createdId}`)
    console.log('   delete status =', del.status)
    if (del.status >= 400) {
      console.error('   ⚠ 删除失败，请手动清理临时工作流：', createdId)
      ok = false
    } else {
      const gone = await api('GET', `/api/v1/workflows/${createdId}`)
      console.log('   删除后复查 status =', gone.status, '（404 表示已删干净）')
      if (gone.status !== 404) {
        console.error('   ⚠ 删除后仍能读到该工作流')
        ok = false
      }
    }
  }
}

console.log(ok ? '\n✅ 真实端到端通过' : '\n❌ 端到端失败')
process.exitCode = ok ? 0 : 2
