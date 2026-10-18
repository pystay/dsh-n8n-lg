/**
 * 工具模块之间共享的依赖。
 *
 * 拆分成多个文件后，每个模块都需要 `ctx`（注册工具）、`manager`（拿 n8n 客户端）、
 * `editor`（写操作的唯一入口）和 `config`。用一个对象传进去，避免每个 register 函数
 * 都摊开四个参数、也避免模块之间互相 import 形成环。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from '../config.js'
import type { ConnectionManager } from '../connection.js'
import type { WorkflowEditor } from '../n8n/editor.js'

export interface ToolDeps {
  ctx: Context
  manager: ConnectionManager
  config: Config
  /** 所有写操作的唯一入口：串行、幂等、校验、读回验证、自动快照。 */
  editor: WorkflowEditor
}
