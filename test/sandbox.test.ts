import { afterEach, describe, expect, it, vi } from 'vitest'
import { DockerSandbox, type CommandRunner, type RunResult, type SandboxConfig } from '../src/sandbox/docker'

const CONFIG: SandboxConfig = {
  image: 'docker.n8n.io/n8nio/n8n:latest',
  containerName: 'dsh-n8n-lg',
  hostPort: 5678,
  containerPort: 5678,
  dataVolume: 'dsh-n8n-lg-data',
  timezone: 'Asia/Shanghai'
}

const ok = (stdout = ''): RunResult => ({ code: 0, stdout, stderr: '' })
const NOT_FOUND: RunResult = { code: 1, stdout: '', stderr: 'Error: No such object: dsh-n8n-lg' }

/** 记录调用并返回预设结果的假执行器。 */
function fakeRunner(handler: (argv: readonly string[]) => RunResult) {
  const calls: string[][] = []
  const runner: CommandRunner = async (argv) => {
    calls.push([...argv])
    return handler(argv)
  }
  return { runner, calls }
}

/**
 * 按 docker 子命令分派的假执行器：
 * - inspect -f {{.State.Status}}  → state（null 表示容器不存在，undefined 表示 daemon 故障）
 * - inspect -f {{json .Config.Labels}} → labels
 */
