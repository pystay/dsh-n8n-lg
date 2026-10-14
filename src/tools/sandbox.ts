/**
 * 沙箱工具：用独立的容器沙箱（Docker）跑 n8n，供 Agent 启停/查看。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { DockerSandbox } from '../sandbox/docker.js'
import { asJson, jsonOutput } from './common.js'

export function registerSandboxTools(ctx: Context, sandbox: DockerSandbox): void {
  ctx.tools.register(
    defineTool({
      name: 'n8n_sandbox_start',
      description:
        'Start the isolated n8n container sandbox (creates it if absent, starts it if stopped). ' +
        'Returns the endpoint the plugin should connect to.',
      parameters: {},
      output: jsonOutput,
      async execute() {
        const result = await sandbox.start()
        // 启动后轮询等待 n8n 就绪（/healthz）
        const ready = await sandbox.waitUntilHealthy()
        return asJson({ ...result, ready, endpoint: sandbox.endpoint })
      }
    })
  )

  ctx.tools.register(
    defineTool({
      name: 'n8n_sandbox_stop',
      description: 'Stop the isolated n8n container sandbox.',
      parameters: {},
      output: jsonOutput,
      async execute() {
        await sandbox.stop()
        return asJson({ stopped: true, container: sandbox.endpoint })
      }
    })
  )

  ctx.tools.register(
    defineTool({
      name: 'n8n_sandbox_status',
      description:
        'Show the n8n container sandbox status (exists/running/state/endpoint) plus a health probe.',
      parameters: {},
      output: jsonOutput,
      async execute() {
        const status = await sandbox.status()
        const healthy = status.running ? await sandbox.health() : false
        return asJson({ ...status, healthy })
      }
    })
  )

  ctx.tools.register(
    defineTool({
      name: 'n8n_sandbox_logs',
      description: 'Tail the n8n container sandbox logs.',
      parameters: {
        tail: { type: 'number', description: 'Number of trailing log lines (default 100).' }
      },
      output: jsonOutput,
      async execute(args) {
        const text = await sandbox.logs(args.tail ?? 100)
        return asJson({ logs: text })
      }
    })
  )

  ctx.tools.register(
    defineTool({
      name: 'n8n_sandbox_remove',
      description:
        'Remove the n8n container sandbox (docker rm -f). The data volume is kept, so data is not lost.',
      parameters: {},
      output: jsonOutput,
      async execute() {
        await sandbox.remove()
        return asJson({ removed: true })
      }
    })
  )
}
