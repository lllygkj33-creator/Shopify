import { describe, expect, it } from 'vitest'
import { allKeys, messagesFor, translate } from './index'

/**
 * 词条表的完整性。
 *
 * 最容易出的问题不是"翻错了"，而是**漏翻**：中文加了新词、英文没跟上，
 * 界面上就出现原始键名或中英混排。这里把两侧对齐钉死。
 */
describe('i18n 词条', () => {
  const zh = messagesFor('zh')
  const en = messagesFor('en')

  it('中英两侧的键必须完全一致（无漏翻、无多余）', () => {
    const onlyZh = Object.keys(zh).filter((k) => !(k in en))
    const onlyEn = Object.keys(en).filter((k) => !(k in zh))

    expect({ onlyZh, onlyEn }).toEqual({ onlyZh: [], onlyEn: [] })
  })

  it('没有空文案', () => {
    const empty = allKeys().filter((k) => !zh[k]?.trim() || !en[k]?.trim())

    expect(empty).toEqual([])
  })

  it('键名按区域前缀命名（便于并行维护）', () => {
    const bad = allKeys().filter((k) => !/^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/i.test(k))

    expect(bad).toEqual([])
  })

  it('参数插值两种语言都生效', () => {
    expect(translate('zh', 'i18n.selfTest', { n: 3 })).toBe('n=3')
    expect(translate('en', 'i18n.selfTest', { n: 3 })).toBe('n=3')
  })

  it('缺键时回落中文，再回落键名本身（不会崩）', () => {
    expect(translate('en', 'common.language')).toBe('Language')
    expect(translate('en', 'does.not.exist')).toBe('does.not.exist')
  })
})
