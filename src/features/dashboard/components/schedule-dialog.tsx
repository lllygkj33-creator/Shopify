import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { contentApi } from '@/lib/api'
import {
  formatInTimezone,
  formatTimezoneOffset,
  isoToWallTime,
  relativeTime,
  wallTimeToIso,
} from '@/lib/datetime'
import {
  CONTENT_STATUS_META,
  type TimelineBar,
} from '@/types/content'
import { getChannel } from '@/config/channels'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'

type ScheduleDialogProps = {
  bar: TimelineBar | null
  timezone: string
  onOpenChange: (open: boolean) => void
}

/**
 * 排期详情 / 改期 / 取消
 *
 * 这是 PRD §4.1「点击色块可查看详情、取消/改期」的落地。
 * 拖拽改期属于加分项，暂用精确的日期时间输入替代（更不容易误操作）。
 *
 * 拆成两层：外层只负责「是否有选中项」，内层用 key={bar.id} 挂载。
 * 这样内层的 wallTime 可以纯靠 useState 初始化器拿到正确初值，
 * 不需要 useEffect 同步 props → state（那会触发级联渲染）。
 */
export function ScheduleDialog({
  bar,
  timezone,
  onOpenChange,
}: ScheduleDialogProps) {
  if (!bar) return null

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <ScheduleDialogContent
        key={`${bar.id}:${timezone}`}
        bar={bar}
        timezone={timezone}
        onOpenChange={onOpenChange}
      />
    </Dialog>
  )
}

type ContentProps = {
  bar: TimelineBar
  timezone: string
  onOpenChange: (open: boolean) => void
}

