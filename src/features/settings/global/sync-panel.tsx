import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SyncReport } from '@/types/content'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import { syncApi } from '@/lib/api'
import { relativeTime } from '@/lib/datetime'
import { useI18n } from '@/context/i18n-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

/**
 * 数据同步面板（对账）
 *
 * ## 为什么需要它
 *
 * 本地库 = 「平台自己发过的」+「线上所有未来排期」。两件事都得同步：
 *
 * 1. **拉未来排期** —— 排期不是平台独有的事。内容可能是在 Shopify 后台、
 *    或别的工具排上去的（实测店铺里就有 172 条这样的页面）。不拉进来，
 *    仪表盘的排期全景就是残缺的：用户明明排了 100 多条，界面写 0。
 *
 * 2. **对账已知对象** —— 平台发定时内容用的是 Shopify 原生机制
 *    （未来 `publishDate` + `isPublished: false`），到点**由 Shopify 自己上线**。
 *    好处是本地不需要定时任务，服务没开也不会漏发；代价是线上到点发生的事
 *    本地不会自动知道。不对账会看到三种假象：
 *      - 内容早就发出去了，界面还写「待发布」
 *      - 人在后台把还没到点的对象删了，界面以为它还会按时上线
 *      - 人在后台改了发布时间或标题，界面显示的是旧值
 *
 * ## 边界
 *
 * **不含**店铺里平台上线之前就存在的已发布历史（用户要求
 * 「只存平台自己发布的 和未来的，过去的通通不记录」）。
 * 所以没有「导入历史」这种操作，也不会有「本地 N 条 vs 线上 M 条对不上」
 * 的漂移问题 —— 拉取成本也不随店铺历史增长。
 */

type SyncPanelProps = {
  hasCredentials: boolean
  timezone: string
}

