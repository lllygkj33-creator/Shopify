/**
 * 时区换算单元测试
 *
 * 这块最容易出「差一小时」的隐性 bug，尤其是夏令时切换点，
 * 所以显式覆盖：正常换算、跨 DST、往返一致性、时区偏移文本。
 *
 * America/Chicago 的 DST 规则（2026 年）：
 *  - 3 月 8 日 02:00 → 03:00（春季前移，当天 02:30 这个墙上时间不存在）
 *  - 11 月 1 日 02:00 → 01:00（秋季后移，01:30 出现两次）
 */
import { setLangGlobal } from '@/i18n'
import { afterEach, describe, expect, it } from 'vitest'
import {
  formatInTimezone,
  formatTimezoneOffset,
  getTimezoneOffsetMinutes,
  isoToWallTime,
  relativeTime,
  wallTimeToIso,
  zonedWallTimeToDate,
} from '@/lib/datetime'

describe('wallTimeToIso', () => {
  it('把 America/Chicago 的墙上时间换算成带偏移的 UTC', () => {
    // 冬令时芝加哥 = UTC-6，09:30 本地 → 15:30Z
    expect(wallTimeToIso('2026-01-15T09:30', 'America/Chicago')).toBe(
      '2026-01-15T15:30:00.000Z'
    )
  })

  it('夏令时期间按 UTC-5 换算', () => {
    // 2026-07-15 芝加哥 = UTC-5，09:30 本地 → 14:30Z
    expect(wallTimeToIso('2026-07-15T09:30', 'America/Chicago')).toBe(
      '2026-07-15T14:30:00.000Z'
    )
  })

  it('Asia/Shanghai 无夏令时，固定 UTC+8', () => {
    expect(wallTimeToIso('2026-09-15T23:59', 'Asia/Shanghai')).toBe(
      '2026-09-15T15:59:00.000Z'
    )
  })

  it('跨春季 DST 边界前后各差一小时', () => {
    // 3/8 之前仍是 CST(-6)，3/9 已是 CDT(-5)
    const before = wallTimeToIso('2026-03-07T12:00', 'America/Chicago')
    const after = wallTimeToIso('2026-03-09T12:00', 'America/Chicago')

    expect(before).toBe('2026-03-07T18:00:00.000Z')
    expect(after).toBe('2026-03-09T17:00:00.000Z')
  })

  it('UTC 时区原样返回', () => {
    expect(wallTimeToIso('2026-05-01T00:00', 'UTC')).toBe(
      '2026-05-01T00:00:00.000Z'
    )
  })

  it('非法格式抛出可读错误', () => {
    expect(() => wallTimeToIso('not-a-date', 'UTC')).toThrow(/无法解析时间/)
  })
})

describe('isoToWallTime', () => {
  it('与 wallTimeToIso 往返一致（冬令时）', () => {
    const wall = '2026-02-10T08:15'
    expect(
      isoToWallTime(wallTimeToIso(wall, 'America/Chicago'), 'America/Chicago')
    ).toBe(wall)
  })

  it('与 wallTimeToIso 往返一致（夏令时）', () => {
    const wall = '2026-08-20T21:45'
    expect(
      isoToWallTime(wallTimeToIso(wall, 'America/Chicago'), 'America/Chicago')
    ).toBe(wall)
  })

  it('同一时刻在不同时区显示不同墙上时间', () => {
    const iso = '2026-09-15T15:59:00.000Z'
    expect(isoToWallTime(iso, 'Asia/Shanghai')).toBe('2026-09-15T23:59')
    expect(isoToWallTime(iso, 'America/Chicago')).toBe('2026-09-15T10:59')
  })

  it('非法输入返回空串而不是崩', () => {
    expect(isoToWallTime('garbage', 'UTC')).toBe('')
  })
})

