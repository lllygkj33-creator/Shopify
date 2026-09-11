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
  /** 页面专用：JSON 内来源信息的键名，如 community_source */
  sourceKey?: string
  /** 页面专用：发布规格，用于上传阶段的即时校验 */
  pageSpec?: PageSpec
}

/**
 * 页面栏目的发布规格。
 *
 * 这些规则原本只在发布时才由后端脚本报错；放在这里是为了让用户**上传时就**
 * 看到问题，而不是点了「发布 N 篇」才逐条失败。
 */
export type PageSpec = {
  /** 要求的 templateSuffix，与 JSON 不一致即报错 */
  template: string
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
export const CHANNELS: Channel[] = [
  {
    id: 'tech-ai-hub',
    name: 'Tech & AI Hub',
    defaultFolder: 'tech-ai-hub',
    contentType: 'blog_article',
    color: '#6366f1',
    blogName: 'Tech & AI HUB',
    blogHandle: 'tech-ai-hub',
    htmlClass: 'zima-tech-ai-hub-article',
  },
  {
    id: 'support-tips',
    name: 'Support & Tips',
    defaultFolder: 'support-tips',
    contentType: 'blog_article',
    color: '#0ea5e9',
    blogName: 'Support & Tips',
    blogHandle: 'support-tips',
    htmlClass: 'zima-support-tips-article',
  },
  {
    id: 'nas-server-setup',
    name: 'NAS Server Setup',
    defaultFolder: 'nas-server-setup',
    contentType: 'blog_article',
    color: '#14b8a6',
    blogName: 'NAS & Server Setup',
    blogHandle: 'nas-server-setup',
    htmlClass: 'zima-nas-server-setup-article',
  },
  {
    id: 'buying-guide',
    name: 'Buying Guides',
    defaultFolder: 'buying-guide',
    contentType: 'blog_article',
    color: '#f59e0b',
    blogName: 'Buying Guide',
    blogHandle: 'buying-guide',
    htmlClass: 'zima-buying-guide-article',
  },
  {
    id: 'product-comparison',
    name: 'Product Comparisons',
    defaultFolder: 'product-comparison',
    contentType: 'blog_article',
    color: '#ec4899',
    blogName: 'Product Comparisons',
    blogHandle: 'product-comparisons',
    // 注意：class 用复数 comparisons，而文件夹是单数 comparison（GEO 实际如此）
    htmlClass: 'zima-product-comparisons-article',
  },
  {
    id: 'community-post',
    name: 'Community Posts',
    nameZh: '社区文章',
    defaultFolder: 'Com',
    contentType: 'page',
    color: '#8b5cf6',
    template: 'community_post',
    // ✅ 已核对：真实脚本写的是 custom.community_source
    sourceKey: 'community_source',
    // ✅ 已对照 publish_community_pages.py 核对
    pageSpec: {
      template: 'community_post',
      sourceKey: 'community_source',
      sourceFields: [
        'title',
        'url',
        'excerpt',
        'author_name',
        'author_avatar_url',
        'author_profile_url',
      ],
      sourceRequiredNonEmpty: ['title', 'url', 'excerpt', 'author_name'],
      sourceFieldPrefixes: {
        url: 'https://community.zimaspace.com/t/',
        author_profile_url: 'https://community.zimaspace.com/u/',
      },
      // 社区脚本只要求「至少一个 <h2>」，没有 meta 长度规则
      h2Min: 1,
      verified: true,
    },
  },
  {
    id: 'discord',
    name: 'Discord',
    nameZh: 'Discord 文章',
    defaultFolder: 'Discord',
    contentType: 'page',
    color: '#5865f2',
    template: 'discord-page',
    sourceKey: 'discord_source',
    // ✅ 已对照 publish_discord_pages.py 核对
    //
    // 注意 Discord 比社区严得多：H2 至少 4 个、meta_title ≤ 65、
    // meta description 必须在 120~170、url 必须是 Discord 消息链接，
    // 来源字段名也不同（starter_* / channel_name / invite_url）。
    pageSpec: {
      template: 'discord-page',
      sourceKey: 'discord_source',
      sourceFields: [
        'title',
        'url',
        'excerpt',
        'starter_name',
        'starter_avatar_url',
        'channel_name',
        'invite_url',
      ],
      sourceRequiredNonEmpty: [
        'title',
        'url',
        'excerpt',
        'starter_name',
        'starter_avatar_url',
        'channel_name',
      ],
      sourceFieldRegexes: {
        url: '^https://(?:www\\.)?discord\\.com/channels/\\d+/\\d+/\\d+/?$',
      },
      sourceHttpUrlFields: ['url', 'starter_avatar_url', 'invite_url'],
      stripHashPrefix: ['channel_name'],
      h2Min: 4,
      metaTitleMax: 65,
      metaDescriptionMin: 120,
      metaDescriptionMax: 170,
      verified: true,
    },
  },
  {
    id: 'user-story',
    name: 'User Stories',
    nameZh: '用户故事',
    defaultFolder: 'User',
    contentType: 'page',
    color: '#22c55e',
    template: 'user-story',
    sourceKey: 'user_source',
    pageSpec: {
      template: 'user-story',
      sourceKey: 'user_source',
      verified: false,
    },
  },
  {
    id: 'vs',
    name: 'A vs B',
    nameZh: 'VS 类文章',
    defaultFolder: 'VS',
    contentType: 'page',
    color: '#ef4444',
    template: 'nas-a-vs-b',
    sourceKey: 'vs_source',
    pageSpec: {
      template: 'nas-a-vs-b',
      sourceKey: 'vs_source',
      verified: false,
    },
  },
  {
    id: 'makerworld',
    name: 'MakerWorld',
    defaultFolder: 'Maker',
    contentType: 'page',
    color: '#06b6d4',
    template: 'makerworld-page',
    sourceKey: 'makerworld_source',
    pageSpec: {
      template: 'makerworld-page',
      sourceKey: 'makerworld_source',
      verified: false,
    },
  },
]

/**
 * 已确认**不纳入菜单**的栏目（PRD §3.2 备注）。
 * 保留定义以便后端解析器识别其 schema，但不在侧边栏出现；
 * 需要时把 id 加回 CHANNELS 即可上线，无需改其他代码。
 */
const HIDDEN_CHANNELS: Channel[] = [
  {
    id: 'local-ai-model-hardware',
    name: 'Model Hardware',
    defaultFolder: 'Model',
    contentType: 'page',
    color: '#a855f7',
    template: 'local-ai-model-hardware',
    sourceKey: 'model_source',
  },
  {
    id: 'app-hardware-requirements',
    name: 'App Hardware',
    defaultFolder: 'APP',
    contentType: 'page',
    color: '#84cc16',
    template: 'app-hardware-requirements',
    sourceKey: 'app_source',
  },
]

const ALL_CHANNELS: Channel[] = [...CHANNELS, ...HIDDEN_CHANNELS]

export function getChannel(id: string): Channel | undefined {
  return ALL_CHANNELS.find((channel) => channel.id === id)
}
