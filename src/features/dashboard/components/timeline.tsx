import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  differenceInCalendarWeeks,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

/**
 * 排期时间轴（会议室预定式甘特图）
 *
 * ## 设计取舍
 *
 *  - **自研 CSS 定位实现，零第三方依赖**。需求很窄（每行=栏目，每格=一个时间单位），
 *    用重量级时间轴组件反而要迁就它的数据结构。整个时间轴隔离在这一个文件里，
 *    将来要换 Planby 之类只需替换本组件。
 *  - 颜色用**内联样式**而非 Tailwind 动态类名：栏目颜色是运行时数据，
 *    Tailwind 无法静态提取 `bg-[${color}]` 这种拼接类名。
 *
 * ## 为什么按「格」聚合，不逐个画
 *
 * 原来每个内容画一个色块，重叠时最多铺 3 道、其余折成「+N」。实测真实用量下
 * 这个画法不可用：community-post 一个栏目在**同一天**就排了 108 条
 * （时间几乎相同），结果一行只看得见 3 个，其余全进「+150」。
 *
 * 现在每个时间单位（日视图=1 天，周视图=1 周，月视图=1 个月）**只画一个块**，
 * 块上写条数、块内用一条细条表示状态构成。鼠标悬停或点击展开该格的完整清单，
 * 清单里每一项仍可点开原有的排期详情弹窗。
 *
 * 信息量没有减少（条数直接写在块上），但行高固定、不再有「看不见的 N 条」。
 */

type TimelineProps = {
  bars: TimelineBar[]
  scale: TimelineScale
  timezone: string
  onSelect: (bar: TimelineBar) => void
}

type Tick = { label: string; sublabel?: string; isToday: boolean }

type Window = {
  start: Date
  end: Date
  ticks: Tick[]
  unitCount: number
  /** 一「格」代表多长时间 —— 决定内容落在哪一格 */
  unit: 'day' | 'week' | 'month'
  /** 这一格的中文量词，用于「108 条」这种文案 */
  unitLabel: string
}

function buildWindow(scale: TimelineScale, now: Date): Window {
  if (scale === 'day') {
    // 未来 7 天，每格 1 天
    const start = startOfDay(now)
    const ticks = Array.from({ length: 7 }, (_, index) => ({
      label: format(addDays(start, index), 'MM-dd'),
      sublabel: format(addDays(start, index), 'EEE'),
      isToday: index === 0,
    }))
    return {
      start,
      end: addDays(start, 7),
      ticks,
      unitCount: 7,
      unit: 'day',
      unitLabel: '今天',
    }
  }

  if (scale === 'week') {
    // 未来 5 周，每格 1 周
    const start = startOfWeek(now, { weekStartsOn: 1 })
    const ticks = Array.from({ length: 5 }, (_, index) => ({
      label: `${format(addWeeks(start, index), 'MM-dd')} 起`,
      sublabel: `第 ${index + 1} 周`,
      isToday: index === 0,
    }))
    return {
      start,
      end: addWeeks(start, 5),
      ticks,
      unitCount: 5,
      unit: 'week',
      unitLabel: '本周',
    }
  }

  // 未来 6 个月，每格 1 个月
  const start = startOfMonth(now)
  const ticks = Array.from({ length: 6 }, (_, index) => ({
    label: format(addMonths(start, index), 'yyyy-MM'),
    sublabel: format(addMonths(start, index), 'MMM'),
    isToday: index === 0,
  }))
  return {
    start,
    end: endOfMonth(addMonths(start, 5)),
    ticks,
    unitCount: 6,
    unit: 'month',
    unitLabel: '本月',
  }
}

/** 内容落在哪一格 */
function bucketIndexOf(time: Date, window: Window): number {
  const raw =
    window.unit === 'day'
      ? differenceInCalendarDays(time, window.start)
      : window.unit === 'week'
        ? differenceInCalendarWeeks(time, window.start, { weekStartsOn: 1 })
        : differenceInCalendarMonths(time, window.start)

  return Math.min(window.unitCount - 1, Math.max(0, raw))
}

