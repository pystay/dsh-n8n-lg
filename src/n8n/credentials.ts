/**
 * 凭据向导（Credential Wizard）—— 在激活之前告诉用户「还缺哪些凭据、该去哪里配」。
 *
 * 为什么需要它：之前只有等到 `publish` 报 400 才知道缺凭据，而且报错只提到节点名，
 * 用户还得自己猜该建哪种凭据。这里提前做一次体检：
 *
 *  - 需要什么：节点里**已声明**的 `credentials` 类型（权威）+ 内置的节点类型映射表；
 *  - 已有什么：`GET /api/v1/credentials` 返回的凭据类型集合（**不含任何密钥**）；
 *  - 差什么：两者相减，逐条给出节点名、凭据类型与配置入口链接。
 *
 * 诚实声明：这是**尽力而为**的分析。内置映射表不可能覆盖全部社区节点，
 * 也无法判断 `httpRequest` 这类「可选鉴权」的节点。最终判定仍以 n8n 自己的激活校验为准。
 * 另外：本模块**绝不**接收、存储或要求用户提供任何密钥。
 */

/** 单个节点的凭据需求。 */
export interface CredentialRequirement {
  node: string
  nodeType: string
  credentialType: string
  /** ok=实例里已有该类型凭据；missing=没有；unknown=无法判断（见 note）。 */
  status: 'ok' | 'missing'
  /** 该节点是否被禁用（禁用的节点不会阻止激活）。 */
  disabled: boolean
}

export interface CredentialReport {
  /** 需要的凭据类型汇总。 */
  requirements: CredentialRequirement[]
  /** 实例里已有的凭据类型（只有类型，没有名称与密钥）。 */
  available: string[]
  /** 缺失的凭据类型 → 涉及哪些节点。 */
  missing: Array<{ credentialType: string; nodes: string[]; hint: string }>
  /** 无法判断是否需要凭据的节点（不在映射表里，也没有声明凭据）。 */
  unverified: Array<{ node: string; nodeType: string }>
  /** 是否所有「已知需求」都已满足。 */
  ok: boolean
  /** 配置凭据的入口（n8n 界面地址）。 */
  credentialsUrl?: string
  note: string
}

/**
 * 常见节点类型 → 需要的凭据类型。
 *
 * 只覆盖最常见的一批；找不到时以节点自身声明的 `credentials` 为准。
 * 一个节点可以有多种凭据时，取列表全部。
 */
