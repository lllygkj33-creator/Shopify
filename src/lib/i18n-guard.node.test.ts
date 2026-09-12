/**
 * 「切成英文后屏幕上不留汉字」的两条守卫。
 *
 * 为什么要单独钉：这个平台默认中文界面，漏翻（或照抄中文）的英文词条在中文界面下
 * 完全看不出来，只有切到英文截图时才露馅。词条测试只能覆盖走 `t()` 的文案，
 * 所以再补一条对**演示数据**（mock 模式直接铺在页面上，是截图最常用的模式）的检查。
 *
 * 区域边界：词条只查 `shell.` 前缀 —— 各区域对自己的词条负责，别人的由各自盯。
 */
import { setLangGlobal, messagesFor } from '@/i18n'
import { afterEach, describe, expect, it } from 'vitest'
import { mockApi } from '@/lib/mock-api'

/** 汉字、中文标点与全角符号 */
const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/

describe('shell 词条', () => {
  it('英文侧没有汉字（切英文后屏幕上不留中文）', () => {
    const hits = Object.entries(messagesFor('en'))
      .filter(([key, value]) => key.startsWith('shell.') && CJK.test(value))
      .map(([key, value]) => `${key} => ${value}`)

    expect(hits).toEqual([])
  })

  it('中英两侧都不缺、不空', () => {
    const zh = messagesFor('zh')
    const en = messagesFor('en')
    const shellKeys = Object.keys(en).filter((key) => key.startsWith('shell.'))

    expect(shellKeys.length).toBeGreaterThan(100)
    expect(
      shellKeys.filter((key) => !zh[key]?.trim() || !en[key]?.trim())
    ).toEqual([])
  })
})

describe('演示数据（mock 模式）', () => {
  afterEach(() => {
    setLangGlobal('zh')
  })

  it('英文界面下没有硬编码的汉字', () => {
    setLangGlobal('en')

    // `field` 是与后端约定的字段标识（`html代码` 就是 JSON 里真实的键名），
    // 界面上从不渲染它 —— 这里只检查真正会显示出来的文案
    const payload = JSON.stringify(
      [mockApi.listContents(), mockApi.getTimeline(), mockApi.listHistory()],
      (key, value) => (key === 'field' ? undefined : value)
    )

    expect(payload.match(CJK) ?? []).toEqual([])
  })
})
