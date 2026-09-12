import type { DashboardStats } from '@/types/content'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  FileEdit,
} from 'lucide-react'
import { useI18n } from '@/context/i18n-provider'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

type StatCardsProps = {
  stats?: DashboardStats
  isLoading: boolean
}

/** 这里只放词条的键，文案由组件按当前语言取 */
const ITEMS = [
  {
    key: 'scheduledCount' as const,
    labelKey: 'dashboard.stats.scheduled',
    hintKey: 'dashboard.stats.scheduledHint',
    icon: CalendarClock,
    color: '#3b82f6',
  },
  {
    key: 'publishedCount' as const,
    labelKey: 'dashboard.stats.published',
    hintKey: 'dashboard.stats.publishedHint',
    icon: CheckCircle2,
    color: '#22c55e',
  },
  {
    key: 'failedCount' as const,
    labelKey: 'dashboard.stats.failed',
    hintKey: 'dashboard.stats.failedHint',
    icon: AlertTriangle,
    color: '#ef4444',
  },
  {
    key: 'draftCount' as const,
    labelKey: 'dashboard.stats.draft',
    hintKey: 'dashboard.stats.draftHint',
    icon: FileEdit,
    color: '#94a3b8',
  },
]

export function StatCards({ stats, isLoading }: StatCardsProps) {
  const { t } = useI18n()

  return (
    <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
      {ITEMS.map((item) => (
        <Card key={item.key}>
          <CardContent className='flex items-start justify-between pt-6'>
            <div className='space-y-1'>
              <p className='text-sm font-medium text-muted-foreground'>
                {t(item.labelKey)}
              </p>
              {isLoading ? (
                <Skeleton className='h-8 w-12' />
              ) : (
                <p className='text-2xl font-bold tabular-nums'>
                  {stats?.[item.key] ?? 0}
                </p>
              )}
              <p className='text-xs text-muted-foreground'>{t(item.hintKey)}</p>
            </div>
            <item.icon className='size-4' style={{ color: item.color }} />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
