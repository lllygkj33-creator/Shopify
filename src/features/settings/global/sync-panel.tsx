import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReconcileReport } from '@/types/content'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

/**
 * 数据同步面板（对账）
 *
 * ## 为什么需要它
 *
 * 平台发定时内容用的是 Shopify 原生机制：创建时就给未来的 `publishDate`
 * 并且 `isPublished: false`，到点**由 Shopify 自己上线**。
 *
 * 好处是本地不需要定时任务 —— 服务没开也不会漏发，不存在「漏发」这种事故。
 * 代价是：线上到点发生了什么，本地不会自动知道。所以需要对账把真实状态拉回来。
 *
 * 不对账会看到的假象：
 *   - 内容早就发出去了，界面还写「待发布」
 *   - 人在后台把还没到点的对象删了，界面以为它还会按时上线
 *   - 人在后台改了发布时间或标题，界面显示的是旧值
 *
 * ## 边界
 *
 * 只对账**平台自己排期/发布过的对象**。店铺里平台上线之前就存在的历史内容
 * 不入库 —— 用户明确要求「只存平台自己发布的 和未来的，过去的通通不记录」，
 * 所以这里不需要「导入历史」这种操作，也不会有本地与线上对不上的漂移问题。
 */

type SyncPanelProps = {
  hasCredentials: boolean
  timezone: string
}

function ReconcileResult({ report }: { report: ReconcileReport }) {
  const drift = report.updated + report.gone

  return (
    <div className='space-y-1 rounded-md border bg-muted/30 p-2 text-xs'>
      <p className='flex items-center gap-1.5 font-medium'>
        {drift === 0 ? (
          <CheckCircle2 className='size-3.5 text-emerald-600' />
        ) : (
          <AlertTriangle className='size-3.5 text-amber-600' />
        )}
        {drift === 0 ? '本地与线上一致' : `修正了 ${drift} 条`}
      </p>
      <p className='text-muted-foreground'>
        检查 {report.checked} 条 · 匹配 {report.matched} 条
        {report.updated > 0 && ` · 状态更新 ${report.updated} 条`}
        {report.gone > 0 && ` · 线上已删除 ${report.gone} 条`}
      </p>
      {report.gone > 0 && (
        <p className='text-muted-foreground'>
          已删除的对象会在列表里标注原因，不会被静默移除。
        </p>
      )}
    </div>
  )
}

export function SyncPanel({ hasCredentials, timezone }: SyncPanelProps) {
  const queryClient = useQueryClient()
  const [result, setResult] = useState<ReconcileReport | null>(null)

  const statusQuery = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => syncApi.status(),
  })

  const reconcileMutation = useMutation({
    mutationFn: () => syncApi.reconcile(),
    onSuccess: (report) => {
      setResult(report)
      if (report.error) {
        toast.error(`对账失败：${report.error}`)
        return
      }
      // 对账可能改了状态/时间/标题，列表和仪表盘都要重新拉
      void queryClient.invalidateQueries({ queryKey: ['contents'] })
      void queryClient.invalidateQueries({ queryKey: ['timeline'] })
      void queryClient.invalidateQueries({ queryKey: ['stats'] })
      void queryClient.invalidateQueries({ queryKey: ['history'] })
      void queryClient.invalidateQueries({ queryKey: ['sync-status'] })

      const drift = report.updated + report.gone
      if (drift === 0) {
        toast.success(`已检查 ${report.checked} 条，本地与线上一致`)
      } else {
        toast.info(
          `已修正 ${drift} 条（状态更新 ${report.updated}，线上删除 ${report.gone}）`
        )
      }
    },
    onError: (error: Error) => toast.error(`对账失败：${error.message}`),
  })

  const status = statusQuery.data
  const disabled = !hasCredentials || reconcileMutation.isPending

  return (
    <div className='space-y-3 rounded-md border p-3'>
      <div className='flex flex-wrap items-center gap-2 text-xs'>
        <span className='text-muted-foreground'>已关联 Shopify</span>
        <Badge variant='outline' className='font-mono'>
          {status ? status.trackedContents : '—'}
        </Badge>

        {status && status.trackedContents === 0 && (
          <span className='text-muted-foreground'>
            还没有发布过内容，发布后这里会开始有数
          </span>
        )}

        {status?.lastReconcileAt ? (
          <span className='text-muted-foreground'>
            上次对账 {relativeTime(status.lastReconcileAt)}
          </span>
        ) : (
          status && <span className='text-muted-foreground'>尚未对账</span>
        )}

        {status && (
          <span className='ms-auto text-muted-foreground'>
            自动对账
            {status.syncIntervalMinutes > 0
              ? ` 每 ${status.syncIntervalMinutes} 分钟`
              : '已关闭'}
          </span>
        )}
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={disabled}
          onClick={() => reconcileMutation.mutate()}
        >
          {reconcileMutation.isPending ? (
            <Loader2 className='size-3.5 animate-spin' />
          ) : (
            <RefreshCw className='size-3.5' />
          )}
          立即对账
        </Button>
        <span className='text-xs text-muted-foreground'>
          （时区 {timezone}）
        </span>
      </div>

      {!hasCredentials && (
        <p className='flex items-start gap-1.5 text-xs text-amber-600'>
          <ShieldAlert className='mt-0.5 size-3.5 shrink-0' />
          <span>
            店铺凭据未配置，对账不可用。请先在上面填好 CLIENT_ID /
            CLIENT_SECRET。
          </span>
        </p>
      )}

      {result && <ReconcileResult report={result} />}

      <Separator />
      <p className='flex items-start gap-1.5 text-xs text-muted-foreground'>
        <AlertTriangle className='mt-0.5 size-3.5 shrink-0' />
        <span>
          定时发布由 Shopify 自己执行（创建时就带未来发布时间），
          <strong className='font-medium'>本平台没有本地定时任务</strong>
          ，不存在服务没开导致漏发的情况。对账只负责把线上的真实状态同步回本地。
        </span>
      </p>
    </div>
  )
}
