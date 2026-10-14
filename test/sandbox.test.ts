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

/** 记录调用并返回预设结果的假执行器。 */
function fakeRunner(handler: (argv: readonly string[]) => RunResult) {
  const calls: string[][] = []
  const runner: CommandRunner = async (argv) => {
    calls.push([...argv])
    return handler(argv)
  }
  return { runner, calls }
}

const ok = (stdout = ''): RunResult => ({ code: 0, stdout, stderr: '' })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DockerSandbox.buildRunArgs', () => {
  it('只绑定 127.0.0.1、挂数据卷、注入环境变量与镜像', () => {
    const sb = new DockerSandbox(CONFIG)
    const args = sb.buildRunArgs()
    expect(args.slice(0, 4)).toEqual(['docker', 'run', '-d', '--name'])
    expect(args).toContain('dsh-n8n-lg')
    // 端口仅绑回环
    expect(args).toContain('127.0.0.1:5678:5678')
    // 数据卷
    expect(args).toContain('dsh-n8n-lg-data:/home/node/.n8n')
    // 环境变量
    expect(args).toContain('N8N_HOST=127.0.0.1')
    expect(args).toContain('N8N_SECURE_COOKIE=false')
    expect(args).toContain('GENERIC_TIMEZONE=Asia/Shanghai')
    // 最后一个参数是镜像
    expect(args.at(-1)).toBe('docker.n8n.io/n8nio/n8n:latest')
  })

  it('extraEnv 可覆盖/追加环境变量', () => {
    const sb = new DockerSandbox({ ...CONFIG, extraEnv: { N8N_LOG_LEVEL: 'debug' } })
    expect(sb.buildRunArgs()).toContain('N8N_LOG_LEVEL=debug')
  })
})

describe('DockerSandbox.status', () => {
  it('inspect 失败（容器不存在）→ exists=false', async () => {
    const { runner } = fakeRunner(() => ({ code: 1, stdout: '', stderr: 'No such object' }))
    const sb = new DockerSandbox(CONFIG, runner)
    const s = await sb.status()
    expect(s).toEqual({ exists: false, running: false, endpoint: 'http://127.0.0.1:5678' })
  })

  it('inspect 返回 running → running=true', async () => {
    const { runner } = fakeRunner(() => ok('running\n'))
    const sb = new DockerSandbox(CONFIG, runner)
    const s = await sb.status()
    expect(s.exists).toBe(true)
    expect(s.running).toBe(true)
    expect(s.state).toBe('running')
  })

  it('inspect 返回 exited → running=false', async () => {
    const { runner } = fakeRunner(() => ok('exited\n'))
    const sb = new DockerSandbox(CONFIG, runner)
    const s = await sb.status()
    expect(s.exists).toBe(true)
    expect(s.running).toBe(false)
  })
})

describe('DockerSandbox.start', () => {
  it('容器不存在时执行 docker run（用 buildRunArgs）', async () => {
    const { runner, calls } = fakeRunner((argv) =>
      argv[1] === 'inspect' ? { code: 1, stdout: '', stderr: '' } : ok('container-id\n')
    )
    const sb = new DockerSandbox(CONFIG, runner)
    const res = await sb.start()
    expect(res.created).toBe(true)
    expect(res.endpoint).toBe('http://127.0.0.1:5678')
    const runCall = calls.find((c) => c[1] === 'run')
    expect(runCall).toEqual(sb.buildRunArgs())
  })

  it('容器已存在但停止 → 执行 docker start', async () => {
    const { runner, calls } = fakeRunner((argv) =>
      argv[1] === 'inspect' ? ok('exited\n') : ok('dsh-n8n-lg\n')
    )
    const sb = new DockerSandbox(CONFIG, runner)
    const res = await sb.start()
    expect(res.created).toBe(false)
    expect(calls.some((c) => c[1] === 'start' && c[2] === 'dsh-n8n-lg')).toBe(true)
    expect(calls.some((c) => c[1] === 'run')).toBe(false)
  })

  it('容器已运行 → 不做任何变更', async () => {
    const { runner, calls } = fakeRunner((argv) => (argv[1] === 'inspect' ? ok('running\n') : ok()))
    const sb = new DockerSandbox(CONFIG, runner)
    const res = await sb.start()
    expect(res.created).toBe(false)
    expect(calls.some((c) => c[1] === 'start' || c[1] === 'run')).toBe(false)
  })

  it('docker run 失败时抛错', async () => {
    const { runner } = fakeRunner((argv) =>
      argv[1] === 'inspect' ? { code: 1, stdout: '', stderr: '' } : { code: 125, stdout: '', stderr: 'pull failed' }
    )
    const sb = new DockerSandbox(CONFIG, runner)
    await expect(sb.start()).rejects.toThrow(/docker run 失败/)
  })
})

describe('DockerSandbox.stop / logs / health', () => {
  it('stop 执行 docker stop', async () => {
    const { runner, calls } = fakeRunner(() => ok())
    await new DockerSandbox(CONFIG, runner).stop()
    expect(calls[0]).toEqual(['docker', 'stop', 'dsh-n8n-lg'])
  })

  it('logs 合并 stdout+stderr', async () => {
    const { runner } = fakeRunner(() => ({ code: 0, stdout: 'line1\n', stderr: 'line2\n' }))
    const text = await new DockerSandbox(CONFIG, runner).logs(50)
    expect(text).toBe('line1\nline2')
  })

  it('health 在 /healthz 返回 ok 时为 true', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const healthy = await new DockerSandbox(CONFIG).health()
    expect(healthy).toBe(true)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://127.0.0.1:5678/healthz')
  })

  it('health 在网络异常时为 false', async () => {
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
    const { runner, calls } = fakeRunner(() => ok())
    await new DockerSandbox(CONFIG, runner).remove()
    expect(calls[0]).toEqual(['docker', 'rm', '-f', 'dsh-n8n-lg'])
  })

  it('waitUntilHealthy 在就绪时返回 true', async () => {
    let n = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: ++n >= 2 }))
    )
    expect(await new DockerSandbox(CONFIG).waitUntilHealthy(2000, 1)).toBe(true)
  })

  it('waitUntilHealthy 超时返回 false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false }))
    )
    expect(await new DockerSandbox(CONFIG).waitUntilHealthy(30, 5)).toBe(false)
  })
})
