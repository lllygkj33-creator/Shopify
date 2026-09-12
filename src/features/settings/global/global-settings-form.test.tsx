import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LANG_COOKIE_MAX_AGE, LANG_COOKIE_NAME, type Lang } from '@/i18n'
import { clearCookies } from '@/test-utils/cookies'
import type { GlobalSettings } from '@/types/content'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { setCookie } from '@/lib/cookies'
import { I18nProvider } from '@/context/i18n-provider'
import { Toaster } from '@/components/ui/sonner'
import { GlobalSettingsForm } from './global-settings-form'

/**
 * 全局设置表单的中英双语。
 *
 * 文案最密集的一页，最容易出的问题是**只翻了一半**：标签翻了、说明或校验提示
 * 还留在中文，或者切换语言后不重渲染。这里按语言各渲染一次，把四类文案都点到：
 * 区块标题、字段标签、placeholder、校验提示，另外加上保存成功的 toast。
 */

vi.mock('@/lib/api', () => ({
  settingsApi: {
    get: vi.fn(async () => settingsFixture()),
    update: vi.fn(async () => settingsFixture()),
    verify: vi.fn(async () => ({
      ok: true,
      checkedAt: new Date().toISOString(),
    })),
    refreshToken: vi.fn(async () => settingsFixture()),
  },
  syncApi: {
    status: vi.fn(async () => ({
      lastSyncAt: null,
      trackedContents: 3,
      scheduledContents: 2,
      syncIntervalMinutes: 0,
      hasCredentials: true,
    })),
    run: vi.fn(),
  },
  blogsApi: { list: vi.fn(async () => []) },
}))

function settingsFixture(): GlobalSettings {
  return {
    shopDomain: 'demo.myshopify.com',
    apiVersion: '2026-04',
    tokenSource: 'auto',
    accessTokenMasked: null,
    hasAccessToken: false,
    tokenExpiresAt: null,
    tokenExpiresInSeconds: null,
    tokenScope: null,
    tokenLastRefreshedAt: null,
    tokenNeverExpires: false,
    tokenError: null,
    hasClientCredentials: true,
    clientId: 'abcdef1234567890',
    defaultAuthor: 'Example Author',
    defaultReviewers: [],
    relatedProductTitles: [],
    defaultTimezone: 'Asia/Shanghai',
    defaultPublishTime: '09:30',
    templateChoices: [],
  }
}

/**
 * 语言来自 cookie，测试必须显式设定（默认语言是站点配置的 `ui.defaultLang`）。
 * 设完再断言 `document.documentElement.lang`，确保 Provider 真的按这个语言渲染了。
 */
function useLang(lang: Lang): void {
  setCookie(LANG_COOKIE_NAME, lang, LANG_COOKIE_MAX_AGE)
}

async function expectResolvedLang(lang: Lang) {
  await vi.waitFor(() =>
    expect(document.documentElement.lang).toBe(lang === 'zh' ? 'zh-CN' : 'en')
  )
}

async function renderForm() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return await render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <GlobalSettingsForm />
        <Toaster />
      </I18nProvider>
    </QueryClientProvider>
  )
}

