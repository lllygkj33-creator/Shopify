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

/** Token 来源：环境变量 .env 或 UI 手动输入 */
export type TokenSource = 'env' | 'manual'

export type GlobalSettings = {
  shopDomain: string
  apiVersion: string
  tokenSource: TokenSource
  /** 只读的掩码值，后端返回，例如 shpat_example****0000。前端永不接触明文 */
  accessTokenMasked?: string
  /** 当前是否已解析到可用 token（env 或 manual 任一命中） */
  hasAccessToken: boolean
  /** env 来源时，实际命中的变量名，用于在 UI 上说明「token 来自哪里」 */
  envVarName?: string

  defaultAuthor: string
  defaultReviewers: string[]
  /** 关联产品标题池：用于 [[related_products_1]] 占位符替换 */
  relatedProductTitles: string[]
  defaultTimezone: string
  defaultPublishTime: string
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
}

/** 连接自检结果（校验 token 权限：read_content / write_content） */
export type ConnectionCheck = {
  ok: boolean
  shopName?: string
  apiVersion?: string
  scopes?: string[]
  missingScopes?: string[]
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
