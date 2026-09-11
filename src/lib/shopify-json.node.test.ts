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
        'meta title': 'MT',
        'meta description': 'MD',
        summary: 'S',
        html代码: `<article><h2>a</h2><h2>b</h2><h2>c</h2><h2>d</h2></article>`,
      },
    ])

    const [candidate] = parseJsonContent(text, 'a.json', 'tech-ai-hub').candidates

    expect(candidate.channelId).toBe('tech-ai-hub')
    // 注意：店铺里的标题就是大写 HUB（已与真实店铺核对）
    expect(candidate.blogName).toBe('Tech & AI HUB')
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
    // 6 个字段全部必填（脚本如此），这里只确认核心三条都在
    expect(messages).toContain('缺少文章标题')
    expect(messages).toContain('缺少文章 handle（url）')
    expect(messages).toContain('缺少正文 HTML')
    expect(messages.length).toBeGreaterThanOrEqual(3)
  })

  it('数组里单条异常不影响其他条目', () => {
    const text = JSON.stringify([
      {
        'blog title': 'Good',
        url: 'good',
        'meta title': 'MT',
        'meta description': 'MD',
        summary: 'S',
        html代码: HTML_WITH_4_H2,
      },
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
      html: '<div><h2>hi</h2></div>',
      'meta title': 'MT',
      'meta description': 'MD',
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
      candidate.issues.some((issue) => issue.message.includes('已按裸 handle 推断'))
    ).toBe(true)
  })

  it('非 /pages/ 的带斜杠路径只补前导斜杠并提示', () => {
    const text = JSON.stringify({
      title: 'X',
      url: 'products/my-page',
      template: 'user-story',
      'meta title': 'MT',
      'meta description': 'MD',
      html: '<div><h2>h</h2></div>',
    })

    const [candidate] = parseJsonContent(text, 'f.json').candidates

    // 页面 API 只接受裸 handle，带斜杠的路径会被正则拒绝（脚本行为）
    expect(candidate.publishable).toBe(false)
    expect(
      candidate.issues.some((issue) =>
        issue.message.includes('只能包含小写字母、数字和连字符')
      )
    ).toBe(true)
  })

  it('published=false 与 images 为空给出 warning', () => {
    const text = JSON.stringify({
      title: 'X',
      url: '/pages/x',
      template: 'user-story',
      published: false,
      html: '<div><h2>h</h2></div>',
      'meta title': 'MT',
      'meta description': 'MD',
    })

    const [candidate] = parseJsonContent(text, 'f.json').candidates

    expect(candidate.publishable).toBe(true)
    const warnings = candidate.issues.filter((i) => i.level === 'warning').map((i) => i.field)
    expect(warnings).toContain('published')
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

// ---------------------------------------------------------------------------
// 上传阶段校验：与发布脚本的硬规则对齐
//
// 这些规则原本只在「点发布」时才由后端脚本报错。搬到上传阶段后，
// 用户能在选完文件夹的那一刻就看到问题。
// ---------------------------------------------------------------------------

const PAGE_HTML_OK =
  '<div><h2>Setup</h2><p>x</p><img src="a.png" alt="图示" title="图示"><a href="https://e.com" title="链接">l</a></div>'

const COMMUNITY_SOURCE = {
  title: 'Prowlarr + Radarr on CasaOS',
  url: 'https://community.zimaspace.com/t/prowlarr-radarr-casaos/1234',
  excerpt: 'How I run them.',
  author_name: 'someuser',
  author_avatar_url: 'https://community.zimaspace.com/user_avatar/x/45.png',
  author_profile_url: 'https://community.zimaspace.com/u/someuser',
}

function communityPage(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    title: 'Prowlarr + Radarr on CasaOS',
    'meta title': 'Prowlarr + Radarr on CasaOS',
    td: 'A community guide.',
    url: '/pages/001-prowlarr-radarr-casaos',
    template: 'community_post',
    html: PAGE_HTML_OK,
    community_source: COMMUNITY_SOURCE,
    ...overrides,
  })
}

function errorsOf(candidate: { issues: { level: string; message: string }[] }) {
  return candidate.issues.filter((i) => i.level === 'error').map((i) => i.message)
}
function warningsOf(candidate: { issues: { level: string; message: string }[] }) {
  return candidate.issues.filter((i) => i.level === 'warning').map((i) => i.message)
}

describe('上传阶段校验 —— 博客文章', () => {
  it('meta title / description / summary 都是必填（不再是提示）', () => {
    const raw = JSON.stringify([
      { 'blog title': 'T', url: 'a-b', html代码: HTML_WITH_4_H2 },
    ])
    const [candidate] = parseJsonContent(raw, 'f.json', 'tech-ai-hub').candidates

    expect(candidate.publishable).toBe(false)
    const errors = errorsOf(candidate)
    expect(errors).toContainEqual(expect.stringContaining('meta title'))
    expect(errors).toContainEqual(expect.stringContaining('meta description'))
    expect(errors).toContainEqual(expect.stringContaining('summary'))
  })

  it('meta description 超过 160 字符报错', () => {
    const raw = JSON.stringify([
      {
        'blog title': 'T',
        url: 'a-b',
        'meta title': 'MT',
        'meta description': 'x'.repeat(161),
        summary: 'S',
        html代码: HTML_WITH_4_H2,
      },
    ])
    const [candidate] = parseJsonContent(raw, 'f.json', 'tech-ai-hub').candidates

    expect(candidate.publishable).toBe(false)
    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('超过 160 个字符')
    )
  })

  it('summary 超过 160 字符报错', () => {
    const raw = JSON.stringify([
      {
        'blog title': 'T',
        url: 'a-b',
        'meta title': 'MT',
        'meta description': 'MD',
        summary: 'y'.repeat(161),
        html代码: HTML_WITH_4_H2,
      },
    ])
    const [candidate] = parseJsonContent(raw, 'f.json', 'tech-ai-hub').candidates

    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('summary 超过 160')
    )
  })

  it('恰好 160 字符可以通过', () => {
    const raw = JSON.stringify([
      {
        'blog title': 'T',
        url: 'a-b',
        'meta title': 'MT',
        'meta description': 'x'.repeat(160),
        summary: 'y'.repeat(160),
        html代码: HTML_WITH_4_H2,
      },
    ])
    const [candidate] = parseJsonContent(raw, 'f.json', 'tech-ai-hub').candidates

    expect(errorsOf(candidate)).toEqual([])
  })

  it('handle 含大写或下划线报错（脚本的正则只允许小写与连字符）', () => {
    const raw = JSON.stringify([
      {
        'blog title': 'T',
        url: 'Bad_Handle',
        'meta title': 'MT',
        'meta description': 'MD',
        summary: 'S',
        html代码: HTML_WITH_4_H2,
      },
    ])
    const [candidate] = parseJsonContent(raw, 'f.json', 'tech-ai-hub').candidates

    expect(candidate.publishable).toBe(false)
    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('只能包含小写字母、数字和连字符')
    )
  })
})