function ScheduleDialogContent({
  bar,
  timezone,
  onOpenChange,
}: ContentProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [wallTime, setWallTime] = useState(() => {
    const iso = bar.scheduledAt ?? bar.publishedAt
    return iso ? isoToWallTime(iso, timezone) : ''
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['timeline'] })
    queryClient.invalidateQueries({ queryKey: ['stats'] })
    queryClient.invalidateQueries({ queryKey: ['history'] })
    queryClient.invalidateQueries({ queryKey: ['contents'] })
  }

  const reschedule = useMutation({
    mutationFn: (payload: { id: string; scheduledAt: string }) =>
      contentApi.reschedule(payload.id, payload.scheduledAt),
    onSuccess: (result) => {
      // 本地记录与 Shopify 侧是两件事，必须分开告诉用户
      if (!result.sync.ok) {
        toast.warning(result.sync.warning ?? result.sync.error ?? '线上排期未同步')
      } else if (result.sync.attempted) {
        toast.success('排期已更新，并已同步到 Shopify')
      } else {
        // 没有 Shopify 对象的条目（例如发布失败过的）：只记录了时间，
        // 状态保持原样，要重新发布才会生效 —— 必须说清楚
        toast.info('已记录新的排期时间；该条目在 Shopify 上还没有对象，需重新发布才会生效', {
          duration: 8000,
        })
      }
      invalidate()
      onOpenChange(false)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const cancel = useMutation({
    mutationFn: (id: string) => contentApi.cancelSchedule(id),
    onSuccess: (result) => {
      if (!result.sync.ok) {
        // 最危险的一种：本地已退回草稿，但线上排期还活着 → 到点照样上线
        toast.error(
          result.sync.warning ?? result.sync.error ?? '线上排期未能撤销',
          { duration: 10_000 }
        )
      } else if (result.sync.attempted) {
        toast.success('已取消排期，并已撤销 Shopify 侧的排期')
      } else {
        toast.success('已取消排期并退回草稿')
      }
      invalidate()
      onOpenChange(false)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const channel = getChannel(bar.channelId)
  const meta = CONTENT_STATUS_META[bar.status]
  const iso = bar.scheduledAt ?? bar.publishedAt
  const busy = reschedule.isPending || cancel.isPending
  const canReschedule = bar.status === 'scheduled' || bar.status === 'failed'

  return (
    <>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle className='pe-6 text-base leading-snug'>
            {bar.title}
          </DialogTitle>
          <DialogDescription className='flex flex-wrap items-center gap-2'>
            <Badge
              variant='outline'
              style={{ borderColor: `${meta.color}66`, color: meta.color }}
            >
              {meta.label}
            </Badge>
            {channel && (
              <span className='flex items-center gap-1.5 text-xs'>
                <span
                  className='size-2 rounded-full'
                  style={{ backgroundColor: channel.color }}
                />
                {channel.nameZh ?? channel.name}
              </span>
            )}
            <span className='text-xs text-muted-foreground'>
              {bar.contentType === 'page' ? '页面' : '博客文章'}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3 text-sm'>
          <Row label='发布路径'>
            <code className='rounded bg-muted px-1.5 py-0.5 text-xs'>
              {bar.publishedUrl ?? bar.handle}
            </code>
          </Row>

          <Row label='排期时间'>
            {iso ? (
              <span>
                {formatInTimezone(iso, timezone)}
                <span className='ms-2 text-xs text-muted-foreground'>
                  {formatTimezoneOffset(timezone)} · {relativeTime(iso)}
                </span>
              </span>
            ) : (
              <span className='text-muted-foreground'>未排期（草稿）</span>
            )}
          </Row>

          {bar.error && (
            <>
              <Separator />
              <div className='rounded-md border border-destructive/40 bg-destructive/5 p-3'>
                <div className='mb-1 text-xs font-medium text-destructive'>
                  失败原因
                </div>
                <p className='text-xs leading-relaxed text-destructive/90'>
                  {bar.error}
                </p>
              </div>
            </>
          )}
        </div>

        {canReschedule && (
          <>
            <Separator />
            <div className='space-y-2'>
              <Label htmlFor='reschedule-time' className='text-xs'>
                改期（{timezone} · {formatTimezoneOffset(timezone)}）
              </Label>
              <div className='flex gap-2'>
                <Input
                  id='reschedule-time'
                  type='datetime-local'
                  value={wallTime}
                  onChange={(event) => setWallTime(event.target.value)}
                  className='flex-1'
                />
                <Button
                  disabled={!wallTime || busy}
                  onClick={() =>
                    reschedule.mutate({
                      id: bar.id,
                      scheduledAt: wallTimeToIso(wallTime, timezone),
                    })
                  }
                >
                  {reschedule.isPending && (
                    <Loader2 className='size-4 animate-spin' />
                  )}
                  保存
                </Button>
              </div>
              <p className='text-xs text-muted-foreground'>
                时间按全局设置时区解释，提交给 Shopify 时会带上时区偏移。
              </p>
            </div>
          </>
        )}

        <DialogFooter className='gap-2 sm:justify-between'>
          <Button
            variant='outline'
            onClick={() =>
              navigate({
                to: '/channels/$channelId',
                params: { channelId: bar.channelId },
              })
            }
          >
            打开栏目页
          </Button>
          <div className='flex gap-2'>
            {bar.publishedUrl && bar.status === 'published' && (
              <Button variant='outline' asChild>
                <a
                  href={bar.publishedUrl}
                  target='_blank'
                  rel='noreferrer noopener'
                >
                  <ExternalLink className='size-4' />
                  查看线上
                </a>
              </Button>
            )}
            {bar.status !== 'draft' && (
              <Button
                variant='destructive'
                disabled={busy}
                onClick={() => cancel.mutate(bar.id)}
              >
                {cancel.isPending && <Loader2 className='size-4 animate-spin' />}
                取消排期
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className='flex gap-3'>
      <span className='w-20 shrink-0 text-xs text-muted-foreground'>
        {label}
      </span>
      <div className='min-w-0 flex-1'>{children}</div>
    </div>
  )
}
