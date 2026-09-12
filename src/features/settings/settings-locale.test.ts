import { en, zh } from '@/i18n/locales/settings'
import { describe, expect, it } from 'vitest'
import { TIMEZONE_OPTIONS } from '@/lib/datetime'

/**
 * 设置区词条表（`settings.*`）。
 *
 * 全表的键对齐由 `src/i18n/i18n.test.ts` 兜底，这里只钉两件本区域特有的事：
 *
 * 1. **插值参数两侧一致** —— `{count}` 写成 `{counts}` 这种笔误在界面上表现为
 *    参数没被替换（原样显示 `{count}`），只有对比两侧才能自动发现。
 * 2. **中文与改造前一致** —— 抽几条容易「顺手润色」的长文案钉住原文，
 *    防止后续有人把中文也一起改了（这次只做双语，不改中文）。
 */

function paramsOf(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
}

// 两张表都是字面量类型，按 key 逐个取时要显式放宽成 string 索引
const zhTable: Record<string, string> = zh
const enTable: Record<string, string> = en

describe('settings.* 词条表', () => {
  const keys = Object.keys(zh)

  it('只放本区域的键', () => {
    const bad = keys.filter((key) => !key.startsWith('settings.'))

    expect(bad).toEqual([])
  })

  it('中英两边的插值参数一致', () => {
    const mismatched = keys
      .filter((key) => key in en)
      .filter(
        (key) =>
          paramsOf(zhTable[key]).join(',') !==
          paramsOf(enTable[key] ?? '').join(',')
      )
      .map((key) => ({
        key,
        zh: paramsOf(zhTable[key]),
        en: paramsOf(enTable[key] ?? ''),
      }))

    expect(mismatched).toEqual([])
  })

  it('中文长文案与改造前逐字一致', () => {
    // 这几条原来在 JSX 里跨行书写，换行折成了空格；照抄时别顺手删掉
    expect(zh['settings.shop.domain']).toBe('店铺域名')
    expect(zh['settings.token.section']).toBe('访问 Token')
    expect(zh['settings.token.notice.title']).toBe(
      '注意：自动换发的 token 只有约 24 小时有效期'
    )
    expect(zh['settings.token.notice.after']).toContain(
      '所以平台把它当作**派生凭据**而不是配置： 长期保存的是 CLIENT_ID / CLIENT_SECRET'
    )
    expect(zh['settings.section.connection.desc']).toBe(
      '店铺域名与 Admin API 版本。这两项所有发布器共用。'
    )
    expect(zh['settings.mapping.section']).toBe('栏目 → 博客映射自检')
    expect(zh['settings.mapping.ok.titleOnly.before']).toContain(
      '个是**靠标题**匹配成功的（handle 不一致）：'
    )
    expect(zh['settings.templateChoices.desc2.middle']).toBe(
      ' 权限），会优先列出主题里 实际的 '
    )
    expect(zh['settings.relatedProductTitles.desc.after']).toBe(
      ' 占位符， 发布器按标题解析为 product GID。'
    )
    expect(zh['settings.save']).toBe('保存并下发')
    expect(zh['settings.listSeparator']).toBe('、')
  })

  it('技术值（模板后缀、示例域名）两种语言保持一致', () => {
    expect(zh['settings.shop.domain.placeholder']).toBe(
      en['settings.shop.domain.placeholder']
    )
    expect(zh['settings.templateChoices.placeholder']).toContain(
      'templateSuffix'
    )
    expect(en['settings.templateChoices.placeholder']).toContain(
      'templateSuffix'
    )
    expect(en['settings.templateChoices.placeholder']).toContain(
      'community_post'
    )
    expect(en['settings.defaultAuthor.placeholder']).toBe('Author Name')
    expect(zh['settings.timezone']).toBe('默认时区')
  })

  it('时区下拉每个选项都有词条（漏一个就会回落成中文 label）', () => {
    const tzKeys = keys.filter(
      (key) =>
        key.startsWith('settings.timezone.') && key !== 'settings.timezone.desc'
    )

    expect(tzKeys).toHaveLength(TIMEZONE_OPTIONS.length)

    const unmatched = TIMEZONE_OPTIONS.filter(
      (option) =>
        tzKeys.filter((key) => enTable[key].startsWith(`${option.value} `))
          .length !== 1
    ).map((option) => option.value)

    expect(unmatched).toEqual([])
  })

  it('英文里不该留下中文（汉字、中文标点、全角符号）', () => {
    // 与 src/lib/i18n-guard.node.test.ts 同一套字符类：切英文截图时，
    // 一个「、」或「（」和汉字一样扎眼
    const cjk = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/
    const chinese = Object.entries(en)
      .filter(([, value]) => cjk.test(value))
      .map(([key]) => key)

    expect(chinese).toEqual([])
  })
})
