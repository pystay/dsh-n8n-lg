/**
 * n8n 容器沙箱（Docker 生命周期管理）。
 *
 * 设计要点：
 * - DSH 自带的 `ctx.sandbox` 是「同宿主进程沙箱」（文件策略 + bwrap/Landlock/Windows ACL），
 *   官方明确说明「容器 / 微 VM / 远程执行是另一套能力」。因此这里实现一个**独立的容器沙箱**：
 *   用 Docker 把 n8n 跑在隔离容器里，仅绑定 127.0.0.1，数据落命名卷。
 * - 命令执行器可注入（`CommandRunner`），便于在无 Docker 守护进程时做单元测试。
 *
 * 安全边界（务必如实理解）：
 *   这是**普通的持久化 Docker 隔离**，适合运行**受信任**的工作流，
 *   **不是**可安全执行任意恶意代码的强沙箱。可选开启资源与权限硬化
 *   （`memoryLimitMb` / `cpus` / `pidsLimit` / `noNewPrivileges`）。
 */
import { spawn } from 'node:child_process'

/** 沙箱配置（全部来自插件 config）。 */
export interface SandboxConfig {
  /** n8n 镜像，如 n8nio/n8n:latest 或 docker.n8n.io/n8nio/n8n:latest。 */
  image: string
  /** 容器名。 */
  containerName: string
  /** 宿主端口（仅绑定 127.0.0.1）。 */
  hostPort: number
  /** 容器内 n8n 端口，默认 5678。 */
  containerPort: number
  /** 数据卷名（映射到容器 /home/node/.n8n）。 */
  dataVolume: string
  /** 时区，如 Asia/Shanghai。 */
  timezone: string
  /** 额外环境变量（透传给容器）。 */
  extraEnv?: Record<string, string>
  /** 可选：内存上限（MB）。 */
  memoryLimitMb?: number
  /** 可选：CPU 配额（如 "1.5"）。 */
  cpus?: string
  /** 可选：PID 上限。 */
  pidsLimit?: number
  /** 可选：禁止提权（no-new-privileges）。默认 true。 */
  noNewPrivileges?: boolean
}

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/** 可注入的命令执行器（argv 形式，非 shell 字符串）。 */
export type CommandRunner = (argv: readonly string[], opts?: { signal?: AbortSignal }) => Promise<RunResult>

/** 默认执行器：spawn 真实进程（此处即 docker CLI）。 */
export const defaultRunner: CommandRunner = (argv, opts) =>
  new Promise<RunResult>((resolve) => {
    const [program, ...args] = argv
    const child = spawn(program ?? '', args, { signal: opts?.signal })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: stderr + String(err.message) }))
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })

export interface SandboxStatus {
  /** 容器是否存在。 */
  exists: boolean
  /** 是否正在运行。 */
  running: boolean
  /** docker 状态字符串（running/exited/created…），不存在时为 undefined。 */
  state?: string
  /** 插件应连接的 n8n 基址。 */
  endpoint: string
  /** 是否为本插件管理的容器（按标签判断）；容器不存在时为 undefined。 */
  managed?: boolean
}

export interface RunOptions {
  signal?: AbortSignal
}

const DOCKER = 'docker'
const MANAGED_LABEL = 'dsh-n8n-lg.managed'
const MAX_LOG_TAIL = 2000

/** docker inspect 在「容器不存在」时的典型输出。 */
function isNotFound(stderr: string): boolean {
  return /no such (object|container)/i.test(stderr)
}

export class DockerSandbox {
  constructor(
    private readonly config: SandboxConfig,
    private readonly run: CommandRunner = defaultRunner
  ) {}

  /** 插件连接的 n8n 基址（仅本机）。 */
  get endpoint(): string {
    return `http://127.0.0.1:${this.config.hostPort}`
  }

