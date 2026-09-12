import { CHANNELS } from '@/config/channels'
import { channelLabel } from '@/i18n/channel-label'
import { clearCookies } from '@/test-utils/cookies'
import { beforeEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { I18nProvider, useI18n } from '@/context/i18n-provider'
import { useSidebarData } from './sidebar-data'

/**
 * 侧边栏数据是 hook 而不是常量：菜单标题必须跟着语言变。
 *
 * 常量版本在模块加载时就定死了标题，切换语言后侧边栏还是旧语言 —— 这里把
 * 「订阅 i18n → 重渲染」这条链路钉住，否则以后有人改回常量也没人拦。
 */
function Probe() {
  const { lang, setLang } = useI18n()
  const { navGroups } = useSidebarData()

  return (
    <div>
      <button onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}>
        switch
      </button>
      {navGroups.map((group) => (
        <p key={group.title}>{group.title}</p>
      ))}
      {/* 第一个内容栏目：中文取 nameZh，英文取 name */}
      <p>{navGroups[1].items[0].title}</p>
    </div>
  )
}

describe('useSidebarData', () => {
  beforeEach(() => {
    clearCookies()
    document.cookie = 'content-publisher-lang=zh'
  })

  it('切换语言后分组与栏目名一起改语言', async () => {
    const screen = await render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    )

    const firstChannel = CHANNELS[0]

    await expect.element(screen.getByText('概览')).toBeInTheDocument()
    await expect
      .element(screen.getByText(channelLabel(firstChannel, 'zh')))
      .toBeInTheDocument()

    await userEvent.click(screen.getByText('switch'))

    await expect.element(screen.getByText('Overview')).toBeInTheDocument()
    await expect
      .element(screen.getByText(channelLabel(firstChannel, 'en')))
      .toBeInTheDocument()
  })
})