/** 把时间点换算成轨道内的百分比位置（「现在」标记线用） */
function positionPercent(time: Date, window: Window): number {
  const total = differenceInMinutes(window.end, window.start)
  const offset = differenceInMinutes(time, window.start)
  return Math.min(100, Math.max(0, (offset / total) * 100))
}

type Bucket = {
  index: number
  count: number
  bars: TimelineBar[]
  /** 状态 → 条数，用于块内的构成细条 */
  composition: [ContentStatus, number][]
  dominant: ContentStatus
}

export function Timeline({ bars, scale, timezone, onSelect }: TimelineProps) {
  /**
   * 时间窗口只在切换粒度时重算。
   * `new Date()` 放在 useMemo 内部，避免每次渲染都生成新对象导致 memo 失效。
   * 代价是页面长时间挂着跨过午夜时窗口不会自动前移 —— 刷新即恢复，
   * 对本地单机工具来说可以接受。
   */
  const window = useMemo(() => buildWindow(scale, new Date()), [scale])

  /** 按栏目分组，再按「格」聚合 */
  const rows = useMemo(() => {
    return CHANNELS.map((channel) => {
      const buckets = new Map<number, TimelineBar[]>()

      for (const bar of bars) {
        if (bar.channelId !== channel.id) continue
        const iso = bar.scheduledAt ?? bar.publishedAt
        const time = iso ? new Date(iso) : null
        if (!time || Number.isNaN(time.getTime())) continue
        // 窗口之外的不画 —— 否则会全部堆在两端边界上误导判断
        if (time < window.start || time >= window.end) continue

        const index = bucketIndexOf(time, window)
        const list = buckets.get(index)
        if (list) list.push(bar)
        else buckets.set(index, [bar])
      }

      const cells: Bucket[] = Array.from(buckets.entries())
        .map(([index, list]) => {
          const counts = new Map<ContentStatus, number>()
          for (const bar of list) {
            counts.set(bar.status, (counts.get(bar.status) ?? 0) + 1)
          }
          const composition = [...counts.entries()].sort((a, b) => b[1] - a[1])

          return {
            index,
            count: list.length,
            bars: [...list].sort((a, b) => {
              const left = a.scheduledAt ?? a.publishedAt ?? ''
              const right = b.scheduledAt ?? b.publishedAt ?? ''
              return left.localeCompare(right)
            }),
            composition,
            dominant: composition[0][0],
          }
        })
        .sort((a, b) => a.index - b.index)

      return {
        channel,
        cells,
        total: cells.reduce((sum, cell) => sum + cell.count, 0),
      }
    })
  }, [bars, window])

  // 「现在」标记线的位置，只在窗口变化时重算
  const nowPercent = useMemo(
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
              {row.total > 0 && (
                <span className='ms-auto shrink-0 font-mono text-[10px] text-muted-foreground'>
                  {row.total}
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
                    className={cn('border-l', tick.isToday && 'bg-muted/20')}
                  />
                ))}
              </div>

              {/* 今天标记 */}
              {nowPercent > 0 && nowPercent < 100 && (
                <div
                  className='pointer-events-none absolute inset-y-0 z-10 w-px bg-destructive/60'
                  style={{ left: `${nowPercent}%` }}
                />
              )}

              {/* 内容：每格一个块，与表头列对齐 */}
              <div
                className='relative grid h-11 items-center py-1'
                style={{
                  gridTemplateColumns: `repeat(${window.unitCount}, minmax(0, 1fr))`,
                }}
              >
                {window.ticks.map((tick, index) => {
                  const cell = row.cells.find((entry) => entry.index === index)

                  return (
                    <div key={tick.label} className='h-full px-0.5'>
                      {cell && (
                        <BucketBlock
                          cell={cell}
                          channelLabel={row.channel.nameZh ?? row.channel.name}
                          tick={tick}
                          timezone={timezone}
                          onSelect={onSelect}
                        />
                      )}
                    </div>
                  )
                })}
              </div>

              {row.total === 0 && (
                <div className='pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-muted-foreground/60'>
                  暂无排期
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ---------- 图例 ---------- */}
      <div className='flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3 text-xs text-muted-foreground'>
        {(['scheduled', 'published', 'failed', 'draft'] as ContentStatus[]).map(
          (status) => (
            <span key={status} className='flex items-center gap-1.5'>
              <span
                className='size-2.5 rounded-sm'
                style={{
                  backgroundColor: CONTENT_STATUS_META[status].color,
                  ...(status === 'draft'
                    ? {
                        backgroundColor: 'transparent',
                        border: '1px dashed currentColor',
                      }
                    : {}),
                }}
              />
              {CONTENT_STATUS_META[status].label}
            </span>
          )
        )}
        <span className='flex items-center gap-1.5'>
          <span className='h-3 w-px bg-destructive/60' />
          现在
        </span>
        <span className='ms-auto'>
          块上的数字是该格的内容条数，悬停或点击展开清单
        </span>
      </div>
    </div>
  )
}

