/**
 * 工具注册层（编排）。
 *
 * 21 个 n8n 工具按用途拆到 5 个模块，这里只负责创建共享依赖并把它们串起来：
 *   workflows   —— 工作流 CRUD + 触发 + 启停
 *   executions  —— 执行查询 / 重试 / 停止
 *   build       —— 加节点 / 打开编辑器 / 校验 / 快照 / 恢复
 *   sessions    —— 搭建会话的开始 / 查看 / 控制
 *   credentials —— 凭据向导
 *
 * 参数名、取值语义、响应体均与 n8n 公开 API 保持一致，不做改名或裁剪。
 * 写操作一律经过 {@link WorkflowEditor}：串行、幂等、校验、读回验证、自动快照。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from '../config.js'
import type { ConnectionManager } from '../connection.js'
import { WorkflowEditor } from '../n8n/editor.js'
import { sessions } from '../n8n/session.js'
import { registerBuildTools } from './build.js'
import { registerCredentialTools } from './credentials.js'
import type { ToolDeps } from './deps.js'
import { registerExecutionTools } from './executions.js'
import { registerSessionTools } from './sessions.js'
import { registerWorkflowTools } from './workflows.js'

export function registerTools(ctx: Context, manager: ConnectionManager, config: Config): void {
  // 写操作前先过「搭建会话」这道闸门：会话暂停时写入会被拦下（暂停因此是真生效的）
  const editor = new WorkflowEditor(manager, {
    blockReason: (workflowId) => sessions.pausedReason(workflowId)
  })

  const deps: ToolDeps = { ctx, manager, config, editor }

  registerWorkflowTools(deps)
  registerExecutionTools(deps)
  registerBuildTools(deps)
  registerSessionTools(deps)
  registerCredentialTools(deps)
}
