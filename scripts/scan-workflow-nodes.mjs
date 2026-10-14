/**
 * 工作流「节点体检」：对照 n8n 真实支持的节点类型，列出每个工作流里的非法节点。
 *
 * 用法：
 *   1) 先导出 n8n 的权威节点类型清单（在 n8n 容器里执行）：
 *        docker exec <容器名> n8n export:nodes --output=/work/dsh-nodes.json
 *      （/work 需是宿主可访问的挂载目录）
 *   2) 运行本脚本：
 *        N8N_BASE_URL=http://127.0.0.1:5678 \
 *        N8N_API_KEY=xxxx \
 *        N8N_NODES_JSON=D:/n8n_to_the_aliyun/work/dsh-nodes.json \
 *        node scripts/scan-workflow-nodes.mjs
 *
 * 输出：每个工作流的节点总数、非法节点清单（名称 / 类型）。
 */
import { readFileSync } from 'node:fs'

const base = process.env.N8N_BASE_URL
const key = process.env.N8N_API_KEY
const nodesJson = process.env.N8N_NODES_JSON
if (!base || !key || !nodesJson) {
  console.error('缺少 N8N_BASE_URL / N8N_API_KEY / N8N_NODES_JSON')
  process.exit(1)
}

const valid = new Set()
for (const n of JSON.parse(readFileSync(nodesJson, 'utf8'))) {
  if (n && typeof n === 'object' && typeof n.name === 'string') valid.add(n.name)
}

const headers = { 'X-N8N-API-KEY': key, Accept: 'application/json' }
const res = await fetch(`${base}/api/v1/workflows?limit=250`, { headers })
if (!res.ok) {
  console.error('读取工作流失败', res.status, (await res.text()).slice(0, 200))
  process.exit(1)
}
const { data } = await res.json()

let totalBad = 0
console.log(`对照 ${valid.size} 个合法节点类型，共 ${data.length} 个工作流：\n`)
for (const wf of data) {
  const bad = (wf.nodes ?? []).filter((n) => !valid.has(n.type))
  totalBad += bad.length
  console.log(`[${wf.name}] id=${wf.id} 节点数=${(wf.nodes ?? []).length} active=${wf.active}`)
  if (bad.length === 0) console.log('   ✅ 全部节点类型合法')
  else for (const n of bad) console.log(`   ❌ ${JSON.stringify(n.name)}  type=${JSON.stringify(n.type)}`)
  console.log('')
}
console.log(`合计非法节点：${totalBad}`)
process.exitCode = totalBad > 0 ? 2 : 0
