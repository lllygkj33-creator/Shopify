import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronRight, Plug } from 'lucide-react'
import { settingsApi, USE_MOCK } from '@/lib/api'
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
  const domain = data?.shopDomain || '未配置店铺'

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size='lg' asChild tooltip='打开全局设置'>
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
                  ? `Token 来自 ${data?.tokenSource === 'env' ? '环境变量' : '手动配置'}`
                  : 'Token 未配置，无法发布'}
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
              演示数据模式（未连接后端）
            </Badge>
          </div>
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
