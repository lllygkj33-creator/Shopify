/**
 * 栏目注册表 —— 全站唯一事实来源（single source of truth）
 *
 * 用途：
 *  1. 生成侧边栏菜单（§3.2）
 *  2. 驱动栏目发布页（动态路由 /channels/$channelId 复用同一套模板）
 *  3. 提供仪表盘时间轴的「行」与颜色标识
 *
 * 重要设计约定（来自对 GEO 现有脚本的核查）：
 *  - 菜单栏目**只是**「工作区分组 + 默认文件夹」，不决定发布位置。
 *    真正的发布目标以 JSON 内的 `url` / `template` 为准。
 *  - `htmlClass` 仅作为**兜底推断**：真实样本里 tech-ai-hub 的正文是裸
 *    `<article>`（无 class），所以「有 class 用 class，无 class 用本栏目的
 *    blogName」。参见 lib/shopify-json.ts 的 resolveBlogName()。
 *  - 颜色使用十六进制字面量而非 Tailwind 类名，因为栏目颜色是运行时数据，
 *    Tailwind 无法静态提取动态拼接的类名。
 */

/** 内容类型：决定复用哪一个统一发布器 */
export type ChannelContentType = 'blog_article' | 'page'

export type Channel = {
  /** 路由与 API 使用的稳定 id */
  id: string
  /** 菜单与页面标题 */
  name: string
  /** 中文别名（部分栏目在 PRD 里用中文名） */
  nameZh?: string
  /** 本地默认文件夹名（注意大小写，GEO 里是 Com/Discord/User/VS/Maker） */
  defaultFolder: string
  /** 发布目标类型 */
  contentType: ChannelContentType
  /** 该栏目的主色，用于时间轴色块与状态标识 */
  color: string
  /**
   * 博客文章专用：Shopify Blog 的**标题**。
   *
   * ⚠️ 下面的值都是在真实店铺上查询核对过的（blogs query，2026-09-11）。
   * GEO 的 find_blog_gid() 用 `casefold()` 做**精确**标题匹配，匹配不上就直接
   * 抛 RuntimeError，所以这些字符串必须与店铺一致。
   *
   * 已核对出的真实数据（handle → title）：
   *   news                → News
   *   zima-campaign-hub   → Zima Campaign Hub
   *   tech-ai-hub         → Tech & AI HUB      （HUB 是大写）
   *   support-tips        → Support & Tips
   *   product-comparisons → Product Comparisons（handle 是复数）
   *   buying-guide        → Buying Guide       （单数 Guide，不是 Guides）
   *   nas-server-setup    → NAS & Server Setup （有 &）
   */
  blogName?: string
  /**
   * 博客文章专用：URL 展示用的 blog handle（/blogs/<handle>/<article>）。
   *
   * 建议后端**优先按 handle 匹配**、标题匹配作为兜底：
   * handle 在 Shopify 里是稳定且 URL 安全的，标题随时可能被运营改掉，
   * 而标题一旦被改，按标题匹配的发布器就会立刻失效。
   */
  blogHandle?: string
  /** 博客文章专用：正文根节点 class 兜底值（zima-<x>-article） */
  htmlClass?: string
  /** 页面专用：期望的模板后缀（JSON 内的 template 优先） */
  template?: string
  /**
   * 页面专用：发布规格（模板、来源 metafield 及各项校验规则）。
   *
   * 注意：来源键名只在 pageSpec.sourceKey 里维护一份。
   * 之前顶层还有一个同名的 sourceKey，两处容易改漏——已经合并掉。
   */
  pageSpec?: PageSpec
}

/**
 * 页面栏目的发布规格。
 *
 * 这些规则原本只在发布时才由后端脚本报错；放在这里是为了让用户**上传时就**
 * 看到问题，而不是点了「发布 N 篇」才逐条失败。
 */
