import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { CHANNELS } from '@/config/channels'
import { channelLabel } from '@/i18n/channel-label'
import type { TimelineBar, TimelineScale } from '@/types/content'
import { CalendarPlus, ChevronDown, RefreshCw } from 'lucide-react'
import { contentApi, settingsApi, USE_MOCK } from '@/lib/api'
import { DEFAULT_TIMEZONE } from '@/lib/datetime'
import { useI18n } from '@/context/i18n-provider'
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
import { ConfigDrawer } from '@/components/config-drawer'
import { LangSwitch } from '@/components/lang-switch'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { ScheduleDialog } from './components/schedule-dialog'
import { StatCards } from './components/stat-cards'
import { Timeline } from './components/timeline'

export function Dashboard() {
  const navigate = useNavigate()
  const { t, lang } = useI18n()
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
        <LangSwitch />
        <ThemeSwitch />
        <ConfigDrawer />
      </Header>

      <Main>
        <div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
          <div>
            <h1 className='text-2xl font-bold tracking-tight'>
              {t('dashboard.title')}
            </h1>
            <p className='text-sm text-muted-foreground'>
              {t('dashboard.subtitle', { timezone })}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <CalendarPlus className='size-4' />
                {t('dashboard.newSchedule')}
                <ChevronDown className='size-4' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align='end'
              className='max-h-80 w-56 overflow-y-auto'
            >
              <DropdownMenuLabel>
                {t('dashboard.selectChannel')}
              </DropdownMenuLabel>
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
                  {channelLabel(channel, lang)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {USE_MOCK && (
          <Alert className='mb-4'>
            <AlertTitle>{t('dashboard.mock.title')}</AlertTitle>
            <AlertDescription>
              {t('dashboard.mock.body')
                .split('<strong>')
                .flatMap((chunk) => chunk.split('</strong>'))
                .map((chunk, index) =>
                  // 词条里的 <strong> 是「重点在哪半句」的标记，不能当 HTML 注入，
                  // 所以按标记切片后用 <strong> 渲染
                  index % 2 === 0 ? (
                    <span key={index}>{chunk}</span>
                  ) : (
                    <strong key={index}>{chunk}</strong>
                  )
                )}
              <code className='rounded bg-muted px-1 py-0.5 text-xs'>
                pnpm dev
              </code>
              {t('dashboard.mock.bodyTail')}{' '}
              <code className='rounded bg-muted px-1 py-0.5 text-xs'>
                pnpm dev:mock
              </code>{' '}
              {t('dashboard.mock.bodyTailEnd')}
            </AlertDescription>
          </Alert>
        )}

        <div className='space-y-4'>
          <StatCards stats={statsQuery.data} isLoading={statsQuery.isLoading} />

          <Card>
            <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-3 space-y-0'>
              <div>
                <CardTitle>{t('dashboard.schedule.title')}</CardTitle>
                <CardDescription>
                  {t('dashboard.schedule.description')}
                </CardDescription>
              </div>
              <div className='flex items-center gap-2'>
                <Tabs
                  value={scale}
                  onValueChange={(value) => setScale(value as TimelineScale)}
                >
                  <TabsList>
                    <TabsTrigger value='day'>
                      {t('dashboard.scale.day')}
                    </TabsTrigger>
                    <TabsTrigger value='week'>
                      {t('dashboard.scale.week')}
                    </TabsTrigger>
                    <TabsTrigger value='month'>
                      {t('dashboard.scale.month')}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={() => timelineQuery.refetch()}
                  disabled={timelineQuery.isFetching}
                  title={t('dashboard.action.refresh')}
                >
                  <RefreshCw
                    className={
                      timelineQuery.isFetching
                        ? 'size-4 animate-spin'
                        : 'size-4'
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
                    <AlertTitle>
                      {t('dashboard.timeline.loadFailed')}
                    </AlertTitle>
                    <AlertDescription>
                      {(timelineQuery.error as Error).message}
                    </AlertDescription>
                  </Alert>
                </div>
              ) : (
                <>
                  {/*
                    空库提示。
                    为什么必须有：新装的平台本地库是**空的**（只记平台自己发过的内容，
                    不导入店铺历史），时间轴会是一片空网格。没有这句话的话，
                    看起来像加载失败或连错了库。
                  */}
                  {bars.length === 0 && (
                    <div className='mx-6 mb-4 rounded-md border border-dashed p-3 text-xs text-muted-foreground'>
                      {t('dashboard.timeline.empty')}
                    </div>
                  )}
                  <Timeline
                    bars={bars}
                    scale={scale}
                    timezone={timezone}
                    onSelect={setSelected}
                  />
                </>
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
