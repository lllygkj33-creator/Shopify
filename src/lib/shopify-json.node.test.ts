/**
 * 解析器单元测试
 *
 * 用例刻意复刻 **GEO 真实样本** 的字段名与结构（含带空格/中文的键），
 * 因为最容易出错的地方正是这些：
 *  - 字段名带空格：`blog title` / `meta title` / `html代码`
 *  - tech-ai-hub 的正文是**裸 `<article>`，没有 class**
 *  - buying-guide 的 class 是 `zima-buying-guide-article`
 *  - Product Comparisons 的 class 用复数，文件夹却是单数
 */

import { describe, expect, it } from 'vitest'
import {
  buildPublicUrl,
  checkRelatedProductsPlaceholder,
  normalizeArticleHandle,
  normalizePageHandle,
  parseJsonContent,
  resolveBlogName,
} from '@/lib/shopify-json'

/** 4 个 H2，满足 related_products 占位符注入条件 */
const HTML_WITH_4_H2 = `
<article class="zima-buying-guide-article">
  <h2>A</h2><p>1</p><h2>B</h2><p>2</p><h2>C</h2><p>3</p><h2>D</h2><p>4</p>
</article>`

describe('parseJsonContent —— 博客文章（数组 schema）', () => {
  it('按原样匹配带空格与中文的字段名', () => {
    const text = JSON.stringify([
      {
        'blog title': 'Is One NVMe Slot Enough?',
        url: 'is-one-nvme-slot-enough',
        'meta title': 'Meta 标题',
        'meta description': 'Meta 描述',
        summary: '摘要',
        html代码: HTML_WITH_4_H2,
      },
    ])

    const result = parseJsonContent(text, 'buying-guide/batch.json')

    expect(result.detected).toBe('blog_article')
    expect(result.error).toBeUndefined()
    expect(result.candidates).toHaveLength(1)

    const [candidate] = result.candidates
    expect(candidate.title).toBe('Is One NVMe Slot Enough?')
    expect(candidate.handle).toBe('is-one-nvme-slot-enough')
    expect(candidate.metaTitle).toBe('Meta 标题')
    expect(candidate.metaDescription).toBe('Meta 描述')
    expect(candidate.summary).toBe('摘要')
    expect(candidate.bodyHtml).toContain('zima-buying-guide-article')
    expect(candidate.contentType).toBe('blog_article')
    expect(candidate.publishable).toBe(true)
  })

  it('正文有 class 时按 class 判定博客归属', () => {
    const text = JSON.stringify([
      {
        'blog title': 'X',
        url: 'x',
        html代码: '<article class="zima-product-comparisons-article"><h2>a</h2></article>',
      },
    ])

    const [candidate] = parseJsonContent(text, 'f.json').candidates

    // class 用复数 comparisons，正确映射到 product-comparison 栏目
    expect(candidate.channelId).toBe('product-comparison')
    expect(candidate.blogName).toBe('Product Comparisons')
  })

  it('正文没有 class 时落回当前栏目默认博客（真实样本就是这样）', () => {
    // tech-ai-hub 的真实 JSON 正文就是裸 <article>
    const text = JSON.stringify([
      {
        'blog title': 'Home AI Trust Boundary',
        url: 'home-ai-trust-boundary',
        html代码: `<article><h2>a</h2><h2>b</h2><h2>c</h2><h2>d</h2></article>`,
      },
    ])

    const [candidate] = parseJsonContent(text, 'a.json', 'tech-ai-hub').candidates

    expect(candidate.channelId).toBe('tech-ai-hub')
    expect(candidate.blogName).toBe('Tech & AI Hub')
    // 应给出提示而不是报错：发布仍可继续
    expect(candidate.publishable).toBe(true)
    expect(
      candidate.issues.some((issue) => issue.message.includes('未带 zima-*-article class'))
    ).toBe(true)
  })

  it('带前导斜杠的 url 会被规范化并给出提示', () => {
    const text = JSON.stringify([
      { 'blog title': 'X', url: '/some-handle', html代码: HTML_WITH_4_H2 },
    ])

    const [candidate] = parseJsonContent(text, 'f.json').candidates

    expect(candidate.handle).toBe('some-handle')
    expect(
      candidate.issues.some((issue) => issue.message.includes('已自动规范化'))
    ).toBe(true)
  })

  it('缺标题 / 缺 handle / 缺正文时报 error 且不可发布', () => {
    const text = JSON.stringify([{ 'blog title': '', url: '', html代码: '' }])
    const [candidate] = parseJsonContent(text, 'f.json').candidates

    expect(candidate.publishable).toBe(false)
    const messages = candidate.issues.filter((i) => i.level === 'error').map((i) => i.message)
    expect(messages).toHaveLength(3)
  })

  it('数组里单条异常不影响其他条目', () => {
    const text = JSON.stringify([
      { 'blog title': 'Good', url: 'good', html代码: HTML_WITH_4_H2 },
      { 'blog title': 'Bad', url: 'bad', html代码: '' },
    ])

    const result = parseJsonContent(text, 'f.json')

    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[0].publishable).toBe(true)
    expect(result.candidates[1].publishable).toBe(false)
  })
})