export type PageSpec = {
  /** 要求的 templateSuffix，与 JSON 不一致即报错（allowAnyTemplate 时忽略） */
  template: string
  /** 模板由 JSON 自由指定，不做白名单校验（Custom 文章用） */
  allowAnyTemplate?: boolean
  /** 来源 metafield 的自动识别后缀（如 `_source`）：JSON 里任一以它结尾的
   *  顶层对象都会被写成 custom.<key>，键名原样使用（Custom 文章用） */
  sourceKeySuffix?: string
  /** 来源 metafield 的 key（namespace = custom） */
  sourceKey: string
  /** 来源对象里必须存在的字段；为空表示规格尚未核对，不做强校验 */
  sourceFields?: string[]
  /** 其中必须非空的字段（其余允许为空，如 Discord 的 invite_url） */
  sourceRequiredNonEmpty?: string[]
  /** 字段 → 必需前缀 */
  sourceFieldPrefixes?: Record<string, string>
  /** 字段 → 必须匹配的正则（字符串形式，便于放在配置里） */
  sourceFieldRegexes?: Record<string, string>
  /** 非空时必须是完整 http(s) 链接的字段 */
  sourceHttpUrlFields?: string[]
  /** 需要剥掉前导 `#` 的字段（Discord 的 channel_name） */
  stripHashPrefix?: string[]
  /** 来源 URL 的 host 白名单（后缀匹配） */
  sourceHostAllowlist?: string[]
  /** 来源 URL 路径必须包含的片段（MakerWorld 的 /models/） */
  sourcePathContains?: string
  /** 字段 → 固定值（大小写不敏感） */
  sourceExactValues?: Record<string, string>
  /** 非空时必须纯数字的字段 */
  sourceDigitFields?: string[]
  /** summary 最小长度；0 表示不检查 */
  summaryMin?: number
  /** 正文必须逐字包含的片段（用户故事的两句固定文案） */
  bodyMustContain?: string[]
  /** 是否禁止出现 <h2>（VS 的 H2 由 Liquid 模板输出） */
  forbidH2?: boolean
  /** 是否启用外链规则（所有链接要有 title；第三方外链要 _blank + noopener
   *  + noreferrer + nofollow）。社区 / Discord / 用户故事用这一套 */
  enforceLinkRules?: boolean
  /** 必须各出现恰好一次的 COMPARE 标记对名称 */
  requiredMarkerPairs?: string[]
  /** 正文里不允许出现的占位串 */
  forbiddenPlaceholders?: string[]
  /** JSON 的 published 必须为 true */
  requirePublishedTrue?: boolean
  /** related_products 必须为空数组 */
  requireEmptyRelatedProducts?: boolean

  /** 正文至少需要多少个 <h2>（社区 1 个，Discord 4 个） */
  h2Min?: number
  /** meta title 上限；不填表示不限制 */
  metaTitleMax?: number
  /** meta description 下限；不填表示不限制 */
  metaDescriptionMin?: number
  /** meta description 上限；不填表示不限制 */
  metaDescriptionMax?: number

  /** 规格是否已对照真实发布脚本核对过 */
  verified: boolean
}

/** 10 个内容栏目，顺序即菜单顺序（§3.2） */
/**
 * 三组栏目都**从站点配置构建**（site.config.json / site.config.local.json）。
 *
 * 栏目里的模板名、博客标题、metafield 键、来源 URL 前缀都是「谁在部署」的信息，
 * 不再是代码里的事实 —— 换一家店铺只要改配置，不用改这个文件。
 * 配置里的顺序就是菜单顺序；带 `hidden: true` 的不进菜单但解析器仍认得。
 *
 * 类型定义留在本文件（Channel / PageSpec），构建逻辑在 site.ts，
 * 那边对本文件只有 type-only 依赖，所以不会形成运行时循环。
 */
import { ALL_CHANNELS } from './site'

export { CHANNELS } from './site'


export function getChannel(id: string): Channel | undefined {
  return ALL_CHANNELS.find((channel) => channel.id === id)
}
