import { CHANNELS } from '@/config/channels'
import { translate, type Lang } from '@/i18n'
import { channelLabel } from '@/i18n/channel-label'
import { clearCookies } from '@/test-utils/cookies'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, type RenderResult } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { I18nProvider } from '@/context/i18n-provider'
import { SearchProvider } from '@/context/search-provider'

/** 命令面板的文案跟着语言走，测试显式钉在英文，断言才好读 */
const TEST_LANG: Lang = 'en'

const COMMAND_MENU_PLACEHOLDER = translate(
  TEST_LANG,
  'shell.command.placeholder'
)

/**
 * 断言用的菜单项从**真实词条与栏目配置**里推导，不写死字符串。
 *
 * 之前这里写的是模板自带的 `Dashboard` / `Tasks` / `Settings Account`，
 * 侧边栏换成 Zima 的栏目后就全找不到、测试变红 —— 但页面其实没问题。
 * 侧边栏第 1 组是仪表盘、第 2 组由 `CHANNELS` 自动生成，所以这里也照这个来。
 *
 * 嵌套子项（NavCollapsible）在真实数据里目前没有，那种分支由
 * `search-provider-nested.test.tsx` 用 fixture 覆盖。
 */
const topLevelItem = translate(TEST_LANG, 'nav.dashboard')
const channelItem = {
  title: channelLabel(CHANNELS[0], TEST_LANG),
  url: `/channels/${CHANNELS[0].id}`,
}

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setTheme: vi.fn(),
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  }
})

vi.mock('@/context/theme-provider', () => ({
  useTheme: () => ({ setTheme: mocks.setTheme }),
}))

type ShortcutModifier = 'Control' | 'Meta'

async function renderWithSearchProvider() {
  return await render(
    <I18nProvider>
      <SearchProvider>{null}</SearchProvider>
    </I18nProvider>
  )
}

/**
 * Open the palette by shortcut, retrying while the keydown listener may not be mounted yet.
 * Waits between attempts so a successful toggle is not immediately undone by a second chord.
 */
async function openCommandPalette(
  screen: RenderResult,
  modifier: ShortcutModifier = 'Control'
) {
  await vi.waitFor(
    async () => {
      const isCommandPaletteOpen =
        document.querySelector(
          `[placeholder="${COMMAND_MENU_PLACEHOLDER}"]`
        ) !== null

      if (!isCommandPaletteOpen) {
        await userEvent.keyboard(`{${modifier}>}k{/${modifier}}`)
      }

      await expect
        .element(screen.getByPlaceholder(COMMAND_MENU_PLACEHOLDER))
        .toBeInTheDocument()
    },
    { interval: 50, timeout: 5000 }
  )
}

describe('SearchProvider and CommandMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    clearCookies()
    document.cookie = `content-publisher-lang=${TEST_LANG}`
  })

  it('renders the command palette when the palette is open', async () => {
    const screen = await renderWithSearchProvider()
    const { getByPlaceholder, getByText } = screen

    await openCommandPalette(screen)

    await expect
      .element(getByPlaceholder(COMMAND_MENU_PLACEHOLDER))
      .toBeInTheDocument()
    await expect
      .element(getByText(translate(TEST_LANG, 'common.theme')))
      .toBeInTheDocument()
    // 主题项按 role=option 找：侧边栏「系统」分组标题的英文也叫 System，
    // 纯文本查询会同时命中分组标题，撞在 strict mode 上
    for (const key of [
      'common.theme.light',
      'common.theme.dark',
      'common.theme.system',
    ]) {
      await expect
        .element(
          screen.getByRole('option', { name: translate(TEST_LANG, key) })
        )
        .toBeInTheDocument()
    }
    await expect.element(getByText(topLevelItem)).toBeInTheDocument()
  })

  it('does not show the dialog content when search is closed', async () => {
    const { getByPlaceholder } = await renderWithSearchProvider()

    await expect
      .element(getByPlaceholder(COMMAND_MENU_PLACEHOLDER))
      .not.toBeInTheDocument()
  })

  it.each([
    ['Ctrl', 'Control'],
    ['Cmd', 'Meta'],
  ] as const)(
    'opens the command menu when %s + K is pressed',
    async (_label, modifier) => {
      const screen = await renderWithSearchProvider()

      await expect
        .element(screen.getByPlaceholder(COMMAND_MENU_PLACEHOLDER))
        .not.toBeInTheDocument()

      await openCommandPalette(screen, modifier)

      await expect
        .element(screen.getByPlaceholder(COMMAND_MENU_PLACEHOLDER))
        .toBeInTheDocument()
    }
  )

  it('navigates to a top-level route and closes the palette when a nav item is selected', async () => {
    const screen = await renderWithSearchProvider()

    await openCommandPalette(screen)

    await userEvent.click(screen.getByText(channelItem.title))

    expect(mocks.navigate).toHaveBeenCalledWith({ to: channelItem.url })
    await expect
      .element(screen.getByPlaceholder(COMMAND_MENU_PLACEHOLDER))
      .not.toBeInTheDocument()
  })

  it('applies theme and closes the palette when a theme command is chosen', async () => {
    const screen = await renderWithSearchProvider()

    await openCommandPalette(screen)

    await userEvent.click(screen.getByText('Dark'))

    expect(mocks.setTheme).toHaveBeenCalledWith('dark')
    await expect
      .element(screen.getByPlaceholder(COMMAND_MENU_PLACEHOLDER))
      .not.toBeInTheDocument()
  })

  it('shows empty state when the filter matches nothing', async () => {
    const screen = await renderWithSearchProvider()

    await openCommandPalette(screen)

    await userEvent.fill(
      screen.getByPlaceholder(COMMAND_MENU_PLACEHOLDER),
      'zzzz-no-match-xxxx'
    )

    await expect
      .element(screen.getByText('No results found.'))
      .toBeInTheDocument()
  })
})