describe('上传阶段校验 —— 页面正文规则', () => {
  it('合法社区页面可以通过', () => {
    const [candidate] = parseJsonContent(communityPage(), 'Com/a.json').candidates

    expect(candidate.channelId).toBe('community-post')
    expect(candidate.publishable).toBe(true)
    expect(candidate.issues).toEqual([])
    // 展示用路径带 /pages/，但后端会剥成裸 handle
    expect(candidate.handle).toBe('/pages/001-prowlarr-radarr-casaos')
  })

  it('正文含 <h1> 报错（H1 应由 page.title 输出）', () => {
    const [candidate] = parseJsonContent(
      communityPage({ html: '<div><h1>T</h1><h2>S</h2></div>' }),
      'Com/a.json'
    ).candidates

    expect(errorsOf(candidate)).toContainEqual(expect.stringContaining('<h1>'))
  })

  it('正文没有 <h2> 报错', () => {
    const [candidate] = parseJsonContent(
      communityPage({ html: '<div><p>no heading</p></div>' }),
      'Com/a.json'
    ).candidates

    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('至少包含一个 <h2>')
    )
  })

  it('图片缺 alt / title 报错', () => {
    const [candidate] = parseJsonContent(
      communityPage({ html: '<div><h2>S</h2><img src="a.png"></div>' }),
      'Com/a.json'
    ).candidates

    const errors = errorsOf(candidate)
    expect(errors).toContainEqual(expect.stringContaining('alt'))
    expect(errors).toContainEqual(expect.stringContaining('title'))
  })

  it('链接缺 title 报错', () => {
    const [candidate] = parseJsonContent(
      communityPage({
        html: '<div><h2>S</h2><a href="https://e.com">no title</a></div>',
      }),
      'Com/a.json'
    ).candidates

    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('链接缺少非空 title')
    )
  })

  it('template 与栏目不符报错', () => {
    // 注意：改成已知模板（如 discord-page）会让解析器改判到那个栏目，
    // 所以要用**未登记**的模板名，才会落到栏目兜底并触发不匹配
    const [candidate] = parseJsonContent(
      communityPage({ template: 'some-unknown-template' }),
      'Com/a.json'
    ).candidates

    expect(candidate.publishable).toBe(false)
    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('必须是「community_post」')
    )
  })

  it('meta description 支持脚本里的 td 键名', () => {
    const [candidate] = parseJsonContent(
      communityPage({ td: 'From td field' }),
      'Com/a.json'
    ).candidates

    expect(candidate.metaDescription).toBe('From td field')
  })

  it('缺少 meta title 报错', () => {
    const raw = JSON.parse(communityPage({ 'meta title': '' }))
    const [candidate] = parseJsonContent(JSON.stringify(raw), 'Com/a.json').candidates

    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('meta title')
    )
  })
})

