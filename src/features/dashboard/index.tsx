import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { CalendarPlus, ChevronDown, RefreshCw } from 'lucide-react'
import { CHANNELS } from '@/config/channels'
import { contentApi, settingsApi, USE_MOCK } from '@/lib/api'
import { DEFAULT_TIMEZONE } from '@/lib/datetime'
import type { TimelineBar, TimelineScale } from '@/types/content'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScheduleDialog } from './components/schedule-dialog'
import { StatCards } from './components/stat-cards'
import { Timeline } from './components/timeline'

export function Dashboard() {
  const navigate = useNavigate()
  const [scale, setScale] = useState<TimelineScale>('day')
  const [selected, setSelected] = useState<TimelineBar | null>(null)

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get(),
  })
  const timezone = settingsQuery.data?.defaultTimezone ?? DEFAULT_TIMEZONE

  const statsQuery = useQuery({
    queryKey: ['stats'],
    queryFn: () => contentApi.stats(),
  })

  const timelineQuery = useQuery({
    queryKey: ['timeline'],
    queryFn: () => contentApi.timeline(),
  })

  const bars = timelineQuery.data ?? []

  return (
    <>
      <Header>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
      </Header>

      <Main>
        <div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
          <div>
            <h1 className='text-2xl font-bold tracking-tight'>排期仪表盘</h1>
            <p className='text-sm text-muted-foreground'>
              所有栏目的发布时间轴 · 时区 {timezone}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <CalendarPlus className='size-4' />
                新建排期
                <ChevronDown className='size-4' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align='end'
              className='max-h-80 w-56 overflow-y-auto'
            >
              <DropdownMenuLabel>选择栏目</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {CHANNELS.map((channel) => (
                <DropdownMenuItem
                  key={channel.id}
                  onClick={() =>
                    navigate({
                      to: '/channels/$channelId',
                      params: { channelId: channel.id },
                    })
                  }
                >
                  <span
                    className='size-2.5 rounded-full'
                    style={{ backgroundColor: channel.color }}
                  />
                  {channel.nameZh ?? channel.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {USE_MOCK && (
          <Alert className='mb-4'>
            <AlertTitle>演示数据模式</AlertTitle>
            <AlertDescription>
              当前未连接后端，界面展示的是内置演示数据。后端就绪后在
              <code className='mx-1 rounded bg-muted px-1 py-0.5 text-xs'>
                .env
              </code>
              设置{' '}
              <code className='rounded bg-muted px-1 py-0.5 text-xs'>
                VITE_USE_MOCK=false
              </code>
              即可切换到真实接口。
            </AlertDescription>
          </Alert>
        )}

        <div className='space-y-4'>
          <StatCards stats={statsQuery.data} isLoading={statsQuery.isLoading} />

          <Card>
            <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-3 space-y-0'>
              <div>
                <CardTitle>发布排期</CardTitle>
                <CardDescription>
                  每行一个栏目，色块为该内容的预定发布时间。点击色块可查看详情、改期或取消。
                </CardDescription>
              </div>
              <div className='flex items-center gap-2'>
                <Tabs
                  value={scale}
                  onValueChange={(value) => setScale(value as TimelineScale)}
                >
                  <TabsList>
                    <TabsTrigger value='day'>未来 7 天</TabsTrigger>
                    <TabsTrigger value='week'>未来 5 周</TabsTrigger>
                    <TabsTrigger value='month'>未来 6 月</TabsTrigger>
                  </TabsList>
                </Tabs>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={() => timelineQuery.refetch()}
                  disabled={timelineQuery.isFetching}
                  title='刷新'
                >
                  <RefreshCw
                    className={
                      timelineQuery.isFetching ? 'size-4 animate-spin' : 'size-4'
                    }
                  />
                </Button>
              </div>
            </CardHeader>
            <CardContent className='px-0'>
              {timelineQuery.isLoading ? (
                <div className='space-y-2 px-6'>
                  {Array.from({ length: 6 }).map((_, index) => (
                    <Skeleton key={index} className='h-9 w-full' />
                  ))}
                </div>
              ) : timelineQuery.isError ? (
                <div className='px-6 pb-6'>
                  <Alert variant='destructive'>
                    <AlertTitle>排期数据加载失败</AlertTitle>
                    <AlertDescription>
                      {(timelineQuery.error as Error).message}
                    </AlertDescription>
                  </Alert>
                </div>
              ) : (
                <Timeline
                  bars={bars}
                  scale={scale}
                  timezone={timezone}
                  onSelect={setSelected}
                />
              )}
            </CardContent>
          </Card>
        </div>
      </Main>

      <ScheduleDialog
        bar={selected}
        timezone={timezone}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </>
  )
}
