/**
 * 插件装配层测试。
 *
 * 覆盖率报告显示 src/config.ts、src/index.ts、src/tools/sandbox.ts 是 0% ——
 * 也就是说「插件能不能正常装起来」这条路径完全没有回归保护：
 * schema 默认值错了、apply 少注册了东西、沙箱工具没挂上，单测都不会发现。
 *
 * 这里直接调用 apply() 与 registerSandboxTools()，用假的 Context 观察副作用。
 */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { Config } from '../src/config'
import { apply } from '../src/index'
import { registerSandboxTools } from '../src/tools/sandbox'
import type { DockerSandbox } from '../src/sandbox/docker'

type Registered = { name: string }

function makeCtx(extra: Record<string, unknown> = {}) {
  const tools: Registered[] = []
  const provided: Record<string, unknown> = {}
  const logs: string[] = []
  const ctx = {
    tools: {
      register: (tool: Registered) => {
        tools.push(tool)
        return () => {}
      }
    },
    provide: (name: string, value: unknown) => {
      provided[name] = value
    },
    logger: {
      info: (m: string) => logs.push(`info:${m}`),
      warn: (m: string) => logs.push(`warn:${m}`)
    },
    ...extra
  }
  return { ctx: ctx as unknown as Context, tools, provided, logs }
}

/** 用 schema 生成一份完整的默认配置（等价于 DSH 加载时填充的结果）。 */
function defaultConfig(): Config {
  return Config({}) as Config
}

describe('Config schema 默认值', () => {
  it('空对象也能填充出全部默认值', () => {
    const c = defaultConfig()
    expect(c.allowedWebhookPaths).toEqual([])
    expect(c.timeoutMs).toBe(30_000)
    expect(c.useTestWebhook).toBe(false)
    expect(c.sandbox).toBeTruthy()
    expect(c.sandbox.enabled).toBe(false)
    expect(c.sandbox.image).toContain('n8n')
    expect(c.sandbox.containerPort).toBe(5678)
    expect(c.sandbox.timezone).toBe('Asia/Shanghai')
    expect(c.sandbox.noNewPrivileges).toBe(true)
  })

  it('沙箱默认宿主端口避开 n8n 默认的 5678（否则会和本机实例抢端口）', () => {
    const c = defaultConfig()
    expect(c.sandbox.hostPort).toBe(5679)
    expect(c.sandbox.hostPort).not.toBe(c.sandbox.containerPort)
  })

  it('传入的值会覆盖默认值', () => {
    const c = Config({ timeoutMs: 5000, sandbox: { enabled: true } }) as Config
    expect(c.timeoutMs).toBe(5000)
    expect(c.sandbox.enabled).toBe(true)
    // 部分覆盖时，未指定的沙箱字段仍取默认值
    expect(c.sandbox.containerPort).toBe(5678)
  })
})

describe('apply() 装配', () => {
  it('未配置连接也不阻断加载：21 个 n8n 工具照常注册，并记一条 warn', () => {
    const { ctx, tools, logs } = makeCtx()
    apply(ctx, defaultConfig())

    expect(tools).toHaveLength(21)
    expect(tools.map((t) => t.name)).toContain('n8n_list_workflows')
    expect(logs.some((l) => l.startsWith('warn:') && l.includes('尚未配置'))).toBe(true)
  })

  it('已配置连接时记 info（含来源），而不是 warn', () => {
    const { ctx, logs } = makeCtx()
    const cfg = { ...defaultConfig(), baseUrl: 'http://127.0.0.1:5678', apiKey: 'k' }
    apply(ctx, cfg)

    expect(logs.some((l) => l.startsWith('info:') && l.includes('来源'))).toBe(true)
    expect(logs.some((l) => l.includes('尚未配置'))).toBe(false)
  })

  it('sandbox.enabled = false 时不提供 n8nSandbox、不注册沙箱工具', () => {
    const { ctx, tools, provided } = makeCtx()
    apply(ctx, defaultConfig())

    expect(provided.n8nSandbox).toBeUndefined()
    expect(tools.some((t) => t.name.startsWith('n8n_sandbox_'))).toBe(false)
  })

  it('sandbox.enabled = true 时提供 n8nSandbox 并注册 5 个沙箱工具', () => {
    const { ctx, tools, provided } = makeCtx()
    const cfg = defaultConfig()
    cfg.sandbox.enabled = true
    apply(ctx, cfg)

    expect(provided.n8nSandbox).toBeTruthy()
    const sandboxTools = tools.filter((t) => t.name.startsWith('n8n_sandbox_')).map((t) => t.name)
    expect(sandboxTools.sort()).toEqual([
      'n8n_sandbox_logs',
      'n8n_sandbox_remove',
      'n8n_sandbox_start',
      'n8n_sandbox_status',
      'n8n_sandbox_stop'
    ])
  })

  it('宿主没有 webServer 时只记 warn，不抛错（headless profile 也要能加载）', () => {
    const { ctx, logs } = makeCtx()
    expect(() => apply(ctx, defaultConfig())).not.toThrow()
    expect(logs.some((l) => l.includes('无 webServer'))).toBe(true)
  })

  it('宿主有 webServer 时注册 HUD 路由', () => {
    const register = vi.fn(() => () => {})
    const { ctx, logs } = makeCtx({ webServer: { register } })
    apply(ctx, defaultConfig())

    expect(register).toHaveBeenCalled()
    expect(logs.some((l) => l.includes('HUD 代理路由已注册'))).toBe(true)
  })

  it('存在 inject 时通过它等 webServer 就绪再挂路由（而不是直接读）', () => {
    const injected: string[][] = []
    const { ctx } = makeCtx({
      inject: (deps: string[], cb: (child: unknown) => void) => {
        injected.push(deps)
        cb({ webServer: { register: () => () => {} }, effect: () => {} })
      }
    })
    apply(ctx, defaultConfig())

    // 用 inject 而不是直接读 ctx.webServer —— 否则服务未就绪时路由会漏注册
    expect(injected).toContainEqual(['webServer'])
    // 另外还会注入 sessionController：浮窗里「右键节点提需求」要靠它把消息投给 Agent
    expect(injected).toContainEqual(['sessionController'])
  })
})