  /** 构造 `docker run` 的完整 argv（纯函数，便于测试）。 */
  buildRunArgs(): string[] {
    const { image, containerName, hostPort, containerPort, dataVolume, timezone, extraEnv } = this.config
    const env: Record<string, string> = {
      N8N_HOST: '127.0.0.1',
      N8N_PORT: String(containerPort),
      N8N_PROTOCOL: 'http',
      N8N_SECURE_COOKIE: 'false',
      GENERIC_TIMEZONE: timezone,
      ...(extraEnv ?? {})
    }
    const args: string[] = [
      DOCKER,
      'run',
      '-d',
      '--name',
      containerName,
      // 仅绑定回环地址，不对外暴露
      '-p',
      `127.0.0.1:${hostPort}:${containerPort}`,
      '-v',
      `${dataVolume}:/home/node/.n8n`,
      '--restart',
      'unless-stopped',
      // 归属标签：避免误操作别人的同名容器
      '--label',
      `${MANAGED_LABEL}=true`,
      '--label',
      `dsh-n8n-lg.image=${image}`
    ]
    // 可选硬化：默认只加 no-new-privileges，资源上限按需开启
    if (this.config.noNewPrivileges !== false) args.push('--security-opt', 'no-new-privileges')
    if (this.config.memoryLimitMb) args.push('--memory', `${this.config.memoryLimitMb}m`)
    if (this.config.cpus) args.push('--cpus', String(this.config.cpus))
    if (this.config.pidsLimit) args.push('--pids-limit', String(this.config.pidsLimit))
    for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`)
    args.push(image)
    return args
  }

  /** 读取容器标签（用于判断是否为本插件管理）。 */
  private async readLabels(opts: RunOptions = {}): Promise<Record<string, string> | undefined> {
    const res = await this.run(
      [DOCKER, 'inspect', '-f', '{{json .Config.Labels}}', this.config.containerName],
      { signal: opts.signal }
    )
    if (res.code !== 0) return undefined
    try {
      const parsed = JSON.parse(res.stdout.trim() || '{}') as Record<string, string> | null
      return parsed ?? {}
    } catch {
      return undefined
    }
  }

  /**
   * 容器是否存在 / 运行状态。
   * 与「不存在」区分开：daemon 不可达或权限不足会**抛错**，而不是假装容器不存在。
   */
  async status(opts: RunOptions = {}): Promise<SandboxStatus> {
    const res = await this.run([DOCKER, 'inspect', '-f', '{{.State.Status}}', this.config.containerName], {
      signal: opts.signal
    })
    if (res.code !== 0) {
      if (isNotFound(res.stderr) || isNotFound(res.stdout)) {
        return { exists: false, running: false, endpoint: this.endpoint }
      }
      throw new Error(`docker inspect 失败（守护进程或权限问题）：${res.stderr.trim() || res.code}`)
    }
    const state = res.stdout.trim()
    const labels = await this.readLabels(opts)
    return {
      exists: true,
      running: state === 'running',
      state,
      endpoint: this.endpoint,
      managed: labels?.[MANAGED_LABEL] === 'true'
    }
  }

  /**
   * 启动沙箱：不存在则 `docker run` 创建；存在但已停止则 `docker start`。
   * 已存在的同名容器**必须**是本插件管理的，否则拒绝操作（避免误停/误删别人的容器）。
   */
  async start(opts: RunOptions = {}): Promise<{ created: boolean; endpoint: string }> {
    const before = await this.status(opts)
    if (before.exists) {
      if (before.managed !== true) {
        throw new Error(
          `容器 ${this.config.containerName} 已存在但不是本插件创建的（缺少 ${MANAGED_LABEL} 标签）；` +
            '请改名或先手动处理，以免误操作你的其他容器'
        )
      }
      if (!before.running) {
        const res = await this.run([DOCKER, 'start', this.config.containerName], { signal: opts.signal })
        if (res.code !== 0) throw new Error(`docker start 失败：${res.stderr.trim() || res.code}`)
      }
      return { created: false, endpoint: this.endpoint }
    }
    const res = await this.run(this.buildRunArgs(), { signal: opts.signal })
    if (res.code !== 0) throw new Error(`docker run 失败：${res.stderr.trim() || res.code}`)
    return { created: true, endpoint: this.endpoint }
  }

  /** 停止沙箱容器。 */
  async stop(opts: RunOptions = {}): Promise<void> {
    const res = await this.run([DOCKER, 'stop', this.config.containerName], { signal: opts.signal })
    if (res.code !== 0) throw new Error(`docker stop 失败：${res.stderr.trim() || res.code}`)
  }

  /** 拉取最新日志（默认末 100 行，最多 2000 行）。 */
  async logs(tail = 100, opts: RunOptions = {}): Promise<string> {
    const safeTail = Math.min(Math.max(Math.trunc(tail) || 100, 1), MAX_LOG_TAIL)
    const res = await this.run([DOCKER, 'logs', '--tail', String(safeTail), this.config.containerName], {
      signal: opts.signal
    })
    const text = (res.stdout + res.stderr).trim()
    if (res.code !== 0) throw new Error(`docker logs 失败：${text || res.code}`)
    return text
  }

  /** 存活探测：`/healthz`（n8n 只表示进程活着，不检查数据库）。 */
  async live(timeoutMs = 3000): Promise<boolean> {
    return (await this.probe('live', timeoutMs)) === true
  }

  /**
   * 就绪探测：`/healthz/readiness`（检查 DB 已连接、已迁移、启动完成）。
   * 老版本 n8n 没有该端点（404）时回退到存活探测。
   */
  async ready(timeoutMs = 3000): Promise<boolean> {
    const result = await this.probe('readiness', timeoutMs)
    if (result === 'missing') return this.live(timeoutMs)
    return result === true
  }

  /** 向后兼容别名：真正的「可调用 API」判定应使用 ready()。 */
  async health(timeoutMs = 3000): Promise<boolean> {
    return this.ready(timeoutMs)
  }

  private async probe(kind: 'live' | 'readiness', timeoutMs: number): Promise<boolean | 'missing'> {
    const path = kind === 'live' ? '/healthz' : '/healthz/readiness'
    try {
      const res = await fetch(`${this.endpoint}${path}`, { signal: AbortSignal.timeout(timeoutMs) })
      if (res.status === 404) return 'missing'
      return res.ok
    } catch {
      return false
    }
  }

  /** 删除容器（`docker rm -f`；数据卷保留，不丢数据）。 */
  async remove(opts: RunOptions = {}): Promise<void> {
    const res = await this.run([DOCKER, 'rm', '-f', this.config.containerName], { signal: opts.signal })
    if (res.code !== 0) throw new Error(`docker rm 失败：${res.stderr.trim() || res.code}`)
  }

  /** 轮询等待 n8n **就绪**（readiness 通过），超时返回 false。 */
  async waitUntilHealthy(timeoutMs = 60_000, intervalMs = 2000, opts: RunOptions = {}): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      if (await this.ready()) return true
      if (Date.now() >= deadline) return false
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
      if (opts.signal?.aborted) return false
    }
  }
}
