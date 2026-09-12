/**
 * 演示数据（Mock）适配器
 *
 * 存在意义：后端尚未提供，但 UI 需要能点、能看、能验证布局与交互。
 * 所有 mock 实现与真实接口**签名完全一致**，切换到真后端只需
 * 在 .env 里设置 VITE_USE_MOCK=false，无需改任何组件代码。
 *
 * 这里的数据是确定性生成的（不用随机数），保证刷新后画面稳定，
 * 方便对照截图与回归。
 */
import { CHANNELS } from '@/config/channels'
import { site } from '@/config/site'
import { t } from '@/i18n'
import type {
  BlogItem,
  ContentItem,
  ContentStatus,
  DashboardStats,
  GlobalSettings,
  PublishHistoryEntry,
  PublishResult,
  TimelineBar,
  SyncReport,
  SyncStatus,
} from '@/types/content'
import { isoToWallTime, wallTimeToIso } from './datetime'

const HOUR = 3600_000
const DAY = 24 * HOUR

/**
 * 演示用的全局设置。
 *
 * token 用 `auto`（自动续期）模式演示，并给出一个「还剩约 20 小时」的假过期时间，
 * 好让界面上的倒计时 / 状态标识能真实展示出来。
 * 掩码形状与真实换取结果一致（shpat_ + 8 位 + **** + 4 位）。
 */
function buildMockSettings(): GlobalSettings {
  const now = Date.now()
  return {
    // 演示数据也读站点配置，免得演示模式里出现两套对不上的占位域名
    shopDomain: site.storefrontDomain,
    apiVersion: '2026-04',
    tokenSource: 'auto',
    accessTokenMasked: 'shpat_0123****abcd',
    hasAccessToken: true,
    tokenExpiresAt: new Date(now + 20 * HOUR).toISOString(),
    tokenExpiresInSeconds: 20 * 3600,
    tokenScope:
      'read_content,write_content,read_products,read_metaobjects,write_metaobjects',
    tokenLastRefreshedAt: new Date(now - 4 * HOUR).toISOString(),
    tokenNeverExpires: false,
    tokenError: null,
    hasClientCredentials: true,
    clientId: '0123456789abcdef0123456789abcdef',
    defaultAuthor: site.defaultAuthor || 'Author Name',
    defaultReviewers: site.defaultReviewers.length
      ? site.defaultReviewers
      : ['Reviewer One', 'Reviewer Two'],
    relatedProductTitles: [
      'ExampleCube 2 Personal Cloud Home NAS',
      'ExampleBoard 2 - Mini Home Server for Your Big Idea',
    ],
    defaultTimezone: 'Asia/Shanghai',
    defaultPublishTime: '09:30',
    templateChoices: [
      'community_post',
      'discord-page',
      'user-story',
      'nas-a-vs-b',
      'makerworld-page',
    ],
  }
}

/**
 * 演示用博客列表。
 *
 * 这是**从真实店铺查询到的实际数据**（blogs query，2026-09-11），
 * 刻意保留真实值而不是编造：栏目映射核对功能的意义就在于暴露不一致。
 */
const MOCK_BLOGS: BlogItem[] = [
  { id: 'gid://shopify/Blog/1', name: 'News', handle: 'news' },
  {
    id: 'gid://shopify/Blog/2',
    name: 'Zima Campaign Hub',
    handle: 'zima-campaign-hub',
  },
  { id: 'gid://shopify/Blog/3', name: 'Tech & AI HUB', handle: 'tech-ai-hub' },
  {
    id: 'gid://shopify/Blog/4',
    name: 'Support & Tips',
    handle: 'support-tips',
  },
  {
    id: 'gid://shopify/Blog/5',
    name: 'Product Comparisons',
    handle: 'product-comparisons',
  },
  { id: 'gid://shopify/Blog/6', name: 'Buying Guide', handle: 'buying-guide' },
  {
    id: 'gid://shopify/Blog/7',
    name: 'NAS & Server Setup',
    handle: 'nas-server-setup',
  },
]

type Seed = {
  channelId: string
  title: string
  handle: string
  status: ContentStatus
  /** 相对现在的天数偏移（可为负数，表示已过去） */
  dayOffset: number
  hour: number
  error?: string
  template?: string
  blogName?: string
}