describe('registerSandboxTools', () => {
  function fakeSandbox() {
    const calls: string[] = []
    const sandbox = {
      endpoint: 'http://127.0.0.1:5679',
      start: async () => {
        calls.push('start')
        return { created: false }
      },
      stop: async () => {
        calls.push('stop')
      },
      status: async () => {
        calls.push('status')
        return { exists: true, running: true, managed: true }
      },
      live: async () => {
        calls.push('live')
        return true
      },
      ready: async () => {
        calls.push('ready')
        return true
      },
      waitUntilHealthy: async () => {
        calls.push('waitUntilHealthy')
        return true
      },
      logs: async (tail: number) => {
        calls.push(`logs:${tail}`)
        return 'log line'
      },
      remove: async () => {
        calls.push('remove')
      }
    }
    return { sandbox: sandbox as unknown as DockerSandbox, calls }
  }

  function collect() {
    const { sandbox, calls } = fakeSandbox()
    const { ctx, tools } = makeCtx()
    registerSandboxTools(ctx, sandbox)
    const byName = new Map(tools.map((t) => [(t as unknown as { name: string }).name, t]))
    return { calls, byName, sandbox }
  }

  it('注册 5 个工具', () => {
    const { byName } = collect()
    expect([...byName.keys()].sort()).toEqual([
      'n8n_sandbox_logs',
      'n8n_sandbox_remove',
      'n8n_sandbox_start',
      'n8n_sandbox_status',
      'n8n_sandbox_stop'
    ])
  })

  it('start 会等就绪，并把 live / ready 分开报告', async () => {
    const { calls, byName } = collect()
    const tool = byName.get('n8n_sandbox_start') as unknown as {
      execute: (a: unknown, e: unknown) => Promise<unknown>
    }
    const out = (await tool.execute({}, {})) as { live: boolean; ready: boolean; endpoint: string }

    expect(calls).toContain('start')
    expect(calls).toContain('waitUntilHealthy')
    expect(out.ready).toBe(true)
    expect(out.live).toBe(true)
    expect(out.endpoint).toBe('http://127.0.0.1:5679')
  })

  it('status 在容器没跑时不调用 live/ready（避免无谓探测）', async () => {
    const { sandbox } = fakeSandbox()
    const stopped = {
      ...(sandbox as unknown as Record<string, unknown>),
      status: async () => ({ exists: true, running: false, managed: true })
    }
    const { ctx, tools } = makeCtx()
    registerSandboxTools(ctx, stopped as unknown as DockerSandbox)

    const liveCalls: string[] = []
    const sandboxAny = stopped as unknown as { live: () => Promise<boolean>; ready: () => Promise<boolean> }
    sandboxAny.live = async () => {
      liveCalls.push('live')
      return true
    }
    sandboxAny.ready = async () => {
      liveCalls.push('ready')
      return true
    }

    const tool = tools.find(
      (t) => (t as unknown as { name: string }).name === 'n8n_sandbox_status'
    ) as unknown as { execute: (a: unknown, e: unknown) => Promise<unknown> }
    const out = (await tool.execute({}, {})) as { live: boolean; ready: boolean }

    expect(liveCalls).toEqual([])
    expect(out.live).toBe(false)
    expect(out.ready).toBe(false)
  })

  it('logs 默认取 100 行', async () => {
    const { calls, byName } = collect()
    const tool = byName.get('n8n_sandbox_logs') as unknown as {
      execute: (a: unknown, e: unknown) => Promise<unknown>
    }
    await tool.execute({}, {})
    expect(calls).toContain('logs:100')

    await tool.execute({ tail: 20 }, {})
    expect(calls).toContain('logs:20')
  })
})
