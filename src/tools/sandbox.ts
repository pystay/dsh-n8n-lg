/**
 * 沙箱工具：用独立的容器沙箱（Docker）跑 n8n，供 Agent 启停/查看。
 *
 * 注意：容器「启动成功」不等于 n8n「可调用 API」——n8n 启动后还要连数据库、
 * 跑迁移。因此 start 之后用 readiness 判定，并把两者分开报告。
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
        'Returns the endpoint plus live/ready flags — `ready` is what you need before calling the API.',
      parameters: {},
      output: jsonOutput,
      async execute(_args, exec) {
        const signal = (exec as { signal?: AbortSignal } | undefined)?.signal
        const result = await sandbox.start({ signal })
        // 启动后轮询等待 n8n 就绪（readiness：DB 已连接 + 已迁移）
        const ready = await sandbox.waitUntilHealthy(60_000, 2000, { signal })
        const live = await sandbox.live()
        return asJson({ ...result, live, ready, endpoint: sandbox.endpoint })
      }
    })
  )

  ctx.tools.register(
    defineTool({
      name: 'n8n_sandbox_stop',
      description: 'Stop the isolated n8n container sandbox.',
      parameters: {},
      output: jsonOutput,
      async execute(_args, exec) {
        const signal = (exec as { signal?: AbortSignal } | undefined)?.signal
        await sandbox.stop({ signal })
        return asJson({ stopped: true, container: sandbox.endpoint })
      }
    })
  )

  ctx.tools.register(
    defineTool({
      name: 'n8n_sandbox_status',
      description:
        'Show the n8n container sandbox status (exists/running/managed/state/endpoint) plus liveness and readiness probes.',
      parameters: {},
      output: jsonOutput,
      async execute(_args, exec) {
        const signal = (exec as { signal?: AbortSignal } | undefined)?.signal
        const status = await sandbox.status({ signal })
        const live = status.running ? await sandbox.live() : false
        const ready = status.running ? await sandbox.ready() : false
        return asJson({ ...status, live, ready })
      }
    })
  )

  ctx.tools.register(
    defineTool({
      name: 'n8n_sandbox_logs',
      description: 'Tail the n8n container sandbox logs.',
      parameters: {
        tail: { type: 'number', description: 'Number of trailing log lines (default 100, max 2000).' }
      },
      output: jsonOutput,
      async execute(args, exec) {
        const signal = (exec as { signal?: AbortSignal } | undefined)?.signal
        return asJson({ logs: await sandbox.logs(args.tail ?? 100, { signal }) })
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
      async execute(_args, exec) {
        const signal = (exec as { signal?: AbortSignal } | undefined)?.signal
        await sandbox.remove({ signal })
        return asJson({ removed: true })
      }
    })
  )
}
