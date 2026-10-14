/**
 * n8n 容器沙箱（Docker 生命周期管理）。
 *
 * 设计要点：
 * - DSH 自带的 `ctx.sandbox` 是「同宿主进程沙箱」（文件策略 + bwrap/Landlock/Windows ACL），
 *   官方明确说明「容器 / 微 VM / 远程执行是另一套能力」。因此这里实现一个**独立的容器沙箱**：
 *   用 Docker 把 n8n 跑在隔离容器里，仅绑定 127.0.0.1，数据落命名卷。
 * - 命令执行器可注入（`CommandRunner`），便于在无 Docker 守护进程时做单元测试。
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
}

const DOCKER = 'docker'

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
      'unless-stopped'
    ]
    for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`)
    args.push(image)
    return args
  }

  /** 容器是否存在 / 运行状态。 */
  async status(): Promise<SandboxStatus> {
    const res = await this.run([
      DOCKER,
      'inspect',
      '-f',
      '{{.State.Status}}',
      this.config.containerName
    ])
    if (res.code !== 0) {
      return { exists: false, running: false, endpoint: this.endpoint }
    }
    const state = res.stdout.trim()
    return { exists: true, running: state === 'running', state, endpoint: this.endpoint }
  }

  /**
   * 启动沙箱：不存在则 `docker run` 创建；存在但已停止则 `docker start`。
   * 返回是否新建了容器。
   */
  async start(): Promise<{ created: boolean; endpoint: string }> {
    const before = await this.status()
    if (before.exists) {
      if (!before.running) {
        const res = await this.run([DOCKER, 'start', this.config.containerName])
        if (res.code !== 0) throw new Error(`docker start 失败：${res.stderr.trim() || res.code}`)
      }
      return { created: false, endpoint: this.endpoint }
    }
    const res = await this.run(this.buildRunArgs())
    if (res.code !== 0) throw new Error(`docker run 失败：${res.stderr.trim() || res.code}`)
    return { created: true, endpoint: this.endpoint }
  }

  /** 停止沙箱容器。 */
  async stop(): Promise<void> {
    const res = await this.run([DOCKER, 'stop', this.config.containerName])
    if (res.code !== 0) throw new Error(`docker stop 失败：${res.stderr.trim() || res.code}`)
  }

  /** 拉取最新日志（默认末 100 行）。 */
  async logs(tail = 100): Promise<string> {
    const res = await this.run([DOCKER, 'logs', '--tail', String(tail), this.config.containerName])
    return (res.stdout + res.stderr).trim()
  }

  /** 健康检查：GET {endpoint}/healthz（n8n 就绪返回 200）。 */
  async health(timeoutMs = 3000): Promise<boolean> {
    try {
      const res = await fetch(`${this.endpoint}/healthz`, {
        signal: AbortSignal.timeout(timeoutMs)
      })
      return res.ok
    } catch {
      return false
    }
  }
}