const SEEDS: Seed[] = [
  {
    channelId: 'tech-ai-hub',
    title:
      'What Features Enable a Home AI Trust Boundary Around Sensitive Files?',
    handle: 'home-ai-trust-boundary-sensitive-files-features',
    status: 'published',
    dayOffset: -3,
    hour: 9,
    blogName: 'Tech & AI Hub',
  },
  {
    channelId: 'tech-ai-hub',
    title: 'Local AI Context Quantization: What Actually Fits in 8 GB?',
    handle: 'local-ai-context-quantization-8gb-fit',
    status: 'scheduled',
    dayOffset: 1,
    hour: 9,
    blogName: 'Tech & AI Hub',
  },
  {
    channelId: 'tech-ai-hub',
    title: 'Deciding When to Keep Inference Local vs Cloud',
    handle: 'inference-local-vs-cloud-decision',
    status: 'scheduled',
    dayOffset: 4,
    hour: 9,
    blogName: 'Tech & AI Hub',
  },
  {
    channelId: 'support-tips',
    title: 'Container Runtime Basics: Diagnosing Restart Loops',
    handle: 'container-runtime-restart-loop-diagnosis',
    status: 'scheduled',
    dayOffset: 0,
    hour: 23,
    blogName: 'Support & Tips',
  },
  {
    channelId: 'support-tips',
    title: 'Cloud Time Machine Checksum Failures: Recovery Path',
    handle: 'cloud-time-machine-checksum-recovery',
    status: 'failed',
    dayOffset: -1,
    hour: 23,
    // getter：演示数据在模块加载时构建，直接写 t() 会把语言定死成加载那一刻
    get error() {
      return t('shell.mock.seedError')
    },
    blogName: 'Support & Tips',
  },
  {
    channelId: 'nas-server-setup',
    title: 'Beginner Stack: Boot Drive Choices for the First Month',
    handle: 'beginner-stack-boot-drive-first-month',
    status: 'scheduled',
    dayOffset: 2,
    hour: 10,
    blogName: 'NAS Server Setup',
  },
  {
    channelId: 'buying-guide',
    title: 'Is One NVMe Slot Enough for Containers and Metadata?',
    handle: 'is-one-nvme-slot-enough-containers-metadata',
    status: 'scheduled',
    dayOffset: 3,
    hour: 9,
    blogName: 'Buying Guides',
  },
  {
    channelId: 'buying-guide',
    title: 'Budget RAM and Bays for a Photo-Heavy Household',
    handle: 'budget-ram-bays-photo-heavy-household',
    status: 'draft',
    dayOffset: 5,
    hour: 9,
    blogName: 'Buying Guides',
  },
  {
    channelId: 'product-comparison',
    title: 'Firewall, VPS or Tunnel: Choosing an Access Path',
    handle: 'firewall-vps-tunnel-access-path',
    status: 'scheduled',
    dayOffset: 2,
    hour: 14,
    blogName: 'Product Comparisons',
  },
  {
    channelId: 'community-post',
    title: 'Community Build: A Quiet 4-Bay Photo Vault',
    handle: '/pages/community-quiet-4-bay-photo-vault',
    status: 'scheduled',
    dayOffset: 1,
    hour: 16,
    template: 'community_post',
  },
  {
    channelId: 'discord',
    title: 'Discord Community Roundup: August Highlights',
    handle: '/pages/discord-august-highlights',
    status: 'published',
    dayOffset: -6,
    hour: 11,
    template: 'discord-page',
  },
  {
    channelId: 'user-story',
    title: 'User Story: Running a Family Media Library Offline',
    handle: '/pages/user-story-family-media-library',
    status: 'scheduled',
    dayOffset: 6,
    hour: 10,
    template: 'user-story',
  },
  {
    channelId: 'vs',
    title: 'ExampleCube 2 vs Synology DS923+ for Home Labs',
    handle: '/pages/example-product-a-vs-example-nas',
    status: 'scheduled',
    dayOffset: 5,
    hour: 15,
    template: 'nas-a-vs-b',
  },
  {
    channelId: 'makerworld',
    title: 'MakerWorld: 3D-Printed ExampleBoard Wall Mount',
    handle: '/pages/makerworld-example-wall-mount',
    status: 'draft',
    dayOffset: 7,
    hour: 12,
    template: 'makerworld-page',
  },
]

