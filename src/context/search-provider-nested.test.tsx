import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, type RenderResult } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { SearchProvider } from '@/context/search-provider'

/**
 * 命令面板的**嵌套菜单项**分支。
 *
 * 为什么单独一个文件：真实侧边栏（`sidebar-data.ts`）现在只有一级菜单项 ——
 * 栏目是平的，没有任何 `NavCollapsible`。但 `command-menu.tsx` 里那个分支
 * 仍然存在，还得有人测。放在这里用 fixture 造一个带子项的菜单，
 * 避免为了测试去改产品数据。
 */
const COMMAND_MENU_PLACEHOLDER = 'Type a command or search...'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  }
})

vi.mock('@/context/theme-provider', () => ({
  useTheme: () => ({ setTheme: vi.fn() }),
}))

vi.mock('@/components/layout/data/sidebar-data', () => ({
  sidebarData: {
    brand: { name: 'Test', subtitle: 'Test', logo: () => null },
    navGroups: [
      {
        title: 'Settings',
        items: [
          {
            title: 'Settings',
            items: [{ title: 'Account', url: '/settings/account' }],
          },
        ],
      },
    ],
  },
}))

async function renderWithSearchProvider() {
  return await render(<SearchProvider>{null}</SearchProvider>)
}

async function openCommandPalette(screen: RenderResult) {
  await vi.waitFor(
    async () => {
      const isOpen =
        document.querySelector(
          `[placeholder="${COMMAND_MENU_PLACEHOLDER}"]`
        ) !== null

      if (!isOpen) {
        await userEvent.keyboard('{Control>}k{/Control}')
      }

      await expect
        .element(screen.getByPlaceholder(COMMAND_MENU_PLACEHOLDER))
        .toBeInTheDocument()
    },
    { interval: 50, timeout: 5000 }
  )
}

describe('CommandMenu nested items', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('navigates for nested sidebar items (group with sub-items)', async () => {
    const screen = await renderWithSearchProvider()

    await openCommandPalette(screen)

    await userEvent.click(screen.getByRole('option', { name: 'Settings Account' }))

    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/settings/account' })
    await expect
      .element(screen.getByPlaceholder(COMMAND_MENU_PLACEHOLDER))
      .not.toBeInTheDocument()
  })
})