describe('GlobalSettingsForm 中英双语', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCookies()
  })

  it('中文界面：区块标题、标签、说明与按钮都是中文', async () => {
    useLang('zh')
    const screen = await renderForm()
    await expectResolvedLang('zh')

    await expect
      .element(screen.getByRole('heading', { name: 'Shopify 连接' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('heading', { name: '访问 Token' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('heading', { name: '栏目 → 博客映射自检' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('heading', { name: '发布默认值' }))
      .toBeInTheDocument()

    await expect
      .element(screen.getByText('店铺域名', { exact: true }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('默认时区', { exact: true }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('默认发布时间', { exact: true }))
      .toBeInTheDocument()

    await expect
      .element(screen.getByPlaceholder('每行一个，或用逗号分隔'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByPlaceholder('每行一个产品标题'))
      .toBeInTheDocument()
    await expect
      .element(
        screen.getByText(
          '定时发布的时间按此时区解释并转换为带偏移的 ISO 时间。'
        )
      )
      .toBeInTheDocument()

    await expect
      .element(screen.getByRole('button', { name: /保存并下发/ }))
      .toBeInTheDocument()
  })

  it('英文界面：同一页全部换成英文，没有中文残留', async () => {
    useLang('en')
    const screen = await renderForm()
    await expectResolvedLang('en')

    await expect
      .element(screen.getByRole('heading', { name: 'Shopify connection' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('heading', { name: 'Access token' }))
      .toBeInTheDocument()
    await expect
      .element(
        screen.getByRole('heading', { name: 'Channel → blog mapping check' })
      )
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('heading', { name: 'Publishing defaults' }))
      .toBeInTheDocument()

    await expect
      .element(screen.getByText('Store domain', { exact: true }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('Default timezone', { exact: true }))
      .toBeInTheDocument()

    await expect
      .element(screen.getByPlaceholder('One per line, or comma-separated'))
      .toBeInTheDocument()
    await expect
      .element(
        screen.getByText(
          'Scheduled publish times are interpreted in this timezone and converted to an ISO time with offset.'
        )
      )
      .toBeInTheDocument()

    await expect
      .element(screen.getByRole('button', { name: /Save and apply/ }))
      .toBeInTheDocument()

    // 时区下拉的选项文案在 @/lib/datetime 里是写死中文的常量，
    // 必须映射成词条 —— 展开面板再断言一次，避免「键存在但没接上」
    await userEvent.click(screen.getByRole('combobox'))
    await expect
      .element(
        screen.getByRole('option', {
          name: /Asia\/Shanghai \(China Standard Time, UTC\+8\) — default/,
        })
      )
      .toBeInTheDocument()

    // 整页不能出现中文（CJK）—— 漏翻的地方会在这里露出来（含刚展开的下拉面板）
    // 汉字 + 中文标点 + 全角符号（与 src/lib/i18n-guard.node.test.ts 一致）
    const cjk = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/
    const body = document.body.textContent ?? ''
    expect(cjk.test(body)).toBe(false)
  })

  it('校验提示跟着当前语言走', async () => {
    useLang('zh')
    const screen = await renderForm()

    const shopDomain = screen.getByLabelText('店铺域名')
    await userEvent.clear(shopDomain)
    await userEvent.click(screen.getByRole('button', { name: /保存并下发/ }))

    await expect.element(screen.getByText('请填写店铺域名')).toBeInTheDocument()

    const apiVersion = screen.getByLabelText('Admin API 版本')
    await userEvent.clear(apiVersion)
    await userEvent.click(screen.getByRole('button', { name: /保存并下发/ }))

    await expect
      .element(screen.getByText('请填写 API 版本'))
      .toBeInTheDocument()
  })

  it('英文界面下的校验提示是英文', async () => {
    useLang('en')
    const screen = await renderForm()

    await userEvent.clear(screen.getByLabelText('Store domain'))
    await userEvent.click(
      screen.getByRole('button', { name: /Save and apply/ })
    )

    await expect
      .element(screen.getByText('Enter your store domain'))
      .toBeInTheDocument()
  })

  it('保存成功的 toast 也按当前语言', async () => {
    useLang('zh')
    const screen = await renderForm()

    await userEvent.click(screen.getByRole('button', { name: /保存并下发/ }))

    await expect
      .element(screen.getByText('设置已保存，所有栏目发布器立即生效'))
      .toBeInTheDocument()
  })

  it('令牌状态面板与同步面板的中文文案', async () => {
    useLang('zh')
    const screen = await renderForm()

    // 自动续期是「凭据齐全但还没换过」的中性提示，不是「未配置」
    await expect
      .element(screen.getByText('凭据已配置，首次调用时自动换取令牌'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('已跟踪', { exact: true }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('尚未同步', { exact: true }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: /立即同步/ }))
      .toBeInTheDocument()
  })

  it('令牌状态面板与同步面板的英文文案', async () => {
    useLang('en')
    const screen = await renderForm()

    await expect
      .element(
        screen.getByText(
          'Credentials configured — the token is exchanged on first call'
        )
      )
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('Tracked', { exact: true }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('Not synced yet', { exact: true }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: /Sync now/ }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('(timezone Asia/Shanghai)', { exact: true }))
      .toBeInTheDocument()
  })
})

// 上一个用例的表单不卸载的话会留在文档里，英文用例里数「有没有中文残留」会把它数进去
afterEach(() => {
  cleanup()
})
