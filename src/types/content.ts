/**
 * 领域类型定义
 *
 * 字段来源：
 *  - PRD §6 数据模型（草案）
 *  - GEO/publish_articles.py 中 create_scheduled_article() 的 ArticleCreateInput
 *  - PRD §4.3 两种 JSON schema
 *
 * 约定：所有时间在跨层传输时使用 **ISO 8601 字符串**，且必须带时区偏移
 * （Shopify publishDate 要求如此）。时区只在「UI 输入」与「展示」时参与。
 */

import type { ChannelContentType } from '@/config/channels'

// ---------------------------------------------------------------------------
// 发布状态机
// ---------------------------------------------------------------------------

/**
 * 内容状态。
 * - draft      草稿：已入库，未排期
 * - scheduled  待发布：已提交 Shopify 且 publishDate 在未来
 * - published  已发布：publishDate 已过 / 已上线
 * - failed     发布失败：Shopify 返回 userErrors 或网络错误
 * - publishing 发布中：瞬时态，前端进度展示用
 */
export type ContentStatus =
  | 'draft'
  | 'scheduled'
  | 'published'
  | 'failed'
  | 'publishing'

export const CONTENT_STATUS_META: Record<
  ContentStatus,
  { label: string; color: string; description: string }
> = {
  draft: {
    label: '草稿',
    color: '#94a3b8',
    description: '已入库但未排期，可随时发布',
  },
  scheduled: {
    label: '待发布',
    color: '#3b82f6',
    description: '已提交 Shopify，将在指定时间自动上线',
  },
  published: {
    label: '已发布',
    color: '#22c55e',
    description: '已上线',
  },
  failed: {
    label: '发布失败',
    color: '#ef4444',
    description: '发布被 Shopify 拒绝，可重试',
  },
  publishing: {
    label: '发布中',
    color: '#f59e0b',
    description: '正在提交到 Shopify',
  },
}

/** 用户在栏目页为每篇文章选择的发布方式（§4.2 第 3 点） */
export type PublishMode = 'now' | 'schedule' | 'draft'

// ---------------------------------------------------------------------------
// 内容条目
// ---------------------------------------------------------------------------

/** 发布前校验发现的问题 */
export type ValidationIssue = {
  /** 严重级别：error 会阻断发布，warning 仅提示 */
  level: 'error' | 'warning'
  field?: string
  message: string
}