const NODE_CREDENTIALS: Record<string, string[]> = {
  'n8n-nodes-base.googleSheets': ['googleSheetsOAuth2Api'],
  'n8n-nodes-base.googleDrive': ['googleDriveOAuth2Api'],
  'n8n-nodes-base.googleCalendar': ['googleCalendarOAuth2Api'],
  'n8n-nodes-base.googleDocs': ['googleDocsOAuth2Api'],
  'n8n-nodes-base.gmail': ['gmailOAuth2'],
  'n8n-nodes-base.youTube': ['youTubeOAuth2Api'],
  'n8n-nodes-base.emailSend': ['smtp'],
  'n8n-nodes-base.slack': ['slackApi'],
  'n8n-nodes-base.discord': ['discordApi'],
  'n8n-nodes-base.telegram': ['telegramApi'],
  'n8n-nodes-base.notion': ['notionApi'],
  'n8n-nodes-base.airtable': ['airtableTokenApi'],
  'n8n-nodes-base.openAi': ['openAiApi'],
  'n8n-nodes-base.github': ['githubApi'],
  'n8n-nodes-base.gitlab': ['gitlabApi'],
  'n8n-nodes-base.jira': ['jiraSoftwareCloudApi'],
  'n8n-nodes-base.hubspot': ['hubspotApi'],
  'n8n-nodes-base.salesforce': ['salesforceOAuth2Api'],
  'n8n-nodes-base.stripe': ['stripeApi'],
  'n8n-nodes-base.twilio': ['twilioApi'],
  'n8n-nodes-base.dropbox': ['dropboxOAuth2Api'],
  'n8n-nodes-base.microsoftTeams': ['microsoftTeamsOAuth2Api'],
  'n8n-nodes-base.microsoftOutlook': ['microsoftOutlookOAuth2Api'],
  'n8n-nodes-base.microsoftExcel': ['microsoftExcelOAuth2Api'],
  'n8n-nodes-base.linear': ['linearApi'],
  'n8n-nodes-base.zendesk': ['zendeskApi'],
  'n8n-nodes-base.spotify': ['spotifyOAuth2Api'],
  'n8n-nodes-base.twitter': ['twitterOAuth1Api'],
  'n8n-nodes-base.shopify': ['shopifyApi'],
  'n8n-nodes-base.wooCommerce': ['wooCommerceApi'],
  'n8n-nodes-base.postgres': ['postgres'],
  'n8n-nodes-base.mySql': ['mySql'],
  'n8n-nodes-base.mongoDb': ['mongoDb'],
  'n8n-nodes-base.redis': ['redis'],
  'n8n-nodes-base.elasticsearch': ['elasticsearchApi'],
  'n8n-nodes-base.rabbitmq': ['rabbitmq'],
  'n8n-nodes-base.kafka': ['kafka'],
  'n8n-nodes-base.awsS3': ['aws'],
  'n8n-nodes-base.awsSes': ['aws'],
  'n8n-nodes-base.awsSns': ['aws'],
  'n8n-nodes-base.awsLambda': ['aws'],
  '@n8n/n8n-nodes-langchain.lmChatOpenAi': ['openAiApi'],
  '@n8n/n8n-nodes-langchain.lmChatDeepSeek': ['deepSeekApi'],
  '@n8n/n8n-nodes-langchain.lmChatAnthropic': ['anthropicApi'],
  '@n8n/n8n-nodes-langchain.lmChatGoogleGemini': ['googlePalmApi'],
  '@n8n/n8n-nodes-langchain.lmChatOllama': []
}

/**
 * 这些节点是纯逻辑节点，不需要凭据；不放进「无法判断」列表，避免噪音。
 * （前缀匹配）
 */
const NO_CREDENTIAL_PREFIXES = [
  'n8n-nodes-base.code',
  'n8n-nodes-base.set',
  'n8n-nodes-base.if',
  'n8n-nodes-base.switch',
  'n8n-nodes-base.merge',
  'n8n-nodes-base.splitInBatches',
  'n8n-nodes-base.splitOut',
  'n8n-nodes-base.filter',
  'n8n-nodes-base.sort',
  'n8n-nodes-base.aggregate',
  'n8n-nodes-base.limit',
  'n8n-nodes-base.removeDuplicates',
  'n8n-nodes-base.itemLists',
  'n8n-nodes-base.dateTime',
  'n8n-nodes-base.html',
  'n8n-nodes-base.markdown',
  'n8n-nodes-base.xml',
  'n8n-nodes-base.crypto',
  'n8n-nodes-base.noOp',
  'n8n-nodes-base.wait',
  'n8n-nodes-base.executeWorkflow',
  'n8n-nodes-base.stopAndError',
  'n8n-nodes-base.errorTrigger',
  'n8n-nodes-base.manualTrigger',
  'n8n-nodes-base.scheduleTrigger',
  'n8n-nodes-base.webhook',
  'n8n-nodes-base.respondToWebhook',
  'n8n-nodes-base.stickyNote',
  'n8n-nodes-base.httpRequest',
  'n8n-nodes-base.executeCommand',
  'n8n-nodes-base.readWriteFile',
  'n8n-nodes-base.extractFromFile',
  'n8n-nodes-base.convertToFile',
  'n8n-nodes-base.ftp',
  '@n8n/n8n-nodes-langchain.agent',
  '@n8n/n8n-nodes-langchain.chainLlm',
  '@n8n/n8n-nodes-langchain.lmChatOllama'
]

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function isCredentialFree(nodeType: string): boolean {
  return NO_CREDENTIAL_PREFIXES.some((p) => nodeType === p || nodeType.startsWith(`${p}@`))
}

