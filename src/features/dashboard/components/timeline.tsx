import { useMemo } from 'react'
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInMinutes,
  endOfMonth,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { CHANNELS } from '@/config/channels'
import {
  CONTENT_STATUS_META,
  type ContentStatus,
  type TimelineBar,
  type TimelineScale,
} from '@/types/content'
import { isoToWallTime } from '@/lib/datetime'
import { cn } from '@/lib/utils'

/**
 * 排期时间轴（会议室预定式甘特图）
 *
 * 设计取舍：
 *  - **自研 CSS 定位实现，零第三方依赖**。原因是这里的需求很窄（每行=栏目，
 *    每块=一个时间点），用重量级时间轴组件反而要迁就它的数据结构与样式。
 *    整个时间轴被隔离在这一个文件里，将来若要换成 Planby 等成熟组件，
 *    只需替换本组件，页面与数据结构都不受影响。
 *  - 颜色用**内联样式**而非 Tailwind 动态类名：栏目颜色是运行时数据，
 *    Tailwind 无法静态提取 `bg-[${color}]` 这类拼接类名。
 */

type TimelineProps = {
  bars: TimelineBar[]
  scale: TimelineScale
  timezone: string
  onSelect: (bar: TimelineBar) => void
}

type Window = {
  start: Date
  end: Date
  ticks: { label: string; sublabel?: string; isToday: boolean }[]
  unitCount: number
}

function buildWindow(scale: TimelineScale, now: Date): Window {
  if (scale === 'day') {
    // 未来 7 天，每列 1 天
    const start = startOfDay(now)
    const ticks = Array.from({ length: 7 }, (_, index) => {
      const date = addDays(start, index)
      return {
        label: format(date, 'MM-dd'),
        sublabel: format(date, 'EEE'),
        isToday: index === 0,
      }
    })
    return { start, end: addDays(start, 7), ticks, unitCount: 7 }
  }

  if (scale === 'week') {
    // 未来 5 周，每列 1 周
    const start = startOfWeek(now, { weekStartsOn: 1 })
    const ticks = Array.from({ length: 5 }, (_, index) => {
      const date = addWeeks(start, index)
      return {
        label: `${format(date, 'MM-dd')} 起`,
        sublabel: `第 ${index + 1} 周`,
        isToday: index === 0,
      }
    })
    return { start, end: addWeeks(start, 5), ticks, unitCount: 5 }
  }

  // 未来 6 个月，每列 1 个月
  const start = startOfMonth(now)
  const ticks = Array.from({ length: 6 }, (_, index) => {
    const date = addMonths(start, index)
    return {
      label: format(date, 'yyyy-MM'),
      sublabel: format(date, 'MMM'),
      isToday: index === 0,
    }
  })
  return { start, end: endOfMonth(addMonths(start, 5)), ticks, unitCount: 6 }
}

/** 把时间点换算成轨道内的百分比位置 */
function positionPercent(time: Date, window: Window): number {
  const total = differenceInMinutes(window.end, window.start)
  const offset = differenceInMinutes(time, window.start)
  return Math.min(100, Math.max(0, (offset / total) * 100))
}

/**
 * 同一行内的防重叠分道：
 * 若与前一块在这个百分比窗口内重叠，就换到下一道。
 * 阈值用百分比近似（块宽约 9%），足够避免视觉压盖。
 */
const BAR_WIDTH_PERCENT = 9
const LANE_GAP_PERCENT = 1.5

function assignLanes(items: { bar: TimelineBar; percent: number }[]) {
  const lanes: number[] = []
  const result: { bar: TimelineBar; percent: number; lane: number }[] = []

  for (const item of items) {
    let lane = 0
    while (
      lanes[lane] !== undefined &&
      item.percent - lanes[lane] < BAR_WIDTH_PERCENT + LANE_GAP_PERCENT
    ) {
      lane += 1
    }
    lanes[lane] = item.percent
    result.push({ ...item, lane })
  }

  return result
}

// 每行最多显示的道数，超出则提示「+N」
const MAX_LANES = 3