/** 把 seed 变成完整的 ContentItem */
function buildItems(now = Date.now()): ContentItem[] {
  const tz = settings.defaultTimezone

  return SEEDS.map((seed, index) => {
    const channel = CHANNELS.find((c) => c.id === seed.channelId)

    // 按**配置时区**构造墙上时间，而不是浏览器本地时区，
    // 否则演示数据在 America/Chicago 视图下会显示成半夜的时间点。
    const targetDay = isoToWallTime(
      new Date(now + seed.dayOffset * DAY).toISOString(),
      tz
    ).slice(0, 10)
    const scheduledAt = wallTimeToIso(
      `${targetDay}T${String(seed.hour).padStart(2, '0')}:00`,
      tz
    )

    const publishedAt =
      seed.status === 'published'
        ? new Date(new Date(scheduledAt).getTime() + 5 * 60_000).toISOString()
        : undefined

    const isPage = channel?.contentType === 'page'

    return {
      id: `mock_${index + 1}`,
      channelId: seed.channelId,
      contentType: isPage ? 'page' : 'blog_article',
      title: seed.title,
      handle: seed.handle,
      blogName: seed.blogName,
      template: seed.template ?? channel?.template,
      bodyHtml: `<article class="${channel?.htmlClass ?? ''}">${t('shell.mock.body')}</article>`,
      summary: t('shell.mock.summary'),
      metaTitle: seed.title,
      metaDescription: t('shell.mock.metaDescription'),
      author: settings.defaultAuthor,
      reviewer: settings.defaultReviewers[0],
      relatedProducts: [settings.relatedProductTitles[0]],
      tags: [channel?.name ?? 'demo'],
      sourceFile: `/demo/${channel?.defaultFolder ?? 'unknown'}/demo-batch.json`,
      sourceIndex: index,
      publishKey: `${seed.channelId}|demo-batch.json|${index}|${seed.handle}`,
      status: seed.status,
      // 草稿也保留计划时间，在时间轴上以虚线框呈现（PRD §4.1 状态区分）
      scheduledAt,
      publishedAt,
      publishedUrl:
        seed.status === 'published'
          ? isPage
            ? seed.handle
            : `/blogs/${channel?.blogHandle}/${seed.handle}`
          : undefined,
      shopifyId:
        seed.status === 'published' || seed.status === 'scheduled'
          ? `gid://shopify/${isPage ? 'Page' : 'Article'}/${9000 + index}`
          : undefined,
      error: seed.error,
      issues: seed.error
        ? [
            {
              level: 'error' as const,
              field: 'html代码',
              message: seed.error,
            },
          ]
        : [],
      createdAt: new Date(now - 2 * DAY).toISOString(),
      updatedAt: new Date(now - HOUR).toISOString(),
    }
  })
}

/** 内存态：模块级单例，模拟后端持久化 */
let store: ContentItem[] | null = null
let settings: GlobalSettings = buildMockSettings()

function ensureStore(): ContentItem[] {
  if (!store) store = buildItems()
  return store
}

