import { LANG_COOKIE_MAX_AGE, LANG_COOKIE_NAME, type Lang } from '@/i18n'
import { clearCookies } from '@/test-utils/cookies'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-react'
import { setCookie } from '@/lib/cookies'
import { FontProvider } from '@/context/font-provider'
import { I18nProvider } from '@/context/i18n-provider'
import { ThemeProvider } from '@/context/theme-provider'
import { SettingsAppearance } from './index'

/**
 * 外观页的中英双语。
 *
 * 这一页原来只有英文（模板遗留），双语化后中文界面要跟着变。
 */

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

async function renderAppearance() {
  return await render(
    <I18nProvider>
      <ThemeProvider>
        <FontProvider>
          <SettingsAppearance />
        </FontProvider>
      </ThemeProvider>
    </I18nProvider>
  )
}

describe('SettingsAppearance 中英双语', () => {
  beforeEach(() => {
    clearCookies()
  })

  afterEach(() => {
    cleanup()
  })

  it('中文界面', async () => {
    useLang('zh')
    const screen = await renderAppearance()
    await expectResolvedLang('zh')

    await expect
      .element(screen.getByRole('heading', { name: '外观' }))
      .toBeInTheDocument()
    await expect
      .element(
        screen.getByText('自定义应用外观。自动在日间与夜间主题之间切换。')
      )
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('字体', { exact: true }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('浅色', { exact: true }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('深色', { exact: true }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: '更新偏好设置' }))
      .toBeInTheDocument()
  })

  it('英文界面没有中文残留', async () => {
    useLang('en')
    const screen = await renderAppearance()
    await expectResolvedLang('en')

    await expect
      .element(screen.getByText('Appearance', { exact: true }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('Font', { exact: true }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: 'Update preferences' }))
      .toBeInTheDocument()

    // 汉字 + 中文标点 + 全角符号（与 src/lib/i18n-guard.node.test.ts 一致）
    const cjk = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/
    expect(cjk.test(document.body.textContent ?? '')).toBe(false)
  })
})
