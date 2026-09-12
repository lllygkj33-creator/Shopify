/**
 * 后端 API 客户端
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ 接口契约（后端按此实现；FastAPI 建议前缀 /api）                      │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │ GET    /api/health                    → { ok, version }             │
 * │ GET    /api/settings                  → GlobalSettings              │
 * │ PUT    /api/settings                  → GlobalSettings              │
 * │ POST   /api/settings/verify           → ConnectionCheck             │
 * │ POST   /api/settings/token/refresh    → GlobalSettings（强制换新）   │
 * │ GET    /api/blogs                     → { id, name, handle }[]      │
 * │ GET    /api/contents?channel_id=      → ContentItem[]               │
 * │ GET    /api/contents/timeline         → TimelineBar[]               │
 * │ GET    /api/contents/stats            → DashboardStats              │
 * │ POST   /api/publish                   → PublishResult               │
 * │ PATCH  /api/contents/{id}             → ContentItem                 │
 * │ DELETE /api/contents/{id}/schedule    → ContentItem                 │
 * │ GET    /api/history?channel_id=       → PublishHistoryEntry[]       │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * 关键约定（请后端务必对齐）：
 *  1. **access_token 永不回传明文**。GET /api/settings 只返回
 *     `accessTokenMasked` 与 `hasAccessToken`；PUT 时若用户没改 token
 *     就不要带 `accessToken` 字段，避免把掩码值写回去。
 *  2. **publishDate 必须是带时区偏移的 ISO 8601**（如
 *     `2026-09-15T09:30:00-05:00`）。前端已按设置时区算好偏移。
 *  3. **定时发布依赖 Shopify 原生能力**：创建文章时用
 *     `isPublished: false` + 未来 `publishDate`，由 Shopify 到点上线。
 *     所以后端不需要「到点触发」的调度器，只需要负责状态回写与重试。
 *  4. 批量发布要**逐条返回结果**，单条失败不能影响其他条目
 *     （对应 PublishResult.items[].error）。
 */
import axios, { AxiosError } from 'axios'
import { t } from '@/i18n'
import type {
  BlogItem,
  ContentScheduleResult,
  TemplateList,
  ConnectionCheck,
  ValidateResultItem,
  ContentItem,
  DashboardStats,
  GlobalSettings,
  ParsedCandidate,
  PublishHistoryEntry,
  PublishMode,
  PublishResult,
  SettingsUpdatePayload,
  TimelineBar,
  SyncReport,
  SyncStatus,
} from '@/types/content'
import { mockApi } from './mock-api'

/**
 * 演示数据模式。
 *
 * **默认关闭**：`pnpm dev` 直连真实后端。
 *
 * 为什么改掉原来的「默认开启」：演示数据是内置的假排期（10 条），
 * 打开仪表盘会以为平台里已经有内容，而实际一条都没有 —— 排查半天才
 * 发现是模式问题。真实的店铺连接是这个平台的默认状态，演示数据应该是
 * 显式的选择（`pnpm dev:mock`）。
 */
export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

const API_BASE_URL = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8000'

const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60_000,
  headers: { 'Content-Type': 'application/json' },
})

/** 统一的错误呈现：把 FastAPI 的 { detail } 与网络错误都变成人话 */
class ApiError extends Error {
  status?: number
  detail?: unknown

