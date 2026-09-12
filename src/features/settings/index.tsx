import { Outlet } from '@tanstack/react-router'
import { Palette, Settings2 } from 'lucide-react'
import { useI18n } from '@/context/i18n-provider'
import { Separator } from '@/components/ui/separator'
import { ConfigDrawer } from '@/components/config-drawer'
import { LangSwitch } from '@/components/lang-switch'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { SidebarNav } from './components/sidebar-nav'

export function Settings() {
  const { t } = useI18n()

  /** 设置分区：只保留本平台真正需要的两项（不含模板的 Profile/Billing/Notifications） */
  const sidebarNavItems = [
    {
      title: t('nav.settings'),
      href: '/settings',
      icon: <Settings2 size={18} />,
    },
    {
      title: t('nav.appearance'),
      href: '/settings/appearance',
      icon: <Palette size={18} />,
    },
  ]

  return (
    <>
      <Header>
        <Search className='me-auto' />
        <LangSwitch />
        <ThemeSwitch />
        <ConfigDrawer />
      </Header>

      <Main fixed>
        <div className='space-y-0.5'>
          <h1 className='text-2xl font-bold tracking-tight md:text-3xl'>
            {t('nav.settings')}
          </h1>
          <p className='text-muted-foreground'>{t('settings.page.desc')}</p>
        </div>
        <Separator className='my-4 lg:my-6' />
        <div className='flex flex-1 flex-col space-y-2 overflow-hidden md:space-y-2 lg:flex-row lg:space-y-0 lg:space-x-12'>
          <aside className='top-0 lg:sticky lg:w-1/5'>
            <SidebarNav items={sidebarNavItems} />
          </aside>
          <div className='flex w-full overflow-y-auto p-1'>
            <Outlet />
          </div>
        </div>
      </Main>
    </>
  )
}
