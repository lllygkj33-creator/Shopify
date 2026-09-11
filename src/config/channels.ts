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
   * 博客文章专用：Shopify Blog 名称。
   * GEO 的 find_blog_gid() 是按**名称**查 GID 的，不是按 handle。
   */
  blogName?: string
  /** 博客文章专用：URL 展示用的 blog handle（/blogs/<handle>/<article>） */
  blogHandle?: string
  /** 博客文章专用：正文根节点 class 兜底值（zima-<x>-article） */
  htmlClass?: string
  /** 页面专用：期望的模板后缀（JSON 内的 template 优先） */
  template?: string
  /** 页面专用：JSON 内来源信息的键名前缀，如 com_source */
  sourceKey?: string
}

/** 10 个内容栏目，顺序即菜单顺序（§3.2） */
export const CHANNELS: Channel[] = [
  {
    id: 'tech-ai-hub',
    name: 'Tech & AI Hub',
    defaultFolder: 'tech-ai-hub',
    contentType: 'blog_article',
    color: '#6366f1',
    blogName: 'Tech & AI Hub',
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
    blogName: 'NAS Server Setup',
    blogHandle: 'nas-server-setup',
    htmlClass: 'zima-nas-server-setup-article',
  },
  {
    id: 'buying-guide',
    name: 'Buying Guides',
    defaultFolder: 'buying-guide',
    contentType: 'blog_article',
    color: '#f59e0b',
    blogName: 'Buying Guides',
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
    blogHandle: 'product-comparison',
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
    sourceKey: 'com_source',
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
  },
  {
    id: 'makerworld',
    name: 'MakerWorld',
    defaultFolder: 'Maker',
    contentType: 'page',
    color: '#06b6d4',
    template: 'makerworld-page',
    sourceKey: 'maker_source',
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
