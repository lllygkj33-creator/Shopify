import { TOKEN_SOURCE_META, type GlobalSettings } from '@/types/content'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react'
import { formatInTimezone, relativeTime } from '@/lib/datetime'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

/**
 * 令牌状态面板
 *
 * 为什么需要它：client_credentials 换来的 token **只有约 24 小时有效期**
 * （实测 86398 秒）。如果没有可视化，用户只会在某天发布突然失败时才发现，
 * 而且很难联想到「token 过期」这个原因。
 *
 * 这里把三件事摊开给用户看：
 *   1. 现在生效的是哪个 token（掩码）以及它从哪来
 *   2. **还剩多久过期**（后端算好秒数传过来，避免浏览器时钟偏差）
 *   3. 这个来源到底会不会自动续期
 */

const HOUR = 3600
const WARN_THRESHOLD = 6 * HOUR // 剩余不足 6 小时开始提醒

type TokenStatusPanelProps = {
  settings: GlobalSettings
  timezone: string
  refreshing: boolean
  onRefresh: () => void
}

function formatRemaining(seconds: number | null | undefined): string {
  if (seconds == null) return '未知'
  if (seconds <= 0) return '已过期'
  const hours = Math.floor(seconds / HOUR)
  const minutes = Math.floor((seconds % HOUR) / 60)
  if (hours >= 48) return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`
  if (hours >= 1) return `${hours} 小时 ${minutes} 分`
  return `${minutes} 分`
}

export function TokenStatusPanel({
  settings,
  timezone,
  refreshing,
  onRefresh,
}: TokenStatusPanelProps) {
  const sourceMeta = TOKEN_SOURCE_META[settings.tokenSource]
  const remaining = settings.tokenExpiresInSeconds ?? null

  const expired = remaining != null && remaining <= 0
  const expiringSoon =
    !expired && remaining != null && remaining < WARN_THRESHOLD

  const statusColor = expired ? '#ef4444' : expiringSoon ? '#f59e0b' : '#22c55e'

  return (
    <div className='space-y-3 rounded-md border p-3'>
      {/* ---- 第一行：当前 token ---- */}
      <div className='flex flex-wrap items-center gap-2 text-xs'>
        <span className='text-muted-foreground'>当前生效</span>
        {settings.hasAccessToken ? (
          <>
            <Badge
              variant='outline'
              className='font-mono'
              style={{ borderColor: `${statusColor}66`, color: statusColor }}
            >
              {settings.hasAccessToken && !expired ? (
                <CheckCircle2 className='size-3' />
              ) : (
                <AlertTriangle className='size-3' />
              )}
              {settings.accessTokenMasked}
            </Badge>
            <span className='text-muted-foreground'>{sourceMeta.label}</span>
          </>
        ) : settings.tokenSource === 'auto' && settings.hasClientCredentials ? (
          // auto 模式下后端是懒加载令牌：凭据齐全但还没换过，
          // 这时说「未配置」会误导用户，应该是中性提示
          <Badge variant='outline' className='text-muted-foreground'>
            凭据已配置，首次调用时自动换取令牌
          </Badge>
        ) : (
          <Badge
            variant='outline'
            className='border-amber-500/50 text-amber-600'
          >
            未配置 token，无法发布
          </Badge>
        )}

        {settings.clientId && (
          <span className='ms-auto font-mono text-[10px] text-muted-foreground'>
            app: {settings.clientId.slice(0, 8)}…
          </span>
        )}
      </div>

      {/* ---- 第二行：有效期 ---- */}
      {settings.hasAccessToken && (
        <div className='flex flex-wrap items-center gap-x-4 gap-y-1 text-xs'>
          <span className='flex items-center gap-1.5'>
            <Clock className='size-3.5' style={{ color: statusColor }} />
            {settings.tokenNeverExpires ? (
              <span className='text-muted-foreground'>
                长期有效（该来源不会自动续期）
              </span>
            ) : (
              <span style={{ color: statusColor }}>
                剩余 {formatRemaining(remaining)}
                {settings.tokenExpiresAt && (
                  <span className='ms-1 text-muted-foreground'>
                    · 到期 {formatInTimezone(settings.tokenExpiresAt, timezone)}
                  </span>
                )}
              </span>
            )}
          </span>

          {settings.tokenLastRefreshedAt && (
            <span className='text-muted-foreground'>
              上次刷新 {relativeTime(settings.tokenLastRefreshedAt)}
            </span>
          )}

          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='h-6 px-2 text-xs'
            onClick={onRefresh}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className='size-3 animate-spin' />
            ) : (
              <RefreshCw className='size-3' />
            )}
            立即换新
          </Button>
        </div>
      )}

      {/* ---- 第三行：权限 ---- */}
      {settings.tokenScope && (
        <p className='font-mono text-[10px] leading-relaxed text-muted-foreground'>
          scope: {settings.tokenScope}
        </p>
      )}

      {settings.tokenError && (
        <p className='text-xs text-destructive'>
          最近一次错误：{settings.tokenError}
        </p>
      )}

      {/* ---- 不会自动续期的来源要明确告警 ---- */}
      {!sourceMeta.autoRenew && settings.hasAccessToken && (
        <>
          <Separator />
          <p className='flex items-start gap-1.5 text-xs text-amber-600'>
            <ShieldAlert className='mt-0.5 size-3.5 shrink-0' />
            <span>{sourceMeta.warning}</span>
          </p>
        </>
      )}
    </div>
  )
}