describe('上传阶段校验 —— 来源对象', () => {
  it('缺少 community_source 报错', () => {
    const raw = JSON.parse(communityPage())
    delete raw.community_source
    const [candidate] = parseJsonContent(JSON.stringify(raw), 'Com/a.json').candidates

    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('community_source')
    )
  })

  it('来源缺字段逐条报错', () => {
    const broken = { ...COMMUNITY_SOURCE, excerpt: '' }
    delete (broken as Record<string, unknown>)['author_name']
    const [candidate] = parseJsonContent(
      communityPage({ community_source: broken }),
      'Com/a.json'
    ).candidates

    const errors = errorsOf(candidate)
    expect(errors).toContainEqual(expect.stringContaining('author_name'))
    expect(errors).toContainEqual(expect.stringContaining('excerpt'))
  })

  it('来源 url 必须是社区主题链接', () => {
    const [candidate] = parseJsonContent(
      communityPage({
        community_source: { ...COMMUNITY_SOURCE, url: 'https://example.com/t/x' },
      }),
      'Com/a.json'
    ).candidates

    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('完整来源链接')
    )
  })

  it('author_profile_url 必须是用户主页链接', () => {
    const [candidate] = parseJsonContent(
      communityPage({
        community_source: {
          ...COMMUNITY_SOURCE,
          author_profile_url: 'https://example.com/u/x',
        },
      }),
      'Com/a.json'
    ).candidates

    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('用户主页链接')
    )
  })

  it('规格未核对的栏目（discord）只给提示，不阻断', () => {
    const raw = JSON.stringify({
      title: 'D',
      'meta title': 'D',
      'meta description': 'MD',
      url: '/pages/d',
      template: 'discord-page',
      html: PAGE_HTML_OK,
    })
    const [candidate] = parseJsonContent(raw, 'Discord/a.json').candidates

    expect(candidate.channelId).toBe('discord')
    expect(candidate.publishable).toBe(true)
    expect(warningsOf(candidate)).toContainEqual(
      expect.stringContaining('规格尚未核对')
    )
  })
})