describe('parseJsonContent —— 页面（单对象 schema）', () => {
  it('识别单对象页面并读取 template', () => {
    const text = JSON.stringify({
      title: 'Discord 社区',
      url: '/pages/discord-community',
      template: 'discord-page',
      published: true,
      html: '<div>hi</div>',
      images: ['a.png'],
    })

    const result = parseJsonContent(text, 'Discord/f.json')

    expect(result.detected).toBe('page')
    expect(result.candidates).toHaveLength(1)

    const [candidate] = result.candidates
    expect(candidate.contentType).toBe('page')
    expect(candidate.handle).toBe('/pages/discord-community')
    expect(candidate.template).toBe('discord-page')
    expect(candidate.channelId).toBe('discord')
    expect(candidate.publishable).toBe(true)
  })

  it('裸 handle 会补全为 /pages/ 路径并提示', () => {
    const text = JSON.stringify({
      title: 'X',
      url: 'my-page',
      template: 'user-story',
      html: '<div/>',
      images: ['a.png'],
    })

    const [candidate] = parseJsonContent(text, 'f.json').candidates

    expect(candidate.handle).toBe('/pages/my-page')
    expect(
      candidate.issues.some((issue) => issue.message.includes('已自动补全为「/pages/my-page」'))
    ).toBe(true)
  })

  it('非 /pages/ 的带斜杠路径只补前导斜杠并提示', () => {
    const text = JSON.stringify({
      title: 'X',
      url: 'products/my-page',
      template: 'user-story',
      html: '<div/>',
      images: ['a.png'],
    })

    const [candidate] = parseJsonContent(text, 'f.json').candidates

    // 不擅自改写路径前缀，只补前导斜杠，并提醒确认
    expect(candidate.handle).toBe('/products/my-page')
    expect(
      candidate.issues.some((issue) => issue.message.includes('不在 /pages/ 下'))
    ).toBe(true)
  })

  it('published=false 与 images 为空给出 warning', () => {
    const text = JSON.stringify({
      title: 'X',
      url: '/pages/x',
      template: 'user-story',
      published: false,
      html: '<div/>',
      images: [],
    })

    const [candidate] = parseJsonContent(text, 'f.json').candidates

    expect(candidate.publishable).toBe(true)
    const warnings = candidate.issues.filter((i) => i.level === 'warning').map((i) => i.field)
    expect(warnings).toContain('published')
    expect(warnings).toContain('images')
  })
})

describe('parseJsonContent —— 容错', () => {
  it('JSON 语法错误返回文件级 error 而不抛异常', () => {
    const result = parseJsonContent('{ not json', 'broken.json')

    expect(result.detected).toBe('unknown')
    expect(result.candidates).toHaveLength(0)
    expect(result.error).toContain('JSON 语法错误')
  })

  it('无法识别的结构给出可读提示', () => {
    const result = parseJsonContent('{"foo": 1}', 'x.json')

    expect(result.error).toContain('无法识别的 JSON 结构')
  })

  it('空数组不报错也不产出候选', () => {
    const result = parseJsonContent('[]', 'x.json')

    expect(result.candidates).toHaveLength(0)
  })
})

describe('related_products 占位符规则', () => {
  it('已带占位符时无需注入，不报错', () => {
    expect(
      checkRelatedProductsPlaceholder('<article>[[related_products_1]]</article>')
    ).toHaveLength(0)
  })

  it('H2 少于 4 个且无占位符 → error（原脚本会直接中断）', () => {
    const issues = checkRelatedProductsPlaceholder('<article><h2>a</h2><h2>b</h2></article>')

    expect(issues).toHaveLength(1)
    expect(issues[0].level).toBe('error')
    expect(issues[0].message).toContain('≥ 4 个 H2')
  })

  it('H2 恰好 4 个 → 可自动注入，无 error', () => {
    expect(
      checkRelatedProductsPlaceholder(
        '<article><h2>a</h2><h2>b</h2><h2>c</h2><h2>d</h2></article>'
      )
    ).toHaveLength(0)
  })
})

describe('handle 规范化', () => {
  it('博客 handle 去掉前导斜杠与 /blogs/ 前缀', () => {
    expect(normalizeArticleHandle('/my-post')).toBe('my-post')
    expect(normalizeArticleHandle('blogs/news/my-post')).toBe('my-post')
    expect(normalizeArticleHandle('pages/my-post')).toBe('my-post')
  })

  it('页面路径保证带前导斜杠', () => {
    expect(normalizePageHandle('/pages/x')).toBe('/pages/x')
    expect(normalizePageHandle('pages/x')).toBe('/pages/x')
    expect(normalizePageHandle('x')).toBe('/pages/x')
  })

  it('按类型拼出对外可访问 URL', () => {
    expect(buildPublicUrl('blog_article', 'my-post', 'tech-ai-hub')).toBe(
      '/blogs/tech-ai-hub/my-post'
    )
    expect(buildPublicUrl('page', '/pages/x')).toBe('/pages/x')
  })
})

describe('resolveBlogName', () => {
  it('有 class 时来源标记为 class', () => {
    const result = resolveBlogName('<article class="zima-support-tips-article"></article>')
    expect(result).toEqual({ blogName: 'Support & Tips', source: 'class' })
  })

  it('无 class 且无栏目兜底时来源为 none', () => {
    expect(resolveBlogName('<article></article>').source).toBe('none')
  })
})