function dockerFake(opts: {
  state?: string | null
  labels?: Record<string, string> | null
  logsCode?: number
  logsOut?: string
  fail?: Partial<Record<'run' | 'start' | 'stop' | 'rm', RunResult>>
} = {}) {
  return fakeRunner((argv) => {
    const sub = argv[1]
    if (sub === 'inspect') {
      const format = argv[3]
      if (format === '{{.State.Status}}') {
        if (opts.state === null) return NOT_FOUND
        if (opts.state === undefined) {
          return { code: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock' }
        }
        return ok(`${opts.state}\n`)
      }
      if (format === '{{json .Config.Labels}}') {
        if (opts.labels === null) return NOT_FOUND
        return ok(`${JSON.stringify(opts.labels ?? {})}\n`)
      }
    }
    if (sub === 'logs') {
      return { code: opts.logsCode ?? 0, stdout: opts.logsOut ?? '', stderr: '' }
    }
    if (sub === 'run' || sub === 'start' || sub === 'stop' || sub === 'rm') {
      const failed = opts.fail?.[sub]
      if (failed) return failed
    }
    return ok()
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DockerSandbox.buildRunArgs', () => {
  it('只绑定 127.0.0.1、挂数据卷、注入环境变量与镜像', () => {
    const args = new DockerSandbox(CONFIG).buildRunArgs()
    expect(args.slice(0, 4)).toEqual(['docker', 'run', '-d', '--name'])
    expect(args).toContain('dsh-n8n-lg')
    expect(args).toContain('127.0.0.1:5678:5678')
    expect(args).toContain('dsh-n8n-lg-data:/home/node/.n8n')
    expect(args).toContain('N8N_HOST=127.0.0.1')
    expect(args).toContain('N8N_SECURE_COOKIE=false')
    expect(args).toContain('GENERIC_TIMEZONE=Asia/Shanghai')
    expect(args.at(-1)).toBe('docker.n8n.io/n8nio/n8n:latest')
  })

  it('带归属标签与默认提权保护（避免误操作同名容器）', () => {
    const args = new DockerSandbox(CONFIG).buildRunArgs()
    expect(args).toContain('dsh-n8n-lg.managed=true')
    expect(args).toContain('--security-opt')
    expect(args).toContain('no-new-privileges')
  })

  it('可选资源上限会写进命令', () => {
    const args = new DockerSandbox({ ...CONFIG, memoryLimitMb: 1024, cpus: '1.5', pidsLimit: 256 }).buildRunArgs()
    expect(args).toContain('1024m')
    expect(args).toContain('1.5')
    expect(args).toContain('256')
  })

  it('extraEnv 可覆盖/追加环境变量', () => {
    const args = new DockerSandbox({ ...CONFIG, extraEnv: { N8N_LOG_LEVEL: 'debug' } }).buildRunArgs()
    expect(args).toContain('N8N_LOG_LEVEL=debug')
  })
})

describe('DockerSandbox.status', () => {
  it('容器不存在 → exists=false（不抛错）', async () => {
    const { runner } = dockerFake({ state: null })
    const s = await new DockerSandbox(CONFIG, runner).status()
    expect(s).toEqual({ exists: false, running: false, endpoint: 'http://127.0.0.1:5678' })
  })

  it('docker daemon 不可达 → 抛错（回归：此前会误判为「不存在」）', async () => {
    const { runner } = dockerFake({ state: undefined })
    await expect(new DockerSandbox(CONFIG, runner).status()).rejects.toThrow(/docker inspect 失败/)
  })

  it('running 状态并识别归属标签', async () => {
    const { runner } = dockerFake({ state: 'running', labels: { 'dsh-n8n-lg.managed': 'true' } })
    const s = await new DockerSandbox(CONFIG, runner).status()
    expect(s).toMatchObject({ exists: true, running: true, state: 'running', managed: true })
  })

  it('exited 状态且非本插件管理', async () => {
    const { runner } = dockerFake({ state: 'exited', labels: {} })
    const s = await new DockerSandbox(CONFIG, runner).status()
    expect(s).toMatchObject({ exists: true, running: false, managed: false })
  })
})

describe('DockerSandbox.start', () => {
  it('容器不存在时执行 docker run（用 buildRunArgs）', async () => {
    const { runner, calls } = dockerFake({ state: null })
    const sb = new DockerSandbox(CONFIG, runner)
    const res = await sb.start()
    expect(res.created).toBe(true)
    expect(res.endpoint).toBe('http://127.0.0.1:5678')
    expect(calls.find((c) => c[1] === 'run')).toEqual(sb.buildRunArgs())
  })

  it('容器已存在但停止（且为本插件管理）→ 执行 docker start', async () => {
    const { runner, calls } = dockerFake({ state: 'exited', labels: { 'dsh-n8n-lg.managed': 'true' } })
    const res = await new DockerSandbox(CONFIG, runner).start()
    expect(res.created).toBe(false)
    expect(calls.some((c) => c[1] === 'start' && c[2] === 'dsh-n8n-lg')).toBe(true)
    expect(calls.some((c) => c[1] === 'run')).toBe(false)
  })

  it('已运行且受管理 → 不做任何变更', async () => {
    const { runner, calls } = dockerFake({ state: 'running', labels: { 'dsh-n8n-lg.managed': 'true' } })
    const res = await new DockerSandbox(CONFIG, runner).start()
    expect(res.created).toBe(false)
    expect(calls.some((c) => c[1] === 'start' || c[1] === 'run')).toBe(false)
  })

  it('同名容器不是本插件创建的 → 拒绝操作（回归：此前会盲目复用）', async () => {
    const { runner } = dockerFake({ state: 'exited', labels: {} })
    await expect(new DockerSandbox(CONFIG, runner).start()).rejects.toThrow(/不是本插件创建的/)
  })

  it('docker run 失败时抛错', async () => {
    const { runner } = dockerFake({ state: null, fail: { run: { code: 125, stdout: '', stderr: 'pull failed' } } })
    await expect(new DockerSandbox(CONFIG, runner).start()).rejects.toThrow(/docker run 失败/)
  })
})

describe('DockerSandbox.stop / logs', () => {
  it('stop 执行 docker stop', async () => {
    const { runner, calls } = dockerFake()
    await new DockerSandbox(CONFIG, runner).stop()
    expect(calls[0]).toEqual(['docker', 'stop', 'dsh-n8n-lg'])
  })

  it('logs 合并 stdout+stderr 并限制 tail 上限', async () => {
    const { runner, calls } = dockerFake({ logsOut: 'line1\n' })
    const text = await new DockerSandbox(CONFIG, runner).logs(999999)
    expect(text).toBe('line1')
    expect(calls[0]).toEqual(['docker', 'logs', '--tail', '2000', 'dsh-n8n-lg'])
  })

  it('logs 退出码非 0 时抛错（回归：此前错误被当成功）', async () => {
    const { runner } = dockerFake({ logsCode: 1, logsOut: 'no such container' })
    await expect(new DockerSandbox(CONFIG, runner).logs(10)).rejects.toThrow(/docker logs 失败/)
  })
})

describe('DockerSandbox 健康探测（区分存活与就绪）', () => {
  it('ready() 探测 /healthz/readiness', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await new DockerSandbox(CONFIG).ready()).toBe(true)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://127.0.0.1:5678/healthz/readiness')
  })

  it('readiness 返回 503 时 ready()=false（存活 200 也不算就绪）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })))
    expect(await new DockerSandbox(CONFIG).ready()).toBe(false)
  })

  it('老版本没有 readiness 端点时回退到 /healthz', async () => {
    const seen: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        seen.push(String(url))
        return { ok: true, status: String(url).endsWith('/readiness') ? 404 : 200 }
      })
    )
    expect(await new DockerSandbox(CONFIG).ready()).toBe(true)
    expect(seen).toEqual([
      'http://127.0.0.1:5678/healthz/readiness',
      'http://127.0.0.1:5678/healthz'
    ])
  })

  it('live() 只看存活', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await new DockerSandbox(CONFIG).live()).toBe(true)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://127.0.0.1:5678/healthz')
  })

  it('网络异常时为 false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      })
    )
    expect(await new DockerSandbox(CONFIG).health()).toBe(false)
  })
})

describe('DockerSandbox.remove / waitUntilHealthy', () => {
  it('remove 执行 docker rm -f', async () => {
    const { runner, calls } = dockerFake()
    await new DockerSandbox(CONFIG, runner).remove()
    expect(calls[0]).toEqual(['docker', 'rm', '-f', 'dsh-n8n-lg'])
  })

  it('waitUntilHealthy 在就绪时返回 true', async () => {
    let n = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: ++n >= 2, status: 200 }))
    )
    expect(await new DockerSandbox(CONFIG).waitUntilHealthy(2000, 1)).toBe(true)
  })

  it('waitUntilHealthy 超时返回 false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503 }))
    )
    expect(await new DockerSandbox(CONFIG).waitUntilHealthy(30, 5)).toBe(false)
  })
})