/** 该凭据类型的配置提示。 */
export function credentialHint(credentialType: string): string {
  const hints: Record<string, string> = {
    googleSheetsOAuth2Api: '在 n8n 里新建 Google Sheets OAuth2 凭据并完成 Google 授权',
    googleDriveOAuth2Api: '在 n8n 里新建 Google Drive OAuth2 凭据并完成 Google 授权',
    youTubeOAuth2Api: '在 n8n 里新建 YouTube OAuth2 凭据（Google Cloud 项目里启用 YouTube Data API）',
    gmailOAuth2: '在 n8n 里新建 Gmail OAuth2 凭据并完成 Google 授权',
    smtp: '在 n8n 里新建 SMTP 凭据（填服务器、端口、账号）',
    openAiApi: '在 n8n 里新建 OpenAI 凭据，填入 API Key',
    deepSeekApi: '在 n8n 里新建 DeepSeek 凭据，填入 API Key',
    anthropicApi: '在 n8n 里新建 Anthropic 凭据，填入 API Key',
    slackApi: '在 n8n 里新建 Slack 凭据（OAuth 或 Bot Token）',
    aws: '在 n8n 里新建 AWS 凭据（Access Key / Secret）'
  }
  return hints[credentialType] ?? `在 n8n 的凭据页面新建一个「${credentialType}」类型的凭据`
}

/**
 * 分析一个工作流的凭据需求。
 *
 * @param nodes       工作流节点数组。
 * @param available   实例里已有的凭据类型（来自 `GET /api/v1/credentials`）。
 * @param credentialsUrl 凭据配置入口（可选）。
 */
export function analyzeCredentials(
  nodes: unknown,
  available: string[],
  credentialsUrl?: string
): CredentialReport {
  const list = Array.isArray(nodes) ? nodes : []
  const availableSet = new Set(available)
  const requirements: CredentialRequirement[] = []
  const unverified: Array<{ node: string; nodeType: string }> = []

  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const node = raw as {
      name?: unknown
      type?: unknown
      credentials?: Record<string, unknown>
      disabled?: unknown
    }
    const name = str(node.name) ?? '(未命名节点)'
    const nodeType = str(node.type) ?? '(未知类型)'
    const disabled = node.disabled === true

    // 1) 节点自己声明的凭据类型最权威
    const declared = Object.keys(node.credentials ?? {}).filter((k) => k)
    // 2) 再叠加内置映射
    const mapped = NODE_CREDENTIALS[nodeType] ?? []
    const needed = [...new Set([...declared, ...mapped])]

    if (needed.length > 0) {
      for (const credentialType of needed) {
        requirements.push({
          node: name,
          nodeType,
          credentialType,
          status: availableSet.has(credentialType) ? 'ok' : 'missing',
          disabled
        })
      }
      continue
    }

    if (!isCredentialFree(nodeType)) {
      unverified.push({ node: name, nodeType })
    }
  }

  const missingMap = new Map<string, string[]>()
  for (const req of requirements) {
    if (req.status !== 'missing' || req.disabled) continue
    const nodes = missingMap.get(req.credentialType) ?? []
    nodes.push(req.node)
    missingMap.set(req.credentialType, nodes)
  }

  const missing = [...missingMap.entries()].map(([credentialType, nodes]) => ({
    credentialType,
    nodes,
    hint: credentialHint(credentialType)
  }))

  return {
    requirements,
    available: [...availableSet].sort(),
    missing,
    unverified: unverified.slice(0, 10),
    ok: missing.length === 0,
    credentialsUrl,
    note:
      '这是尽力而为的静态分析：内置映射表覆盖常见节点，未覆盖的节点请在激活时以 n8n 的报错为准。' +
      '本功能不会读取、也不会要求你提供任何密钥。'
  }
}
