/**
 * 凭据向导：激活前告诉用户「还缺哪些凭据、涉及哪些节点、去哪里配」。
 *
 * 只读凭据**类型**（元数据），不读取、不索要任何密钥。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { analyzeCredentials } from '../n8n/credentials.js'
import { asJson, jsonOutput } from './common.js'
import type { ToolDeps } from './deps.js'

export function registerCredentialTools({ ctx, manager }: ToolDeps): void {
  ctx.tools.register(
    defineTool({
      name: 'n8n_check_credentials',
      description:
        'Check which credentials a workflow still needs BEFORE activating. ' +
        'Returns the required credential types per node, which ones already exist in the instance, ' +
        'and where to configure them. Reads only metadata (never any secret) and never asks the user ' +
        'to paste a secret into the chat.',
      parameters: {
        workflowId: { type: 'string', required: true, description: 'The workflow to check.' }
      },
      output: jsonOutput,
      async execute(args) {
        const wf = (await manager.client().getWorkflow(args.workflowId)) as unknown as { nodes?: unknown }
        const base = manager.resolve()?.baseUrl.replace(/\/+$/, '')
        let available: string[] = []
        let scopeWarning: string | undefined
        try {
          const list = await manager.client().listCredentials({ limit: 100 })
          available = (list.data ?? []).map((c) => c.type).filter(Boolean)
        } catch (err) {
          // API Key 可能没有 credential:list 权限：降级为「不知道已有什么」，但结论依然有用
          scopeWarning =
            '无法列出已有凭据（API Key 可能缺少 credential:list 权限），因此只能报告「需要哪些凭据」：' +
            (err instanceof Error ? err.message : String(err))
        }
        const report = analyzeCredentials(wf.nodes, available, base ? `${base}/home/credentials` : undefined)
        return asJson({ ...report, scopeWarning })
      }
    })
  )
}