export type ContentItem = {
  id: string
  channelId: string
  contentType: ChannelContentType

  // --- 标题与寻址 ---
  title: string
  /** 博客文章：article handle（JSON `url`，无前导斜杠） */
  /** 页面：完整页面路径（JSON `url`，带前导斜杠，如 /pages/xxx） */
  handle: string
  /** 博客文章专用：Shopify Blog 名称（用于查 GID） */
  blogName?: string
  /** 页面专用：模板后缀（JSON `template` / `template_suffix`） */
  template?: string

  // --- 正文与 SEO ---
  bodyHtml: string
  summary?: string
  metaTitle?: string
  metaDescription?: string

  // --- 发布所需的前置引用（缺失会直接导致 articleCreate 失败） ---
  author?: string
  reviewer?: string
  /** 关联产品标题列表，后端会按标题解析为 product GID */
  relatedProducts?: string[]
  tags?: string[]

  // --- 来源追溯 ---
  /** 原始 JSON 文件绝对路径 */
  sourceFile?: string
  /** 在 JSON 数组中的下标，用于生成去重键 publish_key */
  sourceIndex?: number
  /**
   * 去重键。GEO 的 publish_key 形如
   * `<category>|<date>|<json_name>|<index>|<handle>`，
   * 用于避免同一篇文章被重复发布。
   */
  publishKey?: string

  // --- 状态与结果 ---
  status: ContentStatus
  scheduledAt?: string
  publishedAt?: string
  publishedUrl?: string
  /** Shopify 返回的对象 GID，例如 gid://shopify/Article/123 */
  shopifyId?: string
  error?: string

  /** 解析阶段发现的问题（H2 数量不足、缺 author 等） */
  issues?: ValidationIssue[]

  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// 解析后的候选（尚未入库）
// ---------------------------------------------------------------------------

export type ParsedCandidate = {
  /** 前端列表用的临时 key */
  tempId: string
  channelId: string
  contentType: ChannelContentType

  title: string
  handle: string
  blogName?: string
  template?: string

  bodyHtml: string
  summary?: string
  metaTitle?: string
  metaDescription?: string

  author?: string
  reviewer?: string
  relatedProducts?: string[]
  tags?: string[]

  /**
   * 页面栏目的来源对象（如 `community_source`），**整对象原样透传**给后端，
   * 后端写成 `custom.<key>` 的 json 类型 metafield。
   * 博客文章不使用该字段。
   */
  source?: Record<string, unknown>

  /**
   * 来源对象实际使用的 metafield 键名。
   * 固定栏目来自栏目规格；Custom 文章由 JSON 的 `*_source` 决定。
   */
  sourceKey?: string

  /**
   * 可选反链配置（用户故事）：页面发布成功后，往一篇已有博客文章追加
   * 幂等的上下文反链。后端会按 marker 去重，重复运行不会追加两次。
   */
  backlink?: Record<string, unknown>

  sourceFile: string
  sourceIndex: number
  publishKey: string

  /** 解析器给出的校验问题 */
  issues: ValidationIssue[]
  /** 该条是否可直接发布（issues 无 error） */
  publishable: boolean

  /** 去重命中：历史记录里已有同一 publishKey 的成功记录 */
  duplicateOf?: string
}

/**
 * 排期变更同步到 Shopify 侧的结果。
 *
 * 拆出来是必要的：本地记录与 Shopify 侧可能不一致
 * （例如本地想改期、但 Shopify 拒绝了），这时 `warning` 会说明。
 */
export type ScheduleSyncResult = {
  /** 本地没有 Shopify 对象（如发布失败的条目）时为 false，跳过同步 */
  attempted: boolean
  ok: boolean
  action: 'reschedule' | 'cancel' | string
  publishedAt?: string | null
  isPublished?: boolean | null
  error?: string | null
  warning?: string | null
}

/** 改期 / 取消排期的返回：本地记录 + Shopify 同步结果 */
export type ContentScheduleResult = {
  content: ContentItem
  sync: ScheduleSyncResult
}

/** 后端权威校验的单条结果（POST /api/validate） */
export type ValidateResultItem = {
  candidateTempId: string
  publishable: boolean
  issues: ValidationIssue[]
}

/** 单个文件的解析结果 */
export type ParsedFile = {
  fileName: string
  filePath: string
  /** 从 JSON 结构自动识别出的类型 */
  detected: 'blog_article' | 'page' | 'unknown'
  candidates: ParsedCandidate[]
  /** 文件级错误（JSON 语法错误、结构无法识别等），不影响其他文件 */
  error?: string
}

// ---------------------------------------------------------------------------
// 全局设置（§4.5 / §6 Setting）
// ---------------------------------------------------------------------------

/**
 * Token 来源。
 *
 * ★ 关键背景：Shopify 的 `client_credentials` 换发的 shpat_ **只有约 24 小时有效期**
 *   （实测 86398 秒）。所以 token 不是「配置」，而是**派生凭据**：
 *     长期凭据 = client_id + client_secret（不变）
 *     短期凭据 = access_token（24h，需自动续期）
 *
 * - `auto`   client_credentials 自动换发 + 到期前自动续期（推荐）
 * - `env`    .env 里的静态 token（仅适用于不过期的自定义应用长期 token）
 * - `manual` 界面手动粘贴的 token（若是 24h token，第二天就会失效）
 */
export type TokenSource = 'auto' | 'env' | 'manual'

export const TOKEN_SOURCE_META: Record<
  TokenSource,
  { label: string; autoRenew: boolean; hint: string; warning?: string }
> = {
  auto: {
    label: '自动续期（推荐）',
    autoRenew: true,
    hint: '用 .env 里的 CLIENT_ID / CLIENT_SECRET 换发 token，到期前自动换新，不需要人工维护。',
  },
  env: {
    label: '环境变量静态 token',
    autoRenew: false,
    hint: '读取 .env 里的 SHOPIFY_ACCESS_TOKEN。仅适合不过期的自定义应用长期 token。',
    warning:
      '静态 token 不会被自动续期。如果它是 client_credentials 换来的（24 小时有效），明天会突然 401，请改用「自动续期」。',
  },
  manual: {
    label: '界面手动输入',
    autoRenew: false,
    hint: '粘贴一个 shpat_ token，保存在本地 0600 权限文件中，界面只显示掩码。',
    warning:
      '手动 token 不会被自动续期。若粘贴的是 24 小时有效期的 token，次日发布就会失败。',
  },
}

export type GlobalSettings = {
  shopDomain: string
  apiVersion: string
  tokenSource: TokenSource

  /** 只读掩码，例如 shpat_0123****abcd。**前端永不接触明文** */
  accessTokenMasked?: string | null
  hasAccessToken: boolean

  // --- 令牌有效期（24h token 的可观测性）---
  /** 过期时刻（ISO）。auto 模式才有值 */
  tokenExpiresAt?: string | null
  /** 剩余秒数，由后端计算，避免前端时钟偏差 */
  tokenExpiresInSeconds?: number | null
  /** Shopify 实际授予的权限 */
  tokenScope?: string | null
  tokenLastRefreshedAt?: string | null
  /** env 模式的静态 token 无从得知过期时间，标记为长期有效 */
  tokenNeverExpires: boolean
  tokenError?: string | null

  // --- 凭据配置情况 ---
  /** 是否已配置 CLIENT_ID / CLIENT_SECRET（auto 模式的前提） */
  hasClientCredentials: boolean
  /** client_id 不是机密，回显便于确认配的是哪个应用 */
  clientId?: string | null

  defaultAuthor: string
  defaultReviewers: string[]
  /** 关联产品标题池：用于 [[related_products_1]] 占位符替换 */
  relatedProductTitles: string[]
  defaultTimezone: string
  defaultPublishTime: string
  /** 页面模板清单（Custom 文章的模板选择器用） */
  templateChoices: string[]
}

/** GET /api/theme/templates 返回：可选的页面模板（Custom 文章用） */
export type TemplateList = {
  /** shopify = 读自店铺主题；manual = 来自设置里维护的清单 */
  source: 'shopify' | 'manual'
  templates: string[]
  themeName?: string | null
  /** 回退到手动清单的原因 */
  reason?: string | null
}

/** GET /api/blogs 返回：用于核对「栏目 → Shopify Blog」映射 */
export type BlogItem = {
  id: string
  name: string
  handle: string
}

export type SettingsUpdatePayload = {
  shopDomain?: string
  apiVersion?: string
  tokenSource?: TokenSource
  /** 仅当用户真的改动了 token 时才提交 */
  accessToken?: string
  defaultAuthor?: string
  defaultReviewers?: string[]
  relatedProductTitles?: string[]
  defaultTimezone?: string
  defaultPublishTime?: string
  templateChoices?: string[]
}

/** 连接自检结果（校验 token 权限：read_content / write_content） */
export type ConnectionCheck = {
  ok: boolean
  shopName?: string
  shopDomain?: string
  apiVersion?: string
  scopes?: string[]
  /** 内容发布必需权限（缺失会阻断发布） */
  missingScopes?: string[]
  /** 仅博客发布才需要的权限（缺失不影响发页面） */
  blogMissingScopes?: string[]
  checkedAt: string
  error?: string
}

// ---------------------------------------------------------------------------
// 发布任务（批量发布的进度回传）
// ---------------------------------------------------------------------------

export type PublishResultItem = {
  candidateTempId: string
  status: ContentStatus
  title: string
  scheduledAt?: string
  publishedUrl?: string
  shopifyId?: string
  error?: string
  /** 反链结果：ADDED / ALREADY PRESENT */
  backlinkResult?: string | null
  /** 页面发布成功但反链失败时的原因（页面本身不回滚） */
  backlinkError?: string | null
}

export type PublishResult = {
  ok: boolean
  items: PublishResultItem[]
}

// ---------------------------------------------------------------------------
// 历史记录（§4.2 第 5 点）
// ---------------------------------------------------------------------------

export type PublishHistoryEntry = {
  id: string
  channelId: string
  title: string
  handle: string
  status: ContentStatus
  publishKey?: string
  scheduledAt?: string
  publishedAt?: string
  publishedUrl?: string
  shopifyId?: string
  error?: string
  recordedAt: string
}

// ---------------------------------------------------------------------------
// 仪表盘时间轴（§4.1）
// ---------------------------------------------------------------------------

/** 时间轴视图粒度 */
export type TimelineScale = 'day' | 'week' | 'month'

export type TimelineBar = {
  id: string
  channelId: string
  title: string
  handle: string
  status: ContentStatus
  contentType: ChannelContentType
  scheduledAt?: string
  publishedAt?: string
  publishedUrl?: string
  error?: string
}

/** 仪表盘顶部统计卡 */
export type DashboardStats = {
  scheduledCount: number
  publishedCount: number
  failedCount: number
  draftCount: number
}

// ---------------------------------------------------------------------------
// 数据同步
// ---------------------------------------------------------------------------

/**
 * 同步状态。
 *
 * 本地库 = 「平台自己发过的」+「线上所有未来排期」，**不含**店铺既有历史内容
 * （用户要求「只存平台自己发布的 和未来的，过去的通通不记录」）。
 *
 * 所以 `trackedContents` 不是「店铺里有多少条」，而是「本地跟踪了多少条」。
 */
export type SyncStatus = {
  /** 上次同步完成时间（ISO）；从未同步为 null */
  lastSyncAt?: string | null
  /** 本地已关联 Shopify 对象的条数（= 同步覆盖范围） */
  trackedContents: number
  /** 其中还没到发布时间的（≈ 仪表盘时间轴上的条数） */
  scheduledContents: number
  /** 后台自动同步间隔（分钟）。0 = 已关闭 */
  syncIntervalMinutes: number
  /** 凭据是否齐全 —— 不齐时按钮不该能点 */
  hasCredentials: boolean
}

/**
 * 一次同步的结果。
 *
 * 分两段，对应同步做的两件事：
 *   1. 拉线上未来排期（排期可能是在 Shopify 后台或别的工具排的，平台未必知道）
 *   2. 对账已知对象（到点后 Shopify 自己上线、人在后台改时间或删对象）
 */
export type SyncReport = {
  // --- 拉取未来排期 ---
  /** 写入本地的排期条数（含更新已有行） */
  scheduledPulled: number
  /** 线上未发布内容里时间在未来的条数（含认不出栏目的） */
  scheduledFound: number
  byChannel: Record<string, number>
  /**
   * 认不出栏目的原因 → 条数。
   *
   * 不静默丢弃：实测有 2 篇排期文章在 `zima-campaign-hub` 博客里，
   * 不属于平台任何栏目。用户有权知道什么没进来。
   */
  skipped: Record<string, number>

  // --- 对账已知对象 ---
  /** 本地有 GID、参与对账的行数 */
  checked: number
  matched: number
  /** 状态/时间/标题被线上修正过的行数 */
  updated: number
  /** 线上已不存在（后台被删）的行数 */
  gone: number

  error?: string | null
}