export function Timeline({ bars, scale, timezone, onSelect }: TimelineProps) {
  /**
   * 时间窗口只在切换粒度时重算。
   * `new Date()` 放在 useMemo 内部，避免每次渲染都生成新对象导致 memo 失效。
   * 代价是页面长时间挂着跨过午夜时窗口不会自动前移——刷新即恢复，
   * 对本地单机工具来说可以接受。
   */
  const window = useMemo(() => buildWindow(scale, new Date()), [scale])

  /** 按栏目分组，并计算位置与分道 */
  const rows = useMemo(() => {
    return CHANNELS.map((channel) => {
      const channelBars = bars
        .filter((bar) => bar.channelId === channel.id)
        .map((bar) => {
          const iso = bar.scheduledAt ?? bar.publishedAt
          const time = iso ? new Date(iso) : null
          if (!time || Number.isNaN(time.getTime())) return null
          // 当前视图窗口之外的排期不画，否则会全部堆在左右边界上误导判断
          if (time < window.start || time >= window.end) return null
          return { bar, percent: positionPercent(time, window) }
        })
        .filter((entry): entry is { bar: TimelineBar; percent: number } =>
          Boolean(entry)
        )
        .sort((a, b) => a.percent - b.percent)

      const laidOut = assignLanes(channelBars)
      const hidden = laidOut.filter((entry) => entry.lane >= MAX_LANES).length

      return {
        channel,
        entries: laidOut.filter((entry) => entry.lane < MAX_LANES),
        laneCount: Math.min(
          MAX_LANES,
          Math.max(1, ...laidOut.map((entry) => entry.lane + 1))
        ),
        hidden,
      }
    })
  }, [bars, window])

  // 「现在」标记线的位置，只在窗口变化时重算
  const todayPercent = useMemo(
    () => positionPercent(new Date(), window),
    [window]
  )

  return (
    <div className='overflow-x-auto'>
      <div className='min-w-[900px]'>
        {/* ---------- 表头 ---------- */}
        <div className='grid grid-cols-[200px_1fr] border-b'>
          <div className='flex items-center px-3 py-2 text-xs font-medium text-muted-foreground'>
            栏目 / 时间
          </div>
          <div
            className='grid'
            style={{
              gridTemplateColumns: `repeat(${window.unitCount}, minmax(0, 1fr))`,
            }}
          >
            {window.ticks.map((tick) => (
              <div
                key={tick.label}
                className={cn(
                  'border-l px-2 py-2 text-center text-xs',
                  tick.isToday && 'bg-muted/40'
                )}
              >
                <div className='font-medium'>{tick.label}</div>
                <div className='text-[10px] text-muted-foreground'>
                  {tick.sublabel}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ---------- 行 ---------- */}
        {rows.map((row) => (
          <div
            key={row.channel.id}
            className='grid grid-cols-[200px_1fr] border-b last:border-b-0'
          >
            {/* 行标签 */}
            <div className='flex items-center gap-2 px-3 py-2'>
              <span
                className='size-2.5 shrink-0 rounded-full'
                style={{ backgroundColor: row.channel.color }}
              />
              <span className='truncate text-sm'>
                {row.channel.nameZh ?? row.channel.name}
              </span>
              {row.hidden > 0 && (
                <span
                  className='ms-auto text-[10px] text-muted-foreground'
                  title={`另有 ${row.hidden} 条排期重叠未显示`}
                >
                  +{row.hidden}
                </span>
              )}
            </div>

            {/* 轨道 */}
            <div className='relative'>
              {/* 竖向网格线 */}
              <div
                className='pointer-events-none absolute inset-0 grid'
                style={{
                  gridTemplateColumns: `repeat(${window.unitCount}, minmax(0, 1fr))`,
                }}
              >
                {window.ticks.map((tick) => (
                  <div
                    key={tick.label}
                    className={cn(
                      'border-l',
                      tick.isToday && 'bg-muted/20'
                    )}
                  />
                ))}
              </div>

              {/* 今天标记 */}
              {todayPercent > 0 && todayPercent < 100 && (
                <div
                  className='pointer-events-none absolute inset-y-0 z-10 w-px bg-destructive/60'
                  style={{ left: `${todayPercent}%` }}
                />
              )}

              {/* 内容块 */}
              <div
                className='relative'
                style={{ height: `${row.laneCount * 30 + 8}px` }}
              >
                {row.entries.map((entry) => (
                  <TimelineChip
                    key={entry.bar.id}
                    bar={entry.bar}
                    percent={entry.percent}
                    lane={entry.lane}
                    timezone={timezone}
                    onSelect={onSelect}
                  />
                ))}
                {row.entries.length === 0 && (
                  <div className='absolute inset-y-0 left-3 flex items-center text-xs text-muted-foreground/60'>
                    暂无排期
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ---------- 图例 ---------- */}
      <div className='flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3 text-xs text-muted-foreground'>
        {(
          ['scheduled', 'published', 'failed', 'draft'] as ContentStatus[]
        ).map((status) => (
          <span key={status} className='flex items-center gap-1.5'>
            <span
              className='size-2.5 rounded-sm'
              style={{
                backgroundColor: CONTENT_STATUS_META[status].color,
                ...(status === 'draft'
                  ? { backgroundColor: 'transparent', border: '1px dashed currentColor' }
                  : {}),
              }}
            />
            {CONTENT_STATUS_META[status].label}
          </span>
        ))}
        <span className='flex items-center gap-1.5'>
          <span className='h-3 w-px bg-destructive/60' />
          现在
        </span>
      </div>
    </div>
  )
}

type ChipProps = {
  bar: TimelineBar
  percent: number
  lane: number
  timezone: string
  onSelect: (bar: TimelineBar) => void
}

function TimelineChip({ bar, percent, lane, timezone, onSelect }: ChipProps) {
  const meta = CONTENT_STATUS_META[bar.status]
  const iso = bar.scheduledAt ?? bar.publishedAt
  const label = iso ? isoToWallTime(iso, timezone).slice(11) : ''

  return (
    <button
      type='button'
      data-testid='timeline-chip'
      data-status={bar.status}
      onClick={() => onSelect(bar)}
      title={`${bar.title}\n${meta.label}${label ? ` · ${label}` : ''}`}
      className={cn(
        'absolute flex h-7 max-w-[240px] items-center gap-1.5 overflow-hidden rounded-md border px-2 text-xs shadow-sm transition',
        'hover:z-20 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        bar.status === 'draft' && 'border-dashed bg-transparent'
      )}
      style={{
        left: `${percent}%`,
        top: `${lane * 30 + 4}px`,
        transform: 'translateX(-2px)',
        // 实心/描边两种表现：草稿用描边，其余用状态色填充
        ...(bar.status === 'draft'
          ? { color: meta.color }
          : {
              backgroundColor: `${meta.color}1a`,
              borderColor: `${meta.color}66`,
              color: meta.color,
            }),
      }}
    >
      <span
        className='size-1.5 shrink-0 rounded-full'
        style={{ backgroundColor: meta.color }}
      />
      <span className='truncate font-medium'>{bar.title}</span>
      {label && (
        <span className='shrink-0 text-[10px] opacity-70'>{label}</span>
      )}
    </button>
  )
}
