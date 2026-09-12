import type { Channel } from '@/config/channels'
import type { Lang } from './index'

/**
 * 栏目名按语言取：配置里同时给了英文 `name` 与中文 `nameZh`。
 *
 * 中文界面优先 nameZh，英文界面用 name；中文缺失时回落 name（反之亦然）。
 */
export function channelLabel(
  channel: Pick<Channel, 'name' | 'nameZh'>,
  lang: Lang
): string {
  return lang === 'zh'
    ? (channel.nameZh ?? channel.name)
    : (channel.name || (channel.nameZh ?? ''))
}
