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
 * 会跟随 nextCursor 翻页，避免工作流超过一页时漏检。
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
const PAGE = 250
const MAX_PAGES = 40

/** 翻页拉取全部工作流（直到 nextCursor 为空）。 */
async function fetchAllWorkflows() {
  const all = []
  let cursor
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: String(PAGE) })
    if (cursor) query.set('cursor', cursor)
    const res = await fetch(`${base}/api/v1/workflows?${query.toString()}`, { headers })
    if (!res.ok) {
      throw new Error(`读取工作流失败 HTTP ${res.status}：${(await res.text()).slice(0, 200)}`)
    }
    const body = await res.json()
    all.push(...(body.data ?? []))
    cursor = body.nextCursor
    if (!cursor) return { workflows: all, complete: true }
  }
  return { workflows: all, complete: false }
}

let result
try {
  result = await fetchAllWorkflows()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}

const { workflows, complete } = result
let totalBad = 0
console.log(
  `对照 ${valid.size} 个合法节点类型，共 ${workflows.length} 个工作流` +
    (complete ? '：\n' : `（⚠ 超过 ${MAX_PAGES} 页上限，结果可能不完整）：\n`)
)

for (const wf of workflows) {
  const bad = (wf.nodes ?? []).filter((n) => !valid.has(n.type))
  totalBad += bad.length
  console.log(`[${wf.name}] id=${wf.id} 节点数=${(wf.nodes ?? []).length} active=${wf.active}`)
  if (bad.length === 0) console.log('   ✅ 全部节点类型合法')
  else for (const n of bad) console.log(`   ❌ ${JSON.stringify(n.name)}  type=${JSON.stringify(n.type)}`)
  console.log('')
}

console.log(`合计非法节点：${totalBad}`)
process.exitCode = totalBad > 0 || !complete ? 2 : 0
