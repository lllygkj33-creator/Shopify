import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { getChannel } from '@/config/channels'
import { messagesFor, type Lang } from '@/i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { historyApi } from '@/lib/api'
import { DirectionProvider } from '@/context/direction-provider'
import { I18nProvider } from '@/context/i18n-provider'
import { LayoutProvider } from '@/context/layout-provider'
import { SearchProvider } from '@/context/search-provider'
import { ThemeProvider } from '@/context/theme-provider'
import { SidebarProvider } from '@/components/ui/sidebar'
import { ChannelPage } from './index'

/**
 * 栏页头里的搜索按钮会挂出命令面板，面板靠 router 的 navigate 跳转。
 * 这里只测栏目页文案，把导航换成 spy 就够，不必起真路由。
 */
const mocks = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return { ...actual, useNavigate: () => mocks.navigate }
})

/**
 * 栏目区域的中英双语。
 *
 * 这里钉住三件事：
 *  1. 词条表 zh / en 两侧都不缺键（缺了 `translate()` 会把原始键名渲染到界面上）
 *  2. 界面文案跟着 cookie 里的语言走：中文与英文各断言一次
 *  3. 栏目名走 `channelLabel()` —— 中文取配置的 nameZh，英文取 name
 *
 * 候选列表（第 2、3 步卡片）要先选中文件夹才出现，所以它的文案在
 * `components/candidate-list.test.tsx` 里单独用 fixture 测。
 */
const CHANNEL_ID = 'community-post'

/** `I18nProvider` 的初始语言来自 cookie，测试必须显式设定 */
function useLang(lang: Lang): void {
  document.cookie = `content-publisher-lang=${lang}`
}

function renderChannelPage() {
  const channel = getChannel(CHANNEL_ID)
  if (!channel) throw new Error(`测试用的栏目不存在：${CHANNEL_ID}`)

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ThemeProvider>
          <DirectionProvider>
            {/* 页头里有 SidebarTrigger / Search / ConfigDrawer，缺 Provider 会直接抛错 */}
            <SidebarProvider>
              <LayoutProvider>
                <SearchProvider>
                  <ChannelPage channel={channel} />
                </SearchProvider>
              </LayoutProvider>
            </SidebarProvider>
          </DirectionProvider>
        </ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>
  )
}

describe('栏目词条表', () => {
  beforeEach(() => {
    document.cookie = 'content-publisher-lang=zh'
  })

  it('channels.* 的中英两侧键完全对齐', () => {
    const zh = Object.keys(messagesFor('zh')).filter((key) =>
      key.startsWith('channels.')
    )
    const en = Object.keys(messagesFor('en')).filter((key) =>
      key.startsWith('channels.')
    )

    expect(zh.length).toBeGreaterThan(80)
    expect([...en].sort()).toEqual([...zh].sort())
  })

  it('每一句英文都不是原样抄的中文', () => {
    const en = messagesFor('en')
    const untranslated = Object.entries(en)
      .filter(([key]) => key.startsWith('channels.'))
      .filter(([, value]) => /[\u4e00-\u9fa5]/.test(value))
      .map(([key]) => key)

    expect(untranslated).toEqual([])
  })
})

describe('栏目页语言切换', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(historyApi, 'list').mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('中文：中文文案 + 配置里的中文栏目名', async () => {
    useLang('zh')
    const screen = await renderChannelPage()

    // 栏目名走 channelLabel(channel, 'zh') → config 里的 nameZh
    await expect.element(screen.getByText('社区文章')).toBeInTheDocument()
    await expect
      .element(screen.getByText('1. 选择本地文件夹'))
      .toBeInTheDocument()
    await expect.element(screen.getByText('上传与发布')).toBeInTheDocument()
    await expect.element(screen.getByText('历史记录')).toBeInTheDocument()
    await expect.element(screen.getByText('默认文件夹')).toBeInTheDocument()
    await expect.element(screen.getByText('选择文件夹')).toBeInTheDocument()
    await expect
      .element(screen.getByText('把包含 JSON 的文件夹拖到这里'))
      .toBeInTheDocument()
    await expect
      .element(
        screen.getByText(
          'JSON 结构会自动识别：数组 → 博客文章，单对象 → 页面。单个文件出错不会影响其他文件。'
        )
      )
      .toBeInTheDocument()

    // 历史记录在第二个页签里，要点开才渲染
    await userEvent.click(screen.getByRole('tab', { name: '历史记录' }))
    await expect
      .element(screen.getByText('发布历史', { exact: true }))
      .toBeInTheDocument()
    // 这个用例里历史是空的（list 被 mock 成 []），所以断言空态文案
    await expect
      .element(
        screen.getByText(
          '该栏目还没有发布记录。上传 JSON 并发布后，这里会记录每一篇的结果。'
        )
      )
      .toBeInTheDocument()
  })

  it('英文：英文文案 + 配置里的英文栏目名', async () => {
    useLang('en')
    const screen = await renderChannelPage()

    await expect
      .element(screen.getByText('Community Posts'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('1. Choose a local folder'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('Upload & publish'))
      .toBeInTheDocument()
    await expect.element(screen.getByText('History')).toBeInTheDocument()
    await expect.element(screen.getByText('Default folder')).toBeInTheDocument()
    await expect.element(screen.getByText('Choose folder')).toBeInTheDocument()
    await expect
      .element(screen.getByText('Drop a folder containing JSON files here'))
      .toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'History' }))
    await expect
      .element(screen.getByText('Publish history', { exact: true }))
      .toBeInTheDocument()
    // 空态文案：这个用例里 historyApi.list 被 mock 成 []
    await expect
      .element(
        screen.getByText(
          'No publish records for this channel yet. Once you upload and publish JSON, every result shows up here.'
        )
      )
      .toBeInTheDocument()
  })

  it('中文界面的栏目名不会漏出英文（nameZh 存在时）', async () => {
    useLang('zh')
    const screen = await renderChannelPage()

    // 中文界面不该出现配置里的英文栏目名
    await expect.element(screen.getByText('社区文章')).toBeInTheDocument()
    await expect
      .element(screen.getByText('Community Posts'))
      .not.toBeInTheDocument()
  })
})
