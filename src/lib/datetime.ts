/**
 * 时区工具
 *
 * 为什么需要它：
 * 用户在 UI 里选的是「2026-09-15 09:30」这样一个**墙上时间**，
 * 但 Shopify 的 publishDate 需要带时区偏移的 ISO 8601 字符串。
 * 浏览器原生没有 date-fns-tz，这里用 Intl API 精确换算，避免：
 *  - 直接 new Date('2026-09-15T09:30') 被当成浏览器本地时区
 *  - 跨夏令时（DST）边界算错一小时
 *
 * 全局默认时区来自设置（GEO 里 config.json 用 America/Chicago，
 * app_config.json 用 Asia/Shanghai —— 这个冲突已在新平台里收敛为一处配置）。
 */

/** 常用时区候选（覆盖 Zima 团队协作场景） */
export const TIMEZONE_OPTIONS = [
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai（中国标准时间，UTC+8）— 默认' },
  { value: 'America/New_York', label: 'America/New_York（美国东部，UTC-5/-4）' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles（美国西部，UTC-8/-7）' },
  { value: 'Europe/London', label: 'Europe/London（伦敦，UTC+0/+1）' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin（柏林，UTC+1/+2）' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo（日本，UTC+9）' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore（新加坡，UTC+8）' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney（悉尼，UTC+10/+11）' },
  { value: 'UTC', label: 'UTC（协调世界时）' },
]

export const DEFAULT_TIMEZONE = 'Asia/Shanghai'

type Parts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function getParts(date: Date, timeZone: string): Parts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  const map: Record<string, string> = {}
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value
  }

  return {
    year: Number(map.year),
    // Intl 在 hour12:false 下可能返回 24 表示午夜，归一化为 0
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

function partsToUtcMillis(parts: Parts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  )
}

/** 某时刻在该时区的 UTC 偏移（分钟） */
export function getTimezoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = getParts(date, timeZone)
  return (partsToUtcMillis(parts) - date.getTime()) / 60000
}

/**
 * 把某时区的「墙上时间」转成真实的 UTC 瞬间。
 * 迭代两次以正确处理夏令时切换点。
 */
export function zonedWallTimeToDate(
  wallTime: string,
  timeZone: string
): Date {
  const match = wallTime.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/
  )
  if (!match) {
    throw new Error(`无法解析时间「${wallTime}」，期望格式 YYYY-MM-DDTHH:mm`)
  }

  const [, y, mo, d, h, mi, s] = match
  const guessParts: Parts = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h),
    minute: Number(mi),
    second: Number(s ?? '0'),
  }

  const guessUtc = partsToUtcMillis(guessParts)

  // 用猜测时刻的偏移反推，再复算一次以覆盖 DST 边界
  let offset = getTimezoneOffsetMinutes(new Date(guessUtc), timeZone)
  let candidate = guessUtc - offset * 60000
  offset = getTimezoneOffsetMinutes(new Date(candidate), timeZone)
  candidate = guessUtc - offset * 60000

  return new Date(candidate)
}

/** 墙上时间 → 带偏移的 ISO 8601（Shopify publishDate 需要的格式） */
export function wallTimeToIso(wallTime: string, timeZone: string): string {
  return zonedWallTimeToDate(wallTime, timeZone).toISOString()
}

/** ISO → 指定时区下的墙上时间（填入 <input type="datetime-local">） */
export function isoToWallTime(iso: string, timeZone: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const p = getParts(date, timeZone)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

/** 展示用：把 ISO 按指定时区格式化成人类可读文本 */
export function formatInTimezone(
  iso: string | undefined,
  timeZone: string,
  options?: { withSeconds?: boolean }
): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(options?.withSeconds ? { second: '2-digit' } : {}),
    hour12: false,
  }).format(date)
}

/** 该时区当前的 UTC 偏移文本，例如 UTC+08:00 */
export function formatTimezoneOffset(timeZone: string, at: Date = new Date()): string {
  const minutes = getTimezoneOffsetMinutes(at, timeZone)
  const sign = minutes >= 0 ? '+' : '-'
  const abs = Math.abs(minutes)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  return `UTC${sign}${hh}:${mm}`
}

/** 默认排期时间：当前时间 + N 小时，取整到下一个 5 分钟，返回墙上时间字符串 */
export function defaultScheduleWallTime(
  timeZone: string,
  hoursAhead = 24
): string {
  const target = new Date(Date.now() + hoursAhead * 3600_000)
  const wall = isoToWallTime(target.toISOString(), timeZone)
  const [datePart, timePart] = wall.split('T')
  const [hh, mm] = timePart.split(':').map(Number)
  const rounded = Math.ceil(mm / 5) * 5
  if (rounded >= 60) {
    const bumped = new Date(`${datePart}T${String(hh).padStart(2, '0')}:00:00`)
    bumped.setHours(bumped.getHours() + 1)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${bumped.getFullYear()}-${p(bumped.getMonth() + 1)}-${p(bumped.getDate())}T${p(bumped.getHours())}:00`
  }
  return `${datePart}T${String(hh).padStart(2, '0')}:${String(rounded).padStart(2, '0')}`
}

/**
 * 墙上时间是否已经过去。
 *
 * 用于发布前拦截：后端与参考脚本都禁止把已过去的时间交给 Shopify
 * （`ALLOW_PAST_SCHEDULE = False`），在这里提前标出来，避免点了发布才失败。
 */
export function isPastWallTime(wallTime: string, timeZone: string): boolean {
  if (!wallTime) return false
  try {
    return zonedWallTimeToDate(wallTime, timeZone).getTime() <= Date.now()
  } catch {
    return false
  }
}

/** 相对时间描述，用于历史记录 */
export function relativeTime(iso: string | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'

  const diffMs = date.getTime() - Date.now()
  const abs = Math.abs(diffMs)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  const suffix = diffMs >= 0 ? '后' : '前'
  if (abs < minute) return '刚刚'
  if (abs < hour) return `${Math.round(abs / minute)} 分钟${suffix}`
  if (abs < day) return `${Math.round(abs / hour)} 小时${suffix}`
  if (abs < 30 * day) return `${Math.round(abs / day)} 天${suffix}`
  return formatInTimezone(iso, DEFAULT_TIMEZONE)
}
