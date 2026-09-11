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
import { isoToWallTime, wallTimeToIso } from './datetime'
import type {
  ContentItem,
  ContentStatus,
  DashboardStats,
  GlobalSettings,
  PublishHistoryEntry,
  PublishResult,
  TimelineBar,
} from '@/types/content'

const HOUR = 3600_000
const DAY = 24 * HOUR

/** 演示用的全局设置（token 只给掩码，永不含明文） */
const MOCK_SETTINGS: GlobalSettings = {
  shopDomain: 'your-store.myshopify.com',
  apiVersion: '2026-04',
  tokenSource: 'env',
  accessTokenMasked: 'shpat_example****0000',
  hasAccessToken: true,
  envVarName: 'SHOPIFY_ACCESS_TOKEN',
  defaultAuthor: 'Author Name',
  defaultReviewers: ['Reviewer One', 'Reviewer Two'],
  relatedProductTitles: [
    'ZimaCube 2 Personal Cloud Home NAS',
    'ZimaBoard 2 - Mini Home Server for Your Big Idea',
  ],
  defaultTimezone: 'America/Chicago',
  defaultPublishTime: '09:30',
}

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
    title: 'What Features Enable a Home AI Trust Boundary Around Sensitive Files?',
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
    error:
      'articleCreate 返回 userErrors: 正文少于 4 个 H2，无法插入 related_products_1',
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
    title: 'ZimaCube 2 vs Synology DS923+ for Home Labs',
    handle: '/pages/zimacube-2-vs-synology-ds923',
    status: 'scheduled',
    dayOffset: 5,
    hour: 15,
    template: 'nas-a-vs-b',
  },
  {
    channelId: 'makerworld',
    title: 'MakerWorld: 3D-Printed ZimaBoard Wall Mount',
    handle: '/pages/makerworld-zimaboard-wall-mount',
    status: 'draft',
    dayOffset: 7,
    hour: 12,
    template: 'makerworld-page',
  },
]

/** 把 seed 变成完整的 ContentItem */
function buildItems(now = Date.now()): ContentItem[] {
  const tz = MOCK_SETTINGS.defaultTimezone

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
      bodyHtml: `<article class="${channel?.htmlClass ?? ''}"><h2>演示正文</h2><p>Mock 数据，用于验证 UI 布局与状态展示。</p></article>`,
      summary: '演示用摘要文本。',
      metaTitle: seed.title,
      metaDescription: '演示用 meta description。',
      author: MOCK_SETTINGS.defaultAuthor,
      reviewer: MOCK_SETTINGS.defaultReviewers[0],
      relatedProducts: [MOCK_SETTINGS.relatedProductTitles[0]],
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
let settings: GlobalSettings = { ...MOCK_SETTINGS }

function ensureStore(): ContentItem[] {
  if (!store) store = buildItems()
  return store
}

export const mockApi = {
  getSettings(): GlobalSettings {
    return { ...settings }
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
      shopName: 'ZimaSpace',
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
        bodyHtml: '<article><h2>新发布</h2></article>',
        summary: '演示用摘要。',
        metaTitle: input.title,
        metaDescription: '演示用 meta description。',
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
        publishedUrl: status === 'published' ? input.handle : undefined,
        shopifyId: `gid://shopify/${input.contentType === 'page' ? 'Page' : 'Article'}/${Date.now() % 100000}`,
      }
    })

    return { ok: true, items: results }
  },

  reschedule(id: string, scheduledAt: string) {
    const item = ensureStore().find((entry) => entry.id === id)
    if (!item) throw new Error(`未找到内容 ${id}`)
    item.scheduledAt = scheduledAt
    item.status = 'scheduled'
    item.updatedAt = new Date().toISOString()
    return item
  },

  cancelSchedule(id: string) {
    const item = ensureStore().find((entry) => entry.id === id)
    if (!item) throw new Error(`未找到内容 ${id}`)
    item.status = 'draft'
    item.scheduledAt = undefined
    item.updatedAt = new Date().toISOString()
    return item
  },
}
