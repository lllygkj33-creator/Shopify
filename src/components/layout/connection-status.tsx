import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, ChevronRight, Plug } from 'lucide-react'
import { settingsApi, USE_MOCK } from '@/lib/api'
import { useI18n } from '@/context/i18n-provider'
import { Badge } from '@/components/ui/badge'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * 侧边栏底部：连接状态
 *
 * 替代模板的「用户头像 + 退出登录」——本平台是本地单机、无登录（PRD §2），
 * 所以这里展示更有价值的信息：Shopify 店铺是否已连上、token 来自哪里。
 */
export function ConnectionStatus() {
  const { t } = useI18n()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get(),
  })

  if (isLoading) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <div className='flex items-center gap-2 px-2 py-1.5'>
            <Skeleton className='size-8 rounded-lg' />
            <div className='grid flex-1 gap-1'>
              <Skeleton className='h-3 w-24' />
              <Skeleton className='h-2.5 w-32' />
            </div>
          </div>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  const connected = !isError && Boolean(data?.hasAccessToken)
  const domain = data?.shopDomain || t('shell.connection.noStore')

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size='lg'
          asChild
          tooltip={t('shell.connection.openSettings')}
        >
          <Link to='/settings' className='gap-2'>
            <div
              className='flex aspect-square size-8 items-center justify-center rounded-lg border'
              style={{
                color: connected ? '#22c55e' : '#f59e0b',
              }}
            >
              {connected ? (
                <Plug className='size-4' />
              ) : (
                <AlertTriangle className='size-4' />
              )}
            </div>
            <div className='grid flex-1 text-start text-sm leading-tight'>
              <span className='truncate font-medium'>{domain}</span>
              <span className='truncate text-xs text-muted-foreground'>
                {connected
                  ? t('shell.connection.tokenFrom', {
                      source:
                        data?.tokenSource === 'env'
                          ? t('shell.connection.sourceEnv')
                          : t('shell.connection.sourceManual'),
                    })
                  : t('shell.connection.tokenMissing')}
              </span>
            </div>
            <ChevronRight className='ms-auto size-4' />
          </Link>
        </SidebarMenuButton>
        {USE_MOCK && (
          <div className='px-2 pt-1.5'>
            <Badge
              variant='outline'
              className='w-full justify-center border-dashed text-[10px] font-normal text-muted-foreground'
            >
              {t('shell.mock.badge')}
            </Badge>
          </div>
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