type BucketBlockProps = {
  cell: Bucket
  channelLabel: string
  tick: Tick
  timezone: string
  onSelect: (bar: TimelineBar) => void
}

/**
 * 一个时间格里的内容块。
 *
 * - **条数写在块上**：不折叠、不隐藏，一眼能看出这天有多少条
 * - 块内细条表示状态构成（多条时才知道有多少是排期、多少是失败）
 * - **只有一条时点了直接开排期详情**，不弹清单：
 *   为了显示一行而弹出 320px 宽的面板（≈2.4 列）会盖住相邻格，
 *   还多一次点击。多条才需要清单。
 * - 多条时悬停展开清单；点击也展开（触屏和键盘用不了悬停）
 */
function BucketBlock({
  cell,
  channelLabel,
  tick,
  timezone,
  onSelect,
}: BucketBlockProps) {
  /**
   * 悬停关闭要**延迟**。
   *
   * 触发块和浮层之间有一道缝（`sideOffset`），指针从块移到浮层必然经过它，
   * 触发块的 mouseleave 会先到 —— 立即关闭的话浮层还没等鼠标够到就消失了，
   * 表现为闪烁、点不中里面的条目。
   */
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const hoverOpen = useCallback(() => {
    cancelClose()
    setOpen(true)
  }, [cancelClose])

  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), 160)
  }, [cancelClose])

  // 组件卸载时别留下定时器
  useEffect(() => cancelClose, [cancelClose])

  const meta = CONTENT_STATUS_META[cell.dominant]
  const face = <BlockFace cell={cell} />
  const blockClass = cn(BLOCK_BUTTON_CLASS, BLOCK_HOVER_CLASS)
  const blockStyle =
    cell.dominant === 'draft'
      ? { color: meta.color, borderStyle: 'dashed' as const }
      : {
          backgroundColor: `${meta.color}1a`,
          borderColor: `${meta.color}66`,
          color: meta.color,
        }

  // 只有一条：直接开详情，不弹清单
  if (cell.count === 1) {
    return (
      <button
        type='button'
        data-testid='timeline-bucket'
        data-count={cell.count}
        data-status={cell.dominant}
        data-tick-index={cell.index}
        aria-label={`${channelLabel} ${tick.label} ${cell.bars[0].title}`}
        title={cell.bars[0].title}
        onClick={() => onSelect(cell.bars[0])}
        className={blockClass}
        style={blockStyle}
      >
        {face}
      </button>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type='button'
          data-testid='timeline-bucket'
          data-count={cell.count}
          data-status={cell.dominant}
          data-tick-index={cell.index}
          aria-label={`${channelLabel} ${tick.label} 共 ${cell.count} 条`}
          title={`${cell.count} 条：${cell.bars
            .slice(0, 3)
            .map((bar) => bar.title)
            .join(
              '\n'
            )}${cell.count > 3 ? `\n…另有 ${cell.count - 3} 条` : ''}`}
          onMouseEnter={hoverOpen}
          onMouseLeave={scheduleClose}
          /*
            点一下保持打开。
            Radix 的触发器点击是「切换」；而鼠标点下去之前会先触发 mouseenter
            （已经把它打开了），紧接着的 click 就会被当成「关掉」——
            表现是悬停展开后一点就消失。触屏上 mouseenter 与 click 也连着来，
            同样会一开一关。
            `preventDefault` 能拦住 Radix 内部的切换（它用 composeEventHandlers，
            看到 defaultPrevented 就跳过自己的处理）。关闭交给移开鼠标或点别处。
          */
          onClick={(event) => {
            if (open) {
              event.preventDefault()
              setOpen(true)
            }
          }}
          className={blockClass}
          style={blockStyle}
        >
          {face}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align='start'
        sideOffset={2}
        /*
          面板别太宽：一格只有一百来像素，面板宽了会盖住相邻的两三格，
          看起来就像「内容占了两格」。
        */
        className='w-64 p-0'
        onMouseEnter={hoverOpen}
        onMouseLeave={scheduleClose}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className='border-b px-3 py-2 text-xs'>
          <div className='flex items-center justify-between gap-2 font-medium'>
            <span>
              {channelLabel} · {tick.label}
            </span>
            <span className='font-mono text-muted-foreground'>
              {cell.count} 条
            </span>
          </div>
          {cell.composition.length > 1 && (
            <div className='mt-0.5 text-[10px] text-muted-foreground'>
              {cell.composition
                .map(
                  ([status, count]) =>
                    `${CONTENT_STATUS_META[status].label} ${count}`
                )
                .join(' · ')}
            </div>
          )}
        </div>

        <div className='max-h-72 overflow-y-auto p-1'>
          {cell.bars.map((bar) => (
            <BucketItem
              key={bar.id}
              bar={bar}
              timezone={timezone}
              onSelect={(selected) => {
                setOpen(false)
                onSelect(selected)
              }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

const BLOCK_BUTTON_CLASS =
  'flex h-full w-full flex-col justify-center gap-0.5 overflow-hidden rounded-md border px-1.5 text-left text-xs shadow-sm transition'

const BLOCK_HOVER_CLASS =
  'hover:z-20 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

/** 块的可见内容：条数 + 状态构成细条。不放标题（见块上的注释）。 */
function BlockFace({ cell }: { cell: Bucket }) {
  return (
    <>
      {/*
        块上只放**简要信息**：条数 + 状态构成，不放标题。
        一格通常只有一百来像素，塞完整标题必然被裁成
        「1ExampleBoard 2 vs ExampleBlade: Which Home Se」这种半截字，
        看着像溢出了格子。完整标题在悬停清单里（那里有宽度）。
      */}
      <span className='flex min-w-0 items-baseline gap-1'>
        <span className='font-mono text-sm font-semibold'>{cell.count}</span>
        <span className='truncate text-[10px] opacity-80'>条</span>
      </span>

      {/* 状态构成细条：只有一种状态时就是一条实色，不额外干扰 */}
      <span className='flex h-1 w-full overflow-hidden rounded-full'>
        {cell.composition.map(([status, count]) => (
          <span
            key={status}
            style={{
              width: `${(count / cell.count) * 100}%`,
              backgroundColor: CONTENT_STATUS_META[status].color,
            }}
          />
        ))}
      </span>
    </>
  )
}

function BucketItem({
  bar,
  timezone,
  onSelect,
}: {
  bar: TimelineBar
  timezone: string
  onSelect: (bar: TimelineBar) => void
}) {
  const meta = CONTENT_STATUS_META[bar.status]
  const iso = bar.scheduledAt ?? bar.publishedAt
  const label = iso ? isoToWallTime(iso, timezone).slice(11) : ''

  return (
    <button
      type='button'
      data-testid='timeline-chip'
      data-status={bar.status}
      onClick={() => onSelect(bar)}
      className='flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition hover:bg-accent focus-visible:bg-accent focus-visible:outline-none'
    >
      <span
        className='size-1.5 shrink-0 rounded-full'
        style={{ backgroundColor: meta.color }}
      />
      <span className='flex-1 truncate'>{bar.title}</span>
      <span className='shrink-0 font-mono text-[10px] text-muted-foreground'>
        {label}
      </span>
    </button>
  )
}