  constructor(message: string, status?: number, detail?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

function toApiError(error: unknown): ApiError {
  if (error instanceof AxiosError) {
    const status = error.response?.status
    const data = error.response?.data as { detail?: unknown } | undefined
    const detail = data?.detail

    if (typeof detail === 'string') {
      return new ApiError(detail, status, detail)
    }
    if (Array.isArray(detail)) {
      // FastAPI 的 422 校验错误
      const message = detail
        .map((item: { loc?: unknown[]; msg?: string }) => {
          const field = Array.isArray(item.loc) ? item.loc.join('.') : ''
          return `${field}: ${item.msg ?? ''}`.trim()
        })
        .join(t('shell.separator.clause'))
      return new ApiError(
        message || t('shell.api.paramInvalid'),
        status,
        detail
      )
    }
    if (error.code === 'ERR_NETWORK') {
      return new ApiError(
        t('shell.api.backendUnreachable', { baseUrl: API_BASE_URL }),
        status
      )
    }
    return new ApiError(error.message, status, data)
  }
  if (error instanceof Error) return new ApiError(error.message)
  return new ApiError(String(error))
}

async function get<T>(
  url: string,
  params?: Record<string, unknown>
): Promise<T> {
  try {
    const { data } = await http.get<T>(url, { params })
    return data
  } catch (error) {
    throw toApiError(error)
  }
}

async function send<T>(
  method: 'post' | 'put' | 'patch' | 'delete',
  url: string,
  body?: unknown
): Promise<T> {
  try {
    const { data } = await http.request<T>({ method, url, data: body })
    return data
  } catch (error) {
    throw toApiError(error)
  }
}

/** 演示模式下模拟网络延迟，让加载态真的可见（否则骨架屏一闪而过） */
const MOCK_LATENCY = 350
function mockDelay<T>(value: T, ms = MOCK_LATENCY): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

export const settingsApi = {
  get(): Promise<GlobalSettings> {
    if (USE_MOCK) return mockDelay(mockApi.getSettings())
    return get<GlobalSettings>('/api/settings')
  },

  update(payload: SettingsUpdatePayload): Promise<GlobalSettings> {
    if (USE_MOCK) {
      return mockDelay(
        mockApi.updateSettings(
          payload as Parameters<typeof mockApi.updateSettings>[0]
        )
      )
    }
    return send<GlobalSettings>('put', '/api/settings', payload)
  },

  verify(): Promise<ConnectionCheck> {
    if (USE_MOCK) return mockDelay(mockApi.checkConnection(), 700)
    return send<ConnectionCheck>('post', '/api/settings/verify')
  },

  /**
   * 手动强制换新令牌。
   *
   * 存在的意义：client_credentials 换来的 token 只有约 24 小时有效期，
   * 后端会在到期前自动续期；这个接口用于用户想「现在立刻换成新的」的场景
   * （例如刚更新过 client_secret、或自检报 401 之后）。
   */
  refreshToken(): Promise<GlobalSettings> {
    if (USE_MOCK) return mockDelay(mockApi.refreshToken(), 600)
    return send<GlobalSettings>('post', '/api/settings/token/refresh')
  },
}

// ---------------------------------------------------------------------------
// 页面模板（Custom 文章的模板选择器）
// ---------------------------------------------------------------------------

export const templatesApi = {
  /**
   * 列出可选模板。后端是**双来源**：优先读店铺主题（需要 `read_themes`），
   * 无权限时回退到全局设置里维护的清单，并在 `reason` 里说明原因。
   */
  list(): Promise<TemplateList> {
    if (USE_MOCK) {
      return mockDelay({
        source: 'manual' as const,
        templates: [
          'community_post',
          'discord-page',
          'user-story',
          'nas-a-vs-b',
          'makerworld-page',
        ],
        reason: t('shell.api.mockTemplates'),
      })
    }
    return get<TemplateList>('/api/theme/templates')
  },
}

// ---------------------------------------------------------------------------
// 博客（用于核对「栏目 → Shopify Blog」映射）
// ---------------------------------------------------------------------------

export const blogsApi = {
  list(): Promise<BlogItem[]> {
    if (USE_MOCK) return mockDelay(mockApi.listBlogs())
    return get<BlogItem[]>('/api/blogs')
  },
}

// ---------------------------------------------------------------------------
// 内容
// ---------------------------------------------------------------------------

export const contentApi = {
  list(channelId?: string): Promise<ContentItem[]> {
    if (USE_MOCK) return mockDelay(mockApi.listContents(channelId))
    return get<ContentItem[]>('/api/contents', { channel_id: channelId })
  },

  timeline(): Promise<TimelineBar[]> {
    if (USE_MOCK) return mockDelay(mockApi.getTimeline())
    return get<TimelineBar[]>('/api/contents/timeline')
  },

  stats(): Promise<DashboardStats> {
    if (USE_MOCK) return mockDelay(mockApi.getStats())
    return get<DashboardStats>('/api/contents/stats')
  },

  /**
   * 改期：把已排期内容移动到新的时间点。
   *
   * 返回里除了内容本身还有 `sync` —— 后端会**同时**把新时间推到 Shopify 侧，
   * 只改本地会导致线上按旧时间发布。
   */
  reschedule(id: string, scheduledAt: string): Promise<ContentScheduleResult> {
    if (USE_MOCK) return mockDelay(mockApi.reschedule(id, scheduledAt))
    return send<ContentScheduleResult>('patch', `/api/contents/${id}`, {
      scheduledAt,
    })
  },

  /**
   * 取消排期：退回草稿，不会删除已创建的内容。
   *
   * 后端会尝试撤销 Shopify 侧的排期；若撤不掉（publishDate 清不空），
   * 会在 `sync.warning` 里说明 —— 那种情况下内容仍会到点上线。
   */
  cancelSchedule(id: string): Promise<ContentScheduleResult> {
    if (USE_MOCK) return mockDelay(mockApi.cancelSchedule(id))
    return send<ContentScheduleResult>('delete', `/api/contents/${id}/schedule`)
  },
}

// ---------------------------------------------------------------------------
// 发布
// ---------------------------------------------------------------------------

type PublishPayloadItem = {
  candidate: ParsedCandidate
  mode: PublishMode
  /** mode=schedule 必填：已按设置时区换算成带偏移的 ISO 8601 */
  scheduledAt?: string
}

/**
 * 上传阶段的**权威**校验（对应栏目页 C1/C4）。
 *
 * 各栏目规则差异很大（MakerWorld 还要求 alt 长度区间、loading="lazy"、
 * 链接的 target/rel/nofollow、正文引用来源 URL）。这些规则在后端只有一份实现，
 * 前端调这个接口取结果，避免两套规则各自漂移。
 */
export const validateApi = {
  check(
    items: {
      candidateTempId: string
      channelId: string
      contentType: string
      title?: string
      handle?: string
      bodyHtml?: string
      summary?: string
      metaTitle?: string
      metaDescription?: string
      blogName?: string
      template?: string
      source?: Record<string, unknown>
      sourceFile?: string
    }[]
  ): Promise<ValidateResultItem[]> {
    if (!items.length) return Promise.resolve([])
    // 演示模式没有后端，直接用前端本地校验结果
    if (USE_MOCK) return Promise.resolve([])
    return send<{ items: ValidateResultItem[] }>('post', '/api/validate', {
      items,
    }).then((data) => data.items)
  },
}

/**
 * 批量发布。
 *
 * 后端建议实现为**逐条独立处理**：
 *  - 每条单独 try/except，失败写入该条的 error，不中断整批
 *  - 用 candidate.publishKey 做幂等去重
 *  - 返回的 items[].candidateTempId 必须原样回传，前端才能把结果对上号
 */
export const publishApi = {
  submit(items: PublishPayloadItem[]): Promise<PublishResult> {
    if (USE_MOCK) {
      return mockDelay(
        mockApi.publish(
          items.map((item) => ({
            candidateTempId: item.candidate.tempId,
            mode: item.mode,
            scheduledAt: item.scheduledAt,
            title: item.candidate.title,
            handle: item.candidate.handle,
            channelId: item.candidate.channelId,
            contentType: item.candidate.contentType,
            hasBacklink: Boolean(item.candidate.backlink),
          }))
        ),
        800
      )
    }
    return send<PublishResult>('post', '/api/publish', {
      items: items.map((item) => ({
        publishKey: item.candidate.publishKey,
        candidateTempId: item.candidate.tempId,
        channelId: item.candidate.channelId,
        contentType: item.candidate.contentType,
        mode: item.mode,
        scheduledAt: item.scheduledAt,
        title: item.candidate.title,
        handle: item.candidate.handle,
        blogName: item.candidate.blogName,
        template: item.candidate.template,
        bodyHtml: item.candidate.bodyHtml,
        summary: item.candidate.summary,
        metaTitle: item.candidate.metaTitle,
        metaDescription: item.candidate.metaDescription,
        author: item.candidate.author,
        reviewer: item.candidate.reviewer,
        relatedProducts: item.candidate.relatedProducts,
        tags: item.candidate.tags,
        // 页面栏目的来源对象（custom.<key> json metafield）
        source: item.candidate.source,
        // 实际使用的 metafield 键名（Custom 文章由 JSON 决定）
        sourceKey: item.candidate.sourceKey,
        // 可选反链（用户故事）
        backlink: item.candidate.backlink,
        sourceFile: item.candidate.sourceFile,
        sourceIndex: item.candidate.sourceIndex,
      })),
    })
  },
}

// ---------------------------------------------------------------------------
// 历史
// ---------------------------------------------------------------------------

export const historyApi = {
  list(channelId?: string): Promise<PublishHistoryEntry[]> {
    if (USE_MOCK) return mockDelay(mockApi.listHistory(channelId))
    return get<PublishHistoryEntry[]>('/api/history', {
      channel_id: channelId,
    })
  },
}

// ---------------------------------------------------------------------------
// 数据同步（对账）
// ---------------------------------------------------------------------------

/**
 * 为什么需要这一组接口。
 *
 * 两件事：
 *  1. **拉未来排期** —— 排期可能是在 Shopify 后台或别的工具排的，平台未必知道。
 *     只拉 `published_status:unpublished` 且时间在未来的，一次请求，
 *     不碰店铺既有的已发布历史。
 *  2. **对账已知对象** —— 我们的定时发布是「不发布 + 未来 publishDate」，
 *     到点由 **Shopify 自己**上线。本地没有定时任务（服务没开也不会漏发），
 *     代价是线上发生的事本地不会自动知道。不对账，界面显示的状态就是假的：
 *     内容早发了还写「待发布」，或者人在后台删了对象而本地以为它还会发。
 */
export const syncApi = {
  status(): Promise<SyncStatus> {
    if (USE_MOCK) return mockDelay(mockApi.getSyncStatus())
    return get<SyncStatus>('/api/sync/status')
  },

  /**
   * 同步线上状态：拉未来排期 + 对账已知对象。
   *
   * 为什么需要「拉排期」这一步：排期不是平台独有的事 —— 内容可能是在
   * Shopify 后台、或别的工具排上去的（实测店铺里有 172 条这样的页面）。
   * 不拉进来，仪表盘的排期全景就是残缺的：用户明明排了 100 多条，界面写 0。
   *
   * 幂等：按 GID 优先匹配，重复同步只更新不新增，也不会给平台自己发过的
   * 对象造出第二行。
   */
  run(): Promise<SyncReport> {
    if (USE_MOCK) return mockDelay(mockApi.syncRun(), 900)
    return send<SyncReport>('post', '/api/sync/run')
  },
}
