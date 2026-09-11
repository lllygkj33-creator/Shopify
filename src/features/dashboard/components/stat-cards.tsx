import { AlertTriangle, CalendarClock, CheckCircle2, FileEdit } from 'lucide-react'
import type { DashboardStats } from '@/types/content'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

type StatCardsProps = {
  stats?: DashboardStats
  isLoading: boolean
}

const ITEMS = [
  {
    key: 'scheduledCount' as const,
    label: '待发布',
    hint: '已提交 Shopify，等待到点上线',
    icon: CalendarClock,
    color: '#3b82f6',
  },
  {
    key: 'publishedCount' as const,
    label: '已发布',
    hint: '已上线内容',
    icon: CheckCircle2,
    color: '#22c55e',
  },
  {
    key: 'failedCount' as const,
    label: '发布失败',
    hint: '需要重试或修正',
    icon: AlertTriangle,
    color: '#ef4444',
  },
  {
    key: 'draftCount' as const,
    label: '草稿',
    hint: '已入库但未排期',
    icon: FileEdit,
    color: '#94a3b8',
  },
]

export function StatCards({ stats, isLoading }: StatCardsProps) {
  return (
    <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
      {ITEMS.map((item) => (
        <Card key={item.key}>
          <CardContent className='flex items-start justify-between pt-6'>
            <div className='space-y-1'>
              <p className='text-sm font-medium text-muted-foreground'>
                {item.label}
              </p>
              {isLoading ? (
                <Skeleton className='h-8 w-12' />
              ) : (
                <p className='text-2xl font-bold tabular-nums'>
                  {stats?.[item.key] ?? 0}
                </p>
              )}
              <p className='text-xs text-muted-foreground'>{item.hint}</p>
            </div>
            <item.icon className='size-4' style={{ color: item.color }} />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