/** 把 {桶: 数量} 摊成一行行，数量大的排前面 */
function SortedCounts({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort(([, a], [, b]) => b - a)
  if (entries.length === 0) return null

  return (
    <ul className='space-y-0.5'>
      {entries.map(([label, count]) => (
        <li key={label} className='flex justify-between gap-3'>
          <span className='truncate'>{label}</span>
          <span className='shrink-0 font-mono'>{count}</span>
        </li>
      ))}
    </ul>
  )
}

function SyncResult({ report }: { report: SyncReport }) {
  const { t } = useI18n()
  const drift = report.updated + report.gone
  const skippedTotal = Object.values(report.skipped).reduce((a, b) => a + b, 0)

  return (
    <div className='space-y-1.5 rounded-md border bg-muted/30 p-2 text-xs'>
      <p className='flex items-center gap-1.5 font-medium'>
        <CheckCircle2 className='size-3.5 text-emerald-600' />
        {t('settings.sync.result.pulled', { count: report.scheduledPulled })}
        {report.scheduledFound > 0 && (
          <span className='font-normal text-muted-foreground'>
            {t('settings.sync.result.found', { count: report.scheduledFound })}
          </span>
        )}
      </p>

      {Object.keys(report.byChannel).length > 0 && (
        <details>
          <summary className='cursor-pointer text-muted-foreground'>
            {t('settings.sync.result.byChannel')}
          </summary>
          <div className='mt-1 ps-2'>
            <SortedCounts counts={report.byChannel} />
          </div>
        </details>
      )}

      {skippedTotal > 0 && (
        <details>
          <summary className='cursor-pointer text-muted-foreground'>
            {t('settings.sync.result.skipped', { count: skippedTotal })}
          </summary>
          <div className='mt-1 ps-2'>
            <SortedCounts counts={report.skipped} />
          </div>
        </details>
      )}

      <p className='flex items-center gap-1.5'>
        {drift === 0 ? (
          <CheckCircle2 className='size-3.5 text-emerald-600' />
        ) : (
          <AlertTriangle className='size-3.5 text-amber-600' />
        )}
        {t('settings.sync.result.checked', { count: report.checked })}
        {drift === 0 ? (
          <span className='text-muted-foreground'>
            {t('settings.sync.result.consistent')}
          </span>
        ) : (
          <span className='text-muted-foreground'>
            {t('settings.sync.result.drift', { count: drift })}
            {report.updated > 0 &&
              t('settings.sync.result.updated', { count: report.updated })}
            {report.gone > 0 &&
              t(
                report.updated > 0
                  ? 'settings.sync.result.goneMore'
                  : 'settings.sync.result.goneOnly',
                { count: report.gone }
              )}
            {t('settings.sync.result.close')}
          </span>
        )}
      </p>

      {report.gone > 0 && (
        <p className='text-muted-foreground'>
          {t('settings.sync.result.goneNote')}
        </p>
      )}
    </div>
  )
}

export function SyncPanel({ hasCredentials, timezone }: SyncPanelProps) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [result, setResult] = useState<SyncReport | null>(null)

  const statusQuery = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => syncApi.status(),
  })

  const syncMutation = useMutation({
    mutationFn: () => syncApi.run(),
    onSuccess: (report) => {
      setResult(report)
      if (report.error) {
        toast.error(t('settings.sync.toast.failed', { error: report.error }))
        return
      }
      // 对账可能改了状态/时间/标题，列表和仪表盘都要重新拉
      void queryClient.invalidateQueries({ queryKey: ['contents'] })
      void queryClient.invalidateQueries({ queryKey: ['timeline'] })
      void queryClient.invalidateQueries({ queryKey: ['stats'] })
      void queryClient.invalidateQueries({ queryKey: ['history'] })
      void queryClient.invalidateQueries({ queryKey: ['sync-status'] })

      const drift = report.updated + report.gone
      const parts = [
        t('settings.sync.toast.pulled', { count: report.scheduledPulled }),
      ]
      if (drift > 0)
        parts.push(t('settings.sync.toast.fixed', { count: drift }))
      if (drift === 0) {
        parts.push(
          t('settings.sync.toast.consistent', { count: report.checked })
        )
      }
      const summary = parts.join(t('settings.listJoin'))
      if (drift === 0) {
        toast.success(summary)
      } else {
        toast.info(summary)
      }
    },
    onError: (error: Error) =>
      toast.error(t('settings.sync.toast.failed', { error: error.message })),
  })

  const status = statusQuery.data
  const disabled = !hasCredentials || syncMutation.isPending

  return (
    <div className='space-y-3 rounded-md border p-3'>
      <div className='flex flex-wrap items-center gap-2 text-xs'>
        <span className='text-muted-foreground'>
          {t('settings.sync.tracked')}
        </span>
        <Badge variant='outline' className='font-mono'>
          {status ? status.trackedContents : '—'}
        </Badge>
        {status && status.scheduledContents > 0 && (
          <span className='text-muted-foreground'>
            {t('settings.sync.tracked.scheduled', {
              count: status.scheduledContents,
            })}
          </span>
        )}

        {status?.lastSyncAt ? (
          <span className='text-muted-foreground'>
            {t('settings.sync.lastSync', {
              time: relativeTime(status.lastSyncAt ?? undefined),
            })}
          </span>
        ) : (
          status && (
            <span className='text-muted-foreground'>
              {t('settings.sync.never')}
            </span>
          )
        )}

        {status && (
          <span className='ms-auto text-muted-foreground'>
            {t('settings.sync.auto')}{' '}
            {status.syncIntervalMinutes > 0
              ? t('settings.sync.auto.every', {
                  minutes: status.syncIntervalMinutes,
                })
              : t('settings.sync.auto.off')}
          </span>
        )}
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={disabled}
          onClick={() => syncMutation.mutate()}
        >
          {syncMutation.isPending ? (
            <Loader2 className='size-3.5 animate-spin' />
          ) : (
            <RefreshCw className='size-3.5' />
          )}
          {t('settings.sync.run')}
        </Button>
        <span className='text-xs text-muted-foreground'>
          {t('settings.sync.timezone', { timezone })}
        </span>
      </div>

      {!hasCredentials && (
        <p className='flex items-start gap-1.5 text-xs text-amber-600'>
          <ShieldAlert className='mt-0.5 size-3.5 shrink-0' />
          <span>{t('settings.sync.noCredentials')}</span>
        </p>
      )}

      {result && <SyncResult report={result} />}

      <Separator />
      <p className='flex items-start gap-1.5 text-xs text-muted-foreground'>
        <AlertTriangle className='mt-0.5 size-3.5 shrink-0' />
        <span>
          {t('settings.sync.note.before')}
          <strong className='font-medium'>
            {t('settings.sync.note.strong')}
          </strong>
          {t('settings.sync.note.after')}
        </span>
      </p>
    </div>
  )
}
