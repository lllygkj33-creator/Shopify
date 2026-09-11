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
export const CHANNELS: Channel[] = [
  {
    // 通用页面出口：没有参考脚本，是平台新增的。
    // 模板名由 JSON 自己指定，所以不套用任何栏目专属规则
    // （H2 数量、必需文案、强制标记对都与具体模板强相关）。
    id: 'custom',
    name: 'Custom Articles',
    nameZh: 'Custom 文章',
    defaultFolder: 'Custom',
    contentType: 'page',
    color: '#64748b',
    template: '',
    pageSpec: {
      template: '',
      allowAnyTemplate: true,
      // 来源键不固定：JSON 里任一 *_source 对象都会成为 custom.<key>
      sourceKey: '',
      sourceKeySuffix: '_source',
      // 模板任意 → 不要求 H2 数量
      h2Min: 0,
      // 通用的正文/外链规则照旧生效
      enforceLinkRules: true,
      verified: true,
    },
  },
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
      // 链接：脚本只要求非空 title；平台额外要求第三方外链安全标记
      enforceLinkRules: true,
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
      enforceLinkRules: true,
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
    // ✅ 已对照 publish_user_stories.py 核对
    //
    // 与前几个的不同：来源 metafield 是 custom.user_info（字段名 name/handle/
    // avatar_url/profile_url），且正文必须逐字包含两句固定文案。
    // 参考脚本是「直接发布」（只用 isPublished），平台统一提供 立即/定时/草稿 三种方式。
    pageSpec: {
      template: 'user-story',
      sourceKey: 'user_info',
      sourceFields: ['name', 'handle', 'avatar_url', 'profile_url'],
      sourceRequiredNonEmpty: ['name', 'handle', 'profile_url'],
      sourceHttpUrlFields: ['avatar_url', 'profile_url'],
      bodyMustContain: [
        'A Note from Zima',
        'The Story Is Still Being Written',
      ],
      h2Min: 4,
      enforceLinkRules: true,
      // 用户故事脚本没有 meta 长度规则
      verified: true,
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
    // ✅ 已对照 publish_vs_pages.py 核对
    //
    // 六个栏目里最特殊：**没有来源 metafield**、**禁止 <h1> 也禁止 <h2>**
    // （标题层级由 Liquid 模板输出）、要求 8 对 COMPARE 标记、
    // published 必须为 true、related_products 必须为空数组。
    // 发布前后端会把资源库里的 3 个视频 + 3 篇文章注入 RESOURCES 区块。
    pageSpec: {
      template: 'nas-a-vs-b',
      // 空字符串 = 该栏目没有来源 metafield
      sourceKey: '',
      h2Min: 0,
      forbidH2: true,
      metaTitleMax: 65,
      metaDescriptionMin: 120,
      metaDescriptionMax: 170,
      requiredMarkerPairs: [
        'OVERVIEW',
        'SPECS',
        'CATEGORIES',
        'RECOMMENDATION',
        'SKU-FAMILY',
        'RESOURCES',
        'FAQ',
        'METHODOLOGY',
      ],
      forbiddenPlaceholders: [
        'YOUTUBE_URL_',
        'YOUTUBE_VIDEO_ID_',
        'BLOG_URL_',
        'BLOG_COVER_IMAGE_URL_',
        'PLACEHOLDER',
        'TODO',
        'Replace with',
      ],
      requirePublishedTrue: true,
      requireEmptyRelatedProducts: true,
      verified: true,
    },
  },
  {
    id: 'makerworld',
    name: 'MakerWorld',
    defaultFolder: 'Maker',
    contentType: 'page',
    color: '#06b6d4',
    template: 'makerworld-page',
    // ✅ 已对照 publish_maker_pages.py 核对
    //
    // 三个脚本里最严的：summary≥80、图片 alt 必须 50~100 且 loading="lazy"、
    // 链接的 anchor 文本 / target / rel / nofollow 都有规则、正文必须引用来源 URL。
    // 其中"链接与图片"那一组规则只在后端实现（POST /api/validate），
    // 避免同一套规则在 TS 与 Python 各写一遍后慢慢漂移。
    pageSpec: {
      template: 'makerworld-page',
      // 注意：脚本用的是 maker_source，不是 makerworld_source
      sourceKey: 'maker_source',
      sourceFields: [
        'title',
        'url',
        'excerpt',
        'creator_name',
        'creator_avatar_url',
        'creator_profile_url',
        'platform',
        'model_id',
        'license',
      ],
      sourceRequiredNonEmpty: [
        'title',
        'url',
        'excerpt',
        'creator_name',
        'platform',
      ],
      sourceHttpUrlFields: [
        'url',
        'creator_avatar_url',
        'creator_profile_url',
      ],
      sourceHostAllowlist: ['makerworld.com'],
      sourcePathContains: '/models/',
      sourceExactValues: { platform: 'makerworld' },
      sourceDigitFields: ['model_id'],
      h2Min: 4,
      metaTitleMax: 65,
      metaDescriptionMin: 120,
      metaDescriptionMax: 170,
      summaryMin: 80,
      verified: true,
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
  },
  {
    id: 'app-hardware-requirements',
    name: 'App Hardware',
    defaultFolder: 'APP',
    contentType: 'page',
    color: '#84cc16',
    template: 'app-hardware-requirements',
  },
]

const ALL_CHANNELS: Channel[] = [...CHANNELS, ...HIDDEN_CHANNELS]

export function getChannel(id: string): Channel | undefined {
  return ALL_CHANNELS.find((channel) => channel.id === id)
}