describe('getTimezoneOffsetMinutes / formatTimezoneOffset', () => {
  it('冬令时芝加哥偏移为 -360 分钟', () => {
    expect(
      getTimezoneOffsetMinutes(
        new Date('2026-01-15T00:00:00Z'),
        'America/Chicago'
      )
    ).toBe(-360)
  })

  it('夏令时芝加哥偏移为 -300 分钟', () => {
    expect(
      getTimezoneOffsetMinutes(
        new Date('2026-07-15T00:00:00Z'),
        'America/Chicago'
      )
    ).toBe(-300)
  })

  it('带毫秒的时刻也得到整分钟偏移', () => {
    // 回归：墙上时间只到秒，而 getTime() 带毫秒，两者相减会多出小数部分。
    // 不取整的话界面上会显示成「UTC+07:59.988699999999994」。
    const withMillis = new Date('2026-01-15T00:00:00.678Z')
    expect(getTimezoneOffsetMinutes(withMillis, 'Asia/Shanghai')).toBe(480)
    expect(getTimezoneOffsetMinutes(new Date(), 'Asia/Shanghai')).toBe(480)
    expect(
      Number.isInteger(getTimezoneOffsetMinutes(new Date(), 'Asia/Shanghai'))
    ).toBe(true)
  })

  it('半小时 / 三刻钟偏移也正确', () => {
    // 尼泊尔 +05:45、印度 +05:30 —— 钉住「整分钟」这个前提
    expect(
      getTimezoneOffsetMinutes(
        new Date('2026-01-15T00:00:00.4Z'),
        'Asia/Kathmandu'
      )
    ).toBe(345)
    expect(
      getTimezoneOffsetMinutes(
        new Date('2026-01-15T00:00:00.4Z'),
        'Asia/Kolkata'
      )
    ).toBe(330)
  })

  it('偏移文本格式为 UTC±HH:MM', () => {
    expect(
      formatTimezoneOffset('Asia/Shanghai', new Date('2026-01-15T00:00:00Z'))
    ).toBe('UTC+08:00')
    expect(formatTimezoneOffset('UTC', new Date('2026-01-15T00:00:00Z'))).toBe(
      'UTC+00:00'
    )
    // 回归：毫秒非零时不能出现小数
    expect(formatTimezoneOffset('Asia/Shanghai', new Date())).toBe('UTC+08:00')
  })
})

describe('zonedWallTimeToDate', () => {
  it('解析出的 Date 在目标时区显示为同一墙上时间', () => {
    const date = zonedWallTimeToDate('2026-04-01T07:00', 'Europe/Berlin')
    expect(isoToWallTime(date.toISOString(), 'Europe/Berlin')).toBe(
      '2026-04-01T07:00'
    )
  })
})

/**
 * 语言相关的输出。
 *
 * 这两处以前是写死的：相对时间只有中文（「3 天前」），绝对时间固定 `zh-CN`
 * （渲染成 `2026/09/15 23:59`）。英文界面拿去截图就会露中文/中文日期习惯，
 * 所以钉住两侧的具体输出。
 */
describe('文案按界面语言输出', () => {
  const now = Date.now()
  const ago = (ms: number) => new Date(now - ms).toISOString()
  const later = (ms: number) => new Date(now + ms).toISOString()

  afterEach(() => {
    setLangGlobal('zh')
  })

  it('英文界面：相对时间是英文，且区分单复数', () => {
    setLangGlobal('en')

    expect(relativeTime(ago(10_000))).toBe('Just now')
    expect(relativeTime(ago(60_000))).toBe('1 minute ago')
    expect(relativeTime(ago(5 * 60_000))).toBe('5 minutes ago')
    expect(relativeTime(ago(2 * 3_600_000))).toBe('2 hours ago')
    expect(relativeTime(ago(3 * 86_400_000))).toBe('3 days ago')
    // 用 75 秒而不是正好 60 秒：这里的 now 是模块级取的，跑到这一行已经过去几毫秒，
    // 卡在 60 秒边界上会被判成「刚刚」
    expect(relativeTime(later(75_000))).toBe('in 1 minute')
    expect(relativeTime(later(2 * 3_600_000))).toBe('in 2 hours')
  })

  it('中文界面：相对时间与改动前完全一致', () => {
    setLangGlobal('zh')

    expect(relativeTime(ago(10_000))).toBe('刚刚')
    expect(relativeTime(ago(60_000))).toBe('1 分钟前')
    expect(relativeTime(ago(3 * 86_400_000))).toBe('3 天前')
    expect(relativeTime(later(2 * 3_600_000))).toBe('2 小时后')
  })

  it('绝对时间：locale 跟语言走，字段与 24 小时制不变', () => {
    const iso = '2026-09-15T15:59:00.000Z'

    setLangGlobal('zh')
    expect(formatInTimezone(iso, 'Asia/Shanghai')).toBe('2026/09/15 23:59')

    setLangGlobal('en')
    expect(formatInTimezone(iso, 'Asia/Shanghai')).toBe('09/15/2026, 23:59')
    expect(formatInTimezone(iso, 'Asia/Shanghai', { withSeconds: true })).toBe(
      '09/15/2026, 23:59:00'
    )
  })

  it('空值仍是占位符 —，与语言无关', () => {
    setLangGlobal('en')
    expect(relativeTime(undefined)).toBe('—')
    expect(formatInTimezone(undefined, 'Asia/Shanghai')).toBe('—')
  })
})
