import { useQuery } from '@tanstack/react-query'
import { CONTENT_STATUS_META, type ContentStatus } from '@/types/content'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { historyApi } from '@/lib/api'
import { formatInTimezone, relativeTime } from '@/lib/datetime'
import { useI18n } from '@/context/i18n-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type HistoryTableProps = {
  channelId: string
  timezone: string
}

export function HistoryTable({ channelId, timezone }: HistoryTableProps) {
  const { t } = useI18n()
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['history', channelId],
    queryFn: () => historyApi.list(channelId),
  })

  if (isLoading) {
    return (
      <div className='space-y-2'>
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className='h-10 w-full' />
        ))}
      </div>
    )
  }

  const entries = data ?? []

  if (entries.length === 0) {
    return (
      <div className='rounded-lg border border-dashed px-6 py-12 text-center'>
        <p className='text-sm text-muted-foreground'>
          {t('channels.history.empty')}
        </p>
      </div>
    )
  }

  return (
    <div className='space-y-3'>
      <div className='flex justify-end'>
        <Button
          variant='ghost'
          size='sm'
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw
            className={isFetching ? 'size-4 animate-spin' : 'size-4'}
          />
          {t('channels.history.refresh')}
        </Button>
      </div>
      <div className='rounded-lg border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='min-w-[260px]'>
                {t('channels.history.col.title')}
              </TableHead>
              <TableHead className='w-[100px]'>
                {t('channels.history.col.status')}
              </TableHead>
              <TableHead className='w-[190px]'>
                {t('channels.history.col.publishedAt')}
              </TableHead>
              <TableHead className='w-[180px]'>
                {t('channels.history.col.result')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => {
              const meta = CONTENT_STATUS_META[entry.status as ContentStatus]
              const iso = entry.scheduledAt ?? entry.publishedAt
              return (
                <TableRow key={entry.id}>
                  <TableCell>
                    <div className='space-y-0.5'>
                      <p className='text-sm leading-snug'>{entry.title}</p>
                      <p className='truncate font-mono text-xs text-muted-foreground'>
                        {entry.handle}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant='outline'
                      className='font-normal'
                      style={{
                        borderColor: `${meta.color}66`,
                        color: meta.color,
                      }}
                    >
                      {meta.label}
                    </Badge>
                  </TableCell>
                  <TableCell className='text-xs text-muted-foreground'>
                    {iso ? (
                      <div className='space-y-0.5'>
                        <div>{formatInTimezone(iso, timezone)}</div>
                        <div className='opacity-70'>{relativeTime(iso)}</div>
                      </div>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className='text-xs'>
                    {entry.error ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className='line-clamp-2 cursor-help text-destructive'>
                            {entry.error}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className='max-w-md'>
                          {entry.error}
                        </TooltipContent>
                      </Tooltip>
                    ) : entry.publishedUrl ? (
                      <a
                        href={entry.publishedUrl}
                        target='_blank'
                        rel='noreferrer noopener'
                        className='inline-flex items-center gap-1 text-primary hover:underline'
                      >
                        <ExternalLink className='size-3' />
                        {t('channels.history.view')}
                      </a>
                    ) : (
                      <span className='text-muted-foreground'>
                        {t('channels.history.submitted')}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