export const mockApi = {
  getSettings(): GlobalSettings {
    // 有效期按当前时间现算，避免页面挂久了显示成「已过期」
    if (settings.tokenExpiresInSeconds != null) {
      const lastRefreshed = settings.tokenLastRefreshedAt
        ? new Date(settings.tokenLastRefreshedAt).getTime()
        : Date.now()
      const expiresAt = lastRefreshed + 24 * HOUR
      return {
        ...settings,
        tokenExpiresAt: new Date(expiresAt).toISOString(),
        tokenExpiresInSeconds: Math.max(
          0,
          Math.round((expiresAt - Date.now()) / 1000)
        ),
      }
    }
    return { ...settings }
  },

  /** 模拟「立即换新」：把有效期重置为完整 24 小时 */
  refreshToken(): GlobalSettings {
    settings = {
      ...settings,
      accessTokenMasked: `shpat_${Math.random().toString(16).slice(2, 6)}****${Math.random().toString(16).slice(2, 6)}`,
      tokenLastRefreshedAt: new Date().toISOString(),
      tokenExpiresInSeconds: 24 * 3600,
      tokenScope: settings.tokenScope,
      tokenError: null,
    }
    return this.getSettings()
  },

  listBlogs(): BlogItem[] {
    return MOCK_BLOGS
  },

  updateSettings(patch: Partial<GlobalSettings> & { accessToken?: string }) {
    const { accessToken, ...rest } = patch
    settings = {
      ...settings,
      ...rest,
      ...(accessToken
        ? {
            accessTokenMasked: `${accessToken.slice(0, 10)}****${accessToken.slice(-4)}`,
            hasAccessToken: true,
          }
        : {}),
    }
    return { ...settings }
  },

  checkConnection() {
    return {
      ok: true,
      shopName: 'Demo Store',
      apiVersion: settings.apiVersion,
      scopes: ['read_content', 'write_content'],
      missingScopes: [],
      checkedAt: new Date().toISOString(),
    }
  },

  listContents(channelId?: string): ContentItem[] {
    const items = ensureStore()
    return channelId
      ? items.filter((item) => item.channelId === channelId)
      : items
  },

  getTimeline(): TimelineBar[] {
    return ensureStore().map((item) => ({
      id: item.id,
      channelId: item.channelId,
      title: item.title,
      handle: item.handle,
      status: item.status,
      contentType: item.contentType,
      scheduledAt: item.scheduledAt,
      publishedAt: item.publishedAt,
      publishedUrl: item.publishedUrl,
      error: item.error,
    }))
  },

  getStats(): DashboardStats {
    const items = ensureStore()
    const count = (status: ContentStatus) =>
      items.filter((item) => item.status === status).length
    return {
      scheduledCount: count('scheduled'),
      publishedCount: count('published'),
      failedCount: count('failed'),
      draftCount: count('draft'),
    }
  },

  listHistory(channelId?: string): PublishHistoryEntry[] {
    const items = ensureStore()
    return items
      .filter((item) => !channelId || item.channelId === channelId)
      .filter((item) => item.status !== 'draft')
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      .map((item) => ({
        id: `hist_${item.id}`,
        channelId: item.channelId,
        title: item.title,
        handle: item.handle,
        status: item.status,
        publishKey: item.publishKey,
        scheduledAt: item.scheduledAt,
        publishedAt: item.publishedAt,
        publishedUrl: item.publishedUrl,
        shopifyId: item.shopifyId,
        error: item.error,
        recordedAt: item.updatedAt,
      }))
  },

  publish(
    items: {
      candidateTempId: string
      mode: 'now' | 'schedule' | 'draft'
      scheduledAt?: string
      title: string
      handle: string
      channelId: string
      contentType: 'blog_article' | 'page'
      /** 是否配置了反链（用户故事） */
      hasBacklink?: boolean
    }[]
  ): PublishResult {
    const contents = ensureStore()
    const results = items.map((input, index) => {
      const status: ContentStatus =
        input.mode === 'draft'
          ? 'draft'
          : input.mode === 'now'
            ? 'published'
            : 'scheduled'

      const id = `mock_new_${Date.now()}_${index}`
      contents.push({
        id,
        channelId: input.channelId,
        contentType: input.contentType,
        title: input.title,
        handle: input.handle,
        bodyHtml: `<article><h2>${t('shell.mock.newlyPublished')}</h2></article>`,
        summary: t('shell.mock.summaryShort'),
        metaTitle: input.title,
        metaDescription: t('shell.mock.metaDescription'),
        status,
        scheduledAt: input.scheduledAt,
        publishedAt:
          status === 'published' ? new Date().toISOString() : undefined,
        publishedUrl: status === 'published' ? input.handle : undefined,
        shopifyId: `gid://shopify/${input.contentType === 'page' ? 'Page' : 'Article'}/${Date.now() % 100000}`,
        publishKey: `${input.channelId}|uploaded|${index}|${input.handle}`,
        sourceFile: '/demo/uploaded.json',
        sourceIndex: index,
        issues: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      return {
        candidateTempId: input.candidateTempId,
        status,
        title: input.title,
        scheduledAt: input.scheduledAt,
        // 模拟反链：页面类且配置了 backlink 时返回 ADDED
        backlinkResult: input.hasBacklink ? 'ADDED' : null,
        publishedUrl: status === 'published' ? input.handle : undefined,
        shopifyId: `gid://shopify/${input.contentType === 'page' ? 'Page' : 'Article'}/${Date.now() % 100000}`,
      }
    })

    return { ok: true, items: results }
  },

  /** 演示模式：本地没有真实的 Shopify 对象，如实返回 attempted=false */
  reschedule(id: string, scheduledAt: string) {
    const item = ensureStore().find((entry) => entry.id === id)
    if (!item) throw new Error(t('shell.mock.notFound', { id }))
    item.scheduledAt = scheduledAt
    item.status = 'scheduled'
    item.updatedAt = new Date().toISOString()
    return {
      content: item,
      sync: {
        attempted: false,
        ok: true,
        action: 'reschedule',
        warning: t('shell.mock.syncWarning'),
      },
    }
  },

  getSyncStatus(): SyncStatus {
    return {
      lastSyncAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
      trackedContents: 12,
      scheduledContents: 9,
      syncIntervalMinutes: 15,
      hasCredentials: true,
    }
  },

  syncRun(): SyncReport {
    return {
      scheduledPulled: 9,
      scheduledFound: 9,
      byChannel: { 'community-post': 6, discord: 3 },
      skipped: {},
      checked: 12,
      matched: 12,
      updated: 0,
      gone: 0,
      error: null,
    }
  },

  cancelSchedule(id: string) {
    const item = ensureStore().find((entry) => entry.id === id)
    if (!item) throw new Error(t('shell.mock.notFound', { id }))
    item.status = 'draft'
    item.scheduledAt = undefined
    item.updatedAt = new Date().toISOString()
    return {
      content: item,
      sync: {
        attempted: false,
        ok: true,
        action: 'cancel',
        warning: t('shell.mock.syncWarning'),
      },
    }
  },
}
