import { CHANNELS } from '@/config/channels'
import type { TimelineBar } from '@/types/content'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { Timeline } from './timeline'

/**
 * 时间轴的聚合画法。
 *
 * 背景：原来「一个内容一个色块、重叠时最多铺 3 道、其余折成 +N」的写法，
 * 在真实用量下不可用 —— community-post 一个栏目在同一天排了 106 条，
 * 结果一行只看得见 3 个。现在改成**每格一个块**，块上写条数。
 *
 * 这里钉住三件事：
 *  1. 同一格里的内容聚合成**一个块**，条数写在块上（不折叠、不隐藏）
 *  2. 一个块**不出自己那一格**（不含完整标题那种会被裁成半截字的写法）
 *  3. 展开后能拿到该格完整清单，点单项回传出去（由页面打开排期详情）
 */

const CHANNEL_ID = CHANNELS[0].id

/** 落在今天上午的若干条，全部属于同一格 */
function barsToday(count: number): TimelineBar[] {
  const today = new Date()
  const base = new Date(today)
  base.setHours(10, 0, 0, 0)

  return Array.from({ length: count }, (_, index) => {
    const at = new Date(base.getTime() + index * 1000)
    return {
      id: `bar-${index}`,
      channelId: CHANNEL_ID,
      title: `ZimaBoard 2 vs ZimaBlade: Which Home Server Should You Build ${index}`,
      handle: `handle-${index}`,
      status: 'scheduled',
      contentType: 'page',
      scheduledAt: at.toISOString(),
    } satisfies TimelineBar
  })
}

async function renderTimeline(bars: TimelineBar[], onSelect = vi.fn()) {
  const screen = await render(
    <Timeline
      bars={bars}
      scale='day'
      timezone='Asia/Shanghai'
      onSelect={onSelect}
    />
  )
  return { screen, onSelect }
}

describe('Timeline 按时间格聚合', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // 浮层渲染在 portal 里，不属于 render 的容器；不卸载的话上一个用例的
  // 时间轴会留在文档里，querySelectorAll 会把两个实例的块混在一起数
  afterEach(() => {
    cleanup()
  })

  it('同一格里的多条聚合成一个块，条数写在块上', async () => {
    await renderTimeline(barsToday(106))

    const buckets = document.querySelectorAll('[data-testid="timeline-bucket"]')
    expect(buckets).toHaveLength(1)
    expect(buckets[0].getAttribute('data-count')).toBe('106')
    // 条数直接可见，不需要先展开
    expect(buckets[0].textContent).toContain('106')
  })

  it('块上不放标题', async () => {
    await renderTimeline(barsToday(3))

    const block = document.querySelector('[data-testid="timeline-bucket"]')
    // 一格只有一百来像素，塞完整标题会被裁成半截字、看着像溢出
    expect(block?.textContent).not.toContain('ZimaBoard')
  })

  it('块不会越出自己那一格', async () => {
    await renderTimeline(barsToday(106))

    const block = document.querySelector(
      '[data-testid="timeline-bucket"]'
    ) as HTMLElement
    const cell = block.parentElement as HTMLElement
    const blockBox = block.getBoundingClientRect()
    const cellBox = cell.getBoundingClientRect()

    expect(blockBox.left).toBeGreaterThanOrEqual(cellBox.left - 1)
    expect(blockBox.right).toBeLessThanOrEqual(cellBox.right + 1)
    // 文字也不能溢出块（不然就是「占用两格」的观感）
    expect(block.scrollWidth).toBeLessThanOrEqual(block.clientWidth + 1)
  })

  it('每格一个块，条数与该格内容数一致', async () => {
    const today = barsToday(4)
    // 明天再来 2 条 —— 应该是另一格、另一个块
    const tomorrow = today.slice(0, 2).map((bar, index) => ({
      ...bar,
      id: `tomorrow-${index}`,
      scheduledAt: new Date(
        new Date(bar.scheduledAt as string).getTime() + 24 * 3600 * 1000
      ).toISOString(),
    }))

    await renderTimeline([...today, ...tomorrow])

    const buckets = Array.from(
      document.querySelectorAll('[data-testid="timeline-bucket"]')
    )
    expect(buckets).toHaveLength(2)
    expect(buckets.map((bucket) => bucket.getAttribute('data-count'))).toEqual([
      '4',
      '2',
    ])
  })

  it('窗口之外的内容不画', async () => {
    const far = new Date()
    far.setMonth(far.getMonth() + 3)

    await renderTimeline([
      ...barsToday(1),
      {
        ...barsToday(1)[0],
        id: 'far-away',
        scheduledAt: far.toISOString(),
      },
    ])

    const buckets = document.querySelectorAll('[data-testid="timeline-bucket"]')
    expect(buckets).toHaveLength(1)
    expect(buckets[0].getAttribute('data-count')).toBe('1')
  })

  it('展开后能拿到该格完整清单', async () => {
    await renderTimeline(barsToday(3))

    // 点击也能展开（触屏和键盘用不了悬停）
    await userEvent.click(
      document.querySelector('[data-testid="timeline-bucket"]') as HTMLElement
    )

    // 浮层是异步挂载的，轮询等它出来
    await vi.waitFor(() => {
      expect(
        document.querySelectorAll('[data-testid="timeline-chip"]').length
      ).toBe(3)
    })

    const titles = Array.from(
      document.querySelectorAll('[data-testid="timeline-chip"]')
    ).map((el) => el.textContent ?? '')
    // 清单里是**完整标题**（那里有宽度），与块上只放条数相反
    expect(titles[0]).toContain('ZimaBoard 2 vs ZimaBlade')
  })

  it('点清单里的单项会把该条回传给调用方', async () => {
    const { onSelect } = await renderTimeline(barsToday(2))

    await userEvent.click(
      document.querySelector('[data-testid="timeline-bucket"]') as HTMLElement
    )

    await vi.waitFor(() => {
      expect(
        document.querySelectorAll('[data-testid="timeline-chip"]').length
      ).toBe(2)
    })

    const first = document.querySelector(
      '[data-testid="timeline-chip"]'
    ) as HTMLElement
    await userEvent.click(first)

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0].title).toContain('ZimaBoard')
  })

  it('没有内容的栏目显示「暂无排期」', async () => {
    await renderTimeline([])

    expect(document.body.textContent).toContain('暂无排期')
  })
})
