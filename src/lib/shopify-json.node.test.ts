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
import { CHANNELS } from '@/config/channels'
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
        html代码:
          '<article class="zima-product-comparisons-article"><h2>a</h2></article>',
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

    const [candidate] = parseJsonContent(
      text,
      'a.json',
      'tech-ai-hub'
    ).candidates

    expect(candidate.channelId).toBe('tech-ai-hub')
    // 注意：店铺里的标题就是大写 HUB（已与真实店铺核对）
    expect(candidate.blogName).toBe('Tech & AI HUB')
    // 应给出提示而不是报错：发布仍可继续
    expect(candidate.publishable).toBe(true)
    expect(
      candidate.issues.some((issue) =>
        issue.message.includes('未带 zima-*-article class')
      )
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
    const messages = candidate.issues
      .filter((i) => i.level === 'error')
      .map((i) => i.message)
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
    // 专注验证「模板识别」本身，不断言 publishable
    // （各栏目校验规则不同，那是另外的用例在管）
    const text = JSON.stringify({
      title: 'A vs B',
      url: '/pages/my-vs-page',
      template: 'nas-a-vs-b',
      published: true,
      html: '<div>hi</div>',
      'meta title': 'MT',
      'meta description': 'MD',
    })

    const result = parseJsonContent(text, 'VS/f.json')

    expect(result.detected).toBe('page')
    expect(result.candidates).toHaveLength(1)

    const [candidate] = result.candidates
    expect(candidate.contentType).toBe('page')
    expect(candidate.handle).toBe('/pages/my-vs-page')
    expect(candidate.template).toBe('nas-a-vs-b')
    expect(candidate.channelId).toBe('vs')
  })

  it('裸 handle 会被补全为 /pages/ 路径，且不产生提示', () => {
    // 真实文件普遍用裸 handle（脚本也接受两种写法），所以这里必须是静默的
    const text = JSON.stringify({
      title: 'X',
      url: 'my-page',
      template: 'user-story',
      html: '<div><h2>h</h2></div>',
      'meta title': 'MT',
      'meta description': 'MD',
    })

    const [candidate] = parseJsonContent(text, 'f.json').candidates

    expect(candidate.handle).toBe('/pages/my-page')
    expect(
      candidate.issues.some((issue) => issue.message.includes('裸 handle'))
    ).toBe(false)
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

  it('published=false：社区只提示，VS 是硬错误', () => {
    // 社区脚本对 published 没有强制要求 → 只是提示
    const community = JSON.stringify({
      title: 'Community Story',
      'meta title': 'MT',
      'meta description': 'MD',
      url: '/pages/community-story',
      template: 'community_post',
      published: false,
      html: '<div><h2>h</h2></div>',
      community_source: COMMUNITY_SOURCE,
    })
    const [communityCandidate] = parseJsonContent(
      community,
      'Com/f.json'
    ).candidates

    expect(communityCandidate.publishable).toBe(true)
    expect(warningsOf(communityCandidate)).toContainEqual(
      expect.stringContaining('published=false')
    )

    // VS 的排期接口要求 published 必须为 true → 硬错误
    const vs = JSON.stringify({
      title: 'A vs B',
      'meta title': 'MT',
      'meta description': 'MD',
      url: '/pages/a-vs-b',
      template: 'nas-a-vs-b',
      published: false,
      html: '<div></div>',
    })
    const [vsCandidate] = parseJsonContent(vs, 'VS/f.json').candidates

    expect(vsCandidate.publishable).toBe(false)
    expect(errorsOf(vsCandidate)).toContainEqual(
      expect.stringContaining('published 必须为 true')
    )
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
      checkRelatedProductsPlaceholder(
        '<article>[[related_products_1]]</article>'
      )
    ).toHaveLength(0)
  })

  it('H2 少于 4 个且无占位符 → error（原脚本会直接中断）', () => {
    const issues = checkRelatedProductsPlaceholder(
      '<article><h2>a</h2><h2>b</h2></article>'
    )

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
    const result = resolveBlogName(
      '<article class="zima-support-tips-article"></article>'
    )
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
  '<div><h2>Setup</h2><p>x</p><img src="a.png" alt="图示" title="图示">' +
  // 第三方外链必须带 _blank + noopener + noreferrer + nofollow（平台外链规则）
  '<a href="https://e.com" title="链接" target="_blank" rel="nofollow noopener noreferrer">l</a></div>'

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
  return candidate.issues
    .filter((i) => i.level === 'error')
    .map((i) => i.message)
}
function warningsOf(candidate: {
  issues: { level: string; message: string }[]
}) {
  return candidate.issues
    .filter((i) => i.level === 'warning')
    .map((i) => i.message)
}

describe('上传阶段校验 —— 博客文章', () => {
  it('meta title / description / summary 都是必填（不再是提示）', () => {
    const raw = JSON.stringify([
      { 'blog title': 'T', url: 'a-b', html代码: HTML_WITH_4_H2 },
    ])
    const [candidate] = parseJsonContent(
      raw,
      'f.json',
      'tech-ai-hub'
    ).candidates

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
    const [candidate] = parseJsonContent(
      raw,
      'f.json',
      'tech-ai-hub'
    ).candidates

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
    const [candidate] = parseJsonContent(
      raw,
      'f.json',
      'tech-ai-hub'
    ).candidates

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
    // HTML_WITH_4_H2 带的是 zima-buying-guide-article，要在对应栏目里上传，
    // 否则会命中「这份 JSON 属于别的栏目」的新规则（那是另一条用例的事）
    const [candidate] = parseJsonContent(
      raw,
      'f.json',
      'buying-guide'
    ).candidates

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
    const [candidate] = parseJsonContent(
      raw,
      'f.json',
      'tech-ai-hub'
    ).candidates

    expect(candidate.publishable).toBe(false)
    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('只能包含小写字母、数字和连字符')
    )
  })
})

describe('上传阶段校验 —— 页面正文规则', () => {
  it('合法社区页面可以通过', () => {
    const [candidate] = parseJsonContent(
      communityPage(),
      'Com/a.json'
    ).candidates

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
      expect.stringContaining('至少包含 1 个 <h2>')
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
    const [candidate] = parseJsonContent(
      JSON.stringify(raw),
      'Com/a.json'
    ).candidates

    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('meta title')
    )
  })
})

describe('上传阶段校验 —— 来源对象', () => {
  it('缺少 community_source 报错', () => {
    const raw = JSON.parse(communityPage())
    delete raw.community_source
    const [candidate] = parseJsonContent(
      JSON.stringify(raw),
      'Com/a.json'
    ).candidates

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
        community_source: {
          ...COMMUNITY_SOURCE,
          url: 'https://example.com/t/x',
        },
      }),
      'Com/a.json'
    ).candidates

    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('必须以 https://community.zimaspace.com/t/ 开头')
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
      expect.stringContaining('必须以 https://community.zimaspace.com/u/ 开头')
    )
  })

  it('所有页面栏目都已登记并核对过规格', () => {
    // 新增栏目时这个断言会提醒你：要么补齐规格，要么显式标记 verified: false
    for (const channel of CHANNELS) {
      if (channel.contentType !== 'page') continue
      expect(channel.pageSpec, `${channel.id} 缺少 pageSpec`).toBeDefined()
      expect(channel.pageSpec?.verified, `${channel.id} 规格未核对`).toBe(true)
    }

    // VS 是唯一没有来源 metafield 的栏目
    const vs = CHANNELS.find((channel) => channel.id === 'vs')
    expect(vs?.pageSpec?.sourceKey).toBe('')
    expect(vs?.pageSpec?.template).toBe('nas-a-vs-b')
  })
})

// ---------------------------------------------------------------------------
// Discord 页面：规则比社区严得多（已对照 publish_discord_pages.py）
// ---------------------------------------------------------------------------

const DISCORD_HTML_4H2 =
  '<div><h2>A</h2><p>1</p><h2>B</h2><p>2</p><h2>C</h2><p>3</p><h2>D</h2><p>4</p></div>'

/** Discord 的 meta description 必须落在 120~170 字符 */
const DISCORD_META_DESCRIPTION =
  'ZimaCube 1 runs its drives hot when airflow is restricted. This thread covers bay spacing, fan curves, and front-panel obstructions that keep temperatures safe.'

const DISCORD_SOURCE = {
  title: 'ZimaCube 1 HDD Temperature and Cooling',
  url: 'https://discord.com/channels/123456789/987654321/555555555',
  excerpt: 'A thread about drive temperatures and airflow.',
  starter_name: 'Eric Brown',
  starter_avatar_url: 'https://cdn.discordapp.com/avatars/1/abc.png',
  channel_name: '#zimacube-general',
  invite_url: '',
}

function discordPage(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    title: 'ZimaCube 1 HDD Running Hot',
    meta_title: 'ZimaCube 1 HDD Temperature: Improve Cooling',
    td: DISCORD_META_DESCRIPTION,
    url: '/pages/zimacube-1-hdd-temperature-cooling-airflow',
    template: 'discord-page',
    published: true,
    discord_source: DISCORD_SOURCE,
    html: DISCORD_HTML_4H2,
    ...overrides,
  })
}

describe('上传阶段校验 —— Discord 页面（更严）', () => {
  it('合法 Discord 页面通过，且 channel_name 的 # 被剥掉', () => {
    const [candidate] = parseJsonContent(
      discordPage(),
      'Discord/a.json'
    ).candidates

    expect(candidate.channelId).toBe('discord')
    expect(candidate.publishable).toBe(true)
    expect(candidate.issues).toEqual([])
    // 脚本会把 channel_name 的前导 # 去掉再写入 metafield
    expect((candidate.source as Record<string, unknown>)['channel_name']).toBe(
      'zimacube-general'
    )
  })

  it('H2 少于 4 个报错（社区只要 1 个，Discord 要 4 个）', () => {
    const [candidate] = parseJsonContent(
      discordPage({ html: '<div><h2>A</h2><p>1</p><h2>B</h2><p>2</p></div>' }),
      'Discord/a.json'
    ).candidates

    expect(candidate.publishable).toBe(false)
    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('至少包含 4 个 <h2>')
    )
  })

  it('meta_title 超过 65 字符报错', () => {
    const [candidate] = parseJsonContent(
      discordPage({ meta_title: 'x'.repeat(66) }),
      'Discord/a.json'
    ).candidates

    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('meta title 应在 65')
    )
  })

  it('meta description 不足 120 字符报错', () => {
    const [candidate] = parseJsonContent(
      discordPage({ td: 'too short' }),
      'Discord/a.json'
    ).candidates

    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('120~170')
    )
  })

  it('url 必须是 Discord 消息链接', () => {
    const [candidate] = parseJsonContent(
      discordPage({
        discord_source: {
          ...DISCORD_SOURCE,
          url: 'https://discord.com/channels/1/2',
        },
      }),
      'Discord/a.json'
    ).candidates

    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('格式不正确')
    )
  })

  it('invite_url 允许为空，但非空时必须完整链接', () => {
    const empty = parseJsonContent(discordPage(), 'Discord/a.json')
      .candidates[0]
    expect(empty.publishable).toBe(true)

    const [broken] = parseJsonContent(
      discordPage({
        discord_source: { ...DISCORD_SOURCE, invite_url: 'not-a-url' },
      }),
      'Discord/a.json'
    ).candidates

    expect(errorsOf(broken)).toContainEqual(
      expect.stringContaining('必须是完整的 http(s) 链接')
    )
  })

  it('来源缺 starter_name 报错（Discord 用 starter_* 而不是 author_*）', () => {
    const broken = { ...DISCORD_SOURCE } as Record<string, unknown>
    delete broken['starter_name']

    const [candidate] = parseJsonContent(
      discordPage({ discord_source: broken }),
      'Discord/a.json'
    ).candidates

    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('starter_name')
    )
  })
})

// ---------------------------------------------------------------------------
// 用户故事：来源叫 user_info，且正文必须包含两句固定文案
// ---------------------------------------------------------------------------

const USER_INFO = {
  name: 'ExampleBuilder',
  handle: 'example-builder',
  avatar_url: 'https://community.zimaspace.com/user_avatar/x/45.png',
  profile_url: 'https://community.zimaspace.com/u/example-builder',
}

const USER_HTML = [
  '<div>',
  '<h2>A Note from Zima</h2><p>We asked how it came together.</p>',
  '<h2>Starting small</h2><p>One bay at first.</p>',
  '<h2>Scaling up</h2><p>Then it grew.</p>',
  '<h2>The Story Is Still Being Written</h2><p>More to come.</p>',
  '</div>',
].join('')

function userStory(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    title: 'How ExampleBuilder Built a 350 TB Array',
    meta_title: 'User Story: A 350 TB Array',
    td: 'A user story about scaling a ZimaBoard 2 build.',
    url: '/pages/001-example-builder-zimaboard2-350tb',
    template: 'user-story',
    html: USER_HTML,
    user_info: USER_INFO,
    ...overrides,
  })
}

describe('上传阶段校验 —— 用户故事', () => {
  it('合法用户故事通过', () => {
    const [candidate] = parseJsonContent(userStory(), 'User/a.json').candidates

    expect(candidate.channelId).toBe('user-story')
    expect(candidate.publishable).toBe(true)
    expect(candidate.issues).toEqual([])
  })

  it('正文缺少「A Note from Zima」报错', () => {
    const [candidate] = parseJsonContent(
      userStory({ html: USER_HTML.replace('A Note from Zima', 'A note') }),
      'User/a.json'
    ).candidates

    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('A Note from Zima')
    )
  })

  it('正文缺少收尾文案报错', () => {
    const [candidate] = parseJsonContent(
      userStory({
        html: USER_HTML.replace('The Story Is Still Being Written', 'Soon'),
      }),
      'User/a.json'
    ).candidates

    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('The Story Is Still Being Written')
    )
  })

  it('缺少 user_info 报错（不是 user_source）', () => {
    const raw = JSON.parse(userStory())
    delete raw.user_info
    const [candidate] = parseJsonContent(
      JSON.stringify(raw),
      'User/a.json'
    ).candidates

    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('user_info')
    )
  })

  it('user_info 缺 profile_url 报错', () => {
    const broken = { ...USER_INFO } as Record<string, unknown>
    delete broken['profile_url']

    const [candidate] = parseJsonContent(
      userStory({ user_info: broken }),
      'User/a.json'
    ).candidates

    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('profile_url')
    )
  })

  it('H2 少于 4 个报错', () => {
    const [candidate] = parseJsonContent(
      userStory({ html: '<div><h2>A Note from Zima</h2></div>' }),
      'User/a.json'
    ).candidates

    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('至少包含 4 个 <h2>')
    )
  })

  it('backlink 会被解析并带出去', () => {
    const [candidate] = parseJsonContent(
      userStory({
        backlink: {
          enabled: true,
          article_url:
            'https://shop.zimaspace.com/blogs/tech-ai-hub/user-builds-so-far',
          lead_in: 'Read the full build story:',
          anchor_text: 'a 350 TB array',
        },
      }),
      'User/a.json'
    ).candidates

    expect(candidate.backlink).toBeDefined()
    expect(candidate.backlink?.['article_url']).toContain('/blogs/tech-ai-hub/')
  })
})

// ---------------------------------------------------------------------------
// VS 对比页：唯一禁 H1/H2、唯一没有来源 metafield、要求 8 对标记
// ---------------------------------------------------------------------------

const VS_MARKERS = [
  'OVERVIEW',
  'SPECS',
  'CATEGORIES',
  'RECOMMENDATION',
  'SKU-FAMILY',
  'RESOURCES',
  'FAQ',
  'METHODOLOGY',
]

const VS_META_DESCRIPTION =
  'Compare ZimaBoard 2 and ZimaBlade for a small home server: expansion, storage options, noise, and which board fits a beginner build.'

function vsHtml(): string {
  const blocks = VS_MARKERS.map((name) =>
    name === 'RESOURCES'
      ? '<!-- COMPARE:RESOURCES -->\n<!-- /COMPARE:RESOURCES -->'
      : `<!-- COMPARE:${name} -->\n<p>Compare content.</p>\n<!-- /COMPARE:${name} -->`
  )
  return [
    '<div class="zima-compare" data-zima-compare-meta="1">',
    ...blocks,
    '<p><a href="/collections/all" title="Browse all Zima hardware">browse all Zima hardware</a></p>',
    '</div>',
  ].join('\n')
}

function vsPage(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    title: 'ZimaBoard 2 vs ZimaBlade for a Compact Home Server',
    meta_title: 'ZimaBoard 2 vs ZimaBlade: Compact Server Pick',
    td: VS_META_DESCRIPTION,
    url: 'zimaboard-2-vs-zimablade',
    template: 'nas-a-vs-b',
    published: true,
    related_products: [],
    html: vsHtml(),
    ...overrides,
  })
}

describe('上传阶段校验 —— VS 对比页', () => {
  it('合法 VS 页面通过（裸 handle 会有推断提示）', () => {
    const [candidate] = parseJsonContent(vsPage(), 'VS/a.json').candidates

    expect(candidate.channelId).toBe('vs')
    expect(candidate.publishable).toBe(true)
    expect(errorsOf(candidate)).toEqual([])
  })

  it('禁止 <h2>（H2 由 Liquid 模板输出）', () => {
    const [candidate] = parseJsonContent(
      vsPage({
        html: vsHtml().replace('<p>Compare content.</p>', '<h2>T</h2>'),
      }),
      'VS/a.json'
    ).candidates

    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('H2 标题必须由 VS Liquid 模板输出')
    )
  })

  it('必须是 nas-a-vs-b 模板', () => {
    // 未登记的模板名会让解析器回落到「当前栏目」，所以这里要传 VS 作为兜底栏目，
    // 才能复现「在 VS 栏目页上传了一个模板写错的 JSON」这个真实场景
    const [candidate] = parseJsonContent(
      vsPage({ template: 'some-other-template' }),
      'VS/a.json',
      'vs'
    ).candidates

    expect(candidate.channelId).toBe('vs')
    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('必须是「nas-a-vs-b」')
    )
  })

  it('缺少 COMPARE 标记对报错', () => {
    const [candidate] = parseJsonContent(
      vsPage({ html: vsHtml().replace('<!-- COMPARE:FAQ -->', '') }),
      'VS/a.json'
    ).candidates

    expect(errorsOf(candidate)).toContainEqual(expect.stringContaining('FAQ'))
  })

  it('标记对重复报错', () => {
    const [candidate] = parseJsonContent(
      vsPage({ html: `${vsHtml()}\n<!-- COMPARE:SPECS -->` }),
      'VS/a.json'
    ).candidates

    expect(errorsOf(candidate)).toContainEqual(expect.stringContaining('SPECS'))
  })

  it('未替换的占位串报错', () => {
    const [candidate] = parseJsonContent(
      vsPage({
        html: vsHtml().replace(
          '<p>Compare content.</p>',
          '<p>YOUTUBE_URL_1</p>'
        ),
      }),
      'VS/a.json'
    ).candidates

    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('占位串')
    )
  })

  it('published 必须为 true', () => {
    const [candidate] = parseJsonContent(
      vsPage({ published: false }),
      'VS/a.json'
    ).candidates

    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('published 必须为 true')
    )
  })

  it('related_products 必须为空数组', () => {
    const [candidate] = parseJsonContent(
      vsPage({ related_products: ['gid://shopify/Product/1'] }),
      'VS/a.json'
    ).candidates

    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('related_products 必须为空数组')
    )
  })

  it('meta 长度受限（≤65 / 120~170）', () => {
    const [longTitle] = parseJsonContent(
      vsPage({ meta_title: 'x'.repeat(66) }),
      'VS/a.json'
    ).candidates
    expect(errorsOf(longTitle)).toContainEqual(
      expect.stringContaining('meta title 应在 65')
    )

    const [shortTd] = parseJsonContent(
      vsPage({ td: 'too short' }),
      'VS/a.json'
    ).candidates
    expect(errorsOf(shortTd)).toContainEqual(expect.stringContaining('120~170'))
  })

  it('VS 没有来源 metafield，不会误报缺少来源', () => {
    const [candidate] = parseJsonContent(vsPage(), 'VS/a.json').candidates
    const messages = candidate.issues.map((issue) => issue.message)

    expect(messages.some((message) => message.includes('来源'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 外链规则（所有栏目共用；后端 html_audit.py 是同一套逻辑）
// ---------------------------------------------------------------------------

describe('上传阶段校验 —— 外链规则', () => {
  function blogWithLink(anchor: string): string {
    return JSON.stringify([
      {
        'blog title': 'T',
        url: 'a-b',
        'meta title': 'MT',
        'meta description': 'MD',
        summary: 'S',
        html代码: `<article><h2>a</h2><h2>b</h2><h2>c</h2><h2>d</h2><p>${anchor}</p></article>`,
      },
    ])
  }

  const SAFE = 'target="_blank" rel="nofollow noopener noreferrer"'

  it('相对路径与站内链接只要求 title', () => {
    const raw = blogWithLink(
      '<a href="/pages/x" title="Some page">some page</a>'
    )
    const [candidate] = parseJsonContent(
      raw,
      'f.json',
      'buying-guide'
    ).candidates
    expect(errorsOf(candidate)).toEqual([])
  })

  it('自家域名（www.zimaspace.com）按站内处理，不强制 _blank', () => {
    const raw = blogWithLink(
      '<a href="https://www.zimaspace.com/docs/x" title="Docs page">docs page</a>'
    )
    const [candidate] = parseJsonContent(
      raw,
      'f.json',
      'buying-guide'
    ).candidates
    expect(errorsOf(candidate)).toEqual([])
  })

  it('合规第三方外链通过', () => {
    const raw = blogWithLink(
      `<a href="https://hub.docker.com/_/mysql" title="Docker image page" ${SAFE}>docker image</a>`
    )
    const [candidate] = parseJsonContent(
      raw,
      'f.json',
      'buying-guide'
    ).candidates
    expect(errorsOf(candidate)).toEqual([])
  })

  it('第三方外链缺 target / rel / nofollow 都被拦下', () => {
    const raw = blogWithLink(
      '<a href="https://example.com/x" title="Example page">example page</a>'
    )
    const [candidate] = parseJsonContent(
      raw,
      'f.json',
      'buying-guide'
    ).candidates
    const errors = errorsOf(candidate)

    expect(errors).toContainEqual(expect.stringContaining('target="_blank"'))
    expect(errors).toContainEqual(expect.stringContaining('noopener'))
    expect(errors).toContainEqual(expect.stringContaining('nofollow'))
  })

  it('缺 title 被拦下', () => {
    const raw = blogWithLink(
      `<a href="https://example.com/x" ${SAFE}>example page</a>`
    )
    const [candidate] = parseJsonContent(
      raw,
      'f.json',
      'buying-guide'
    ).candidates

    expect(errorsOf(candidate)).toContainEqual(expect.stringContaining('title'))
  })

  it('页面栏目（社区）同样适用', () => {
    const raw = JSON.stringify({
      title: 'C',
      'meta title': 'MT',
      'meta description': 'MD',
      url: '/pages/c',
      template: 'community_post',
      html: '<div><h2>h</h2><a href="https://example.com/x" title="t">link text</a></div>',
      community_source: COMMUNITY_SOURCE,
    })
    const [candidate] = parseJsonContent(raw, 'Com/f.json').candidates

    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('target="_blank"')
    )
  })
})

// ---------------------------------------------------------------------------
// Custom 文章：模板由 JSON 自由指定，来源对象可选
// ---------------------------------------------------------------------------

function customPage(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    title: 'Custom Articles Example Page',
    meta_title: 'Custom Articles Example Page',
    td: 'A custom page published with a freely chosen Liquid template for the Custom channel.',
    url: '/pages/custom-articles-example',
    template: 'custom-articles-template-v1',
    html: '<div><h2>Any template</h2><p>Body.</p></div>',
    ...overrides,
  })
}

describe('上传阶段校验 —— Custom 文章（模板自由）', () => {
  it('接受任意模板名', () => {
    const [candidate] = parseJsonContent(
      customPage({ template: 'brand-new-template-v9' }),
      'Custom/a.json'
    ).candidates

    expect(candidate.channelId).toBe('custom')
    expect(candidate.template).toBe('brand-new-template-v9')
    expect(errorsOf(candidate)).toEqual([])
  })

  it('不要求 H2（模板任意的栏目不能套用栏目的 H2 规则）', () => {
    const [candidate] = parseJsonContent(
      customPage({ html: '<div><p>No headings at all.</p></div>' }),
      'Custom/a.json'
    ).candidates

    expect(candidate.publishable).toBe(true)
    expect(errorsOf(candidate)).toEqual([])
  })

  it('必须提供 template', () => {
    const [candidate] = parseJsonContent(
      customPage({ template: '' }),
      'Custom/a.json'
    ).candidates

    expect(errorsOf(candidate)).toContainEqual(
      expect.stringContaining('模板由 JSON 指定')
    )
  })

  it('自动识别 *_source 作为来源 metafield 键', () => {
    const [candidate] = parseJsonContent(
      customPage({ my_thing_source: { a: 1 } }),
      'Custom/a.json'
    ).candidates

    expect(candidate.sourceKey).toBe('my_thing_source')
    expect(candidate.source).toEqual({ a: 1 })
    expect(errorsOf(candidate)).toEqual([])
  })

  it('来源是可选的：没有也不报错、不提示', () => {
    const [candidate] = parseJsonContent(
      customPage(),
      'Custom/a.json'
    ).candidates

    expect(candidate.sourceKey).toBe('')
    expect(candidate.issues).toEqual([])
  })

  it('通用规则仍然生效：禁 h1、外链安全标记', () => {
    const [candidate] = parseJsonContent(
      customPage({
        html: '<div><h1>Bad</h1><a href="https://example.com/x" title="t">link text</a></div>',
      }),
      'Custom/a.json'
    ).candidates

    const errors = errorsOf(candidate)
    expect(errors).toContainEqual(expect.stringContaining('<h1>'))
    expect(errors).toContainEqual(expect.stringContaining('target="_blank"'))
  })

  it('Custom 页上传固定栏目的模板 → 留在 Custom，不报错也不抢走', () => {
    // Custom 栏目存在的意义就是「模板由 JSON 自由指定」，所以别的栏目的模板
    // 在这里是有意为之，不算进错栏目；也不该自动换到 community-post
    // （那样用户选 Custom 就没意义了）。后端 allow_any_template 分支同样不检查。
    const raw = JSON.stringify({
      title: 'C',
      'meta title': 'MT',
      'meta description': 'MD',
      url: '/pages/c',
      template: 'community_post',
      html: '<div><h2>h</h2></div>',
      community_source: COMMUNITY_SOURCE,
    })
    const [candidate] = parseJsonContent(
      raw,
      'Custom/f.json',
      'custom'
    ).candidates

    expect(candidate.channelId).toBe('custom')
    expect(errorsOf(candidate)).toEqual([])
  })
})

describe('上传栏目与 JSON 归属不一致 → 直接报错', () => {
  /** 一份合法的社区文章 JSON（在 community-post 栏目里能通过全部校验） */
  function communityPageRaw() {
    return JSON.stringify({
      title: 'C',
      'meta title': 'MT',
      'meta description': 'MD',
      url: '/pages/c',
      template: 'community_post',
      html: '<div><h2>h</h2></div>',
      community_source: COMMUNITY_SOURCE,
    })
  }

  it('页面：社区文章的 JSON 在 Discord 栏目页上传', () => {
    const [candidate] = parseJsonContent(
      communityPageRaw(),
      'f.json',
      'discord'
    ).candidates

    // 留在上传的栏目里，错误出现在用户操作的那一页
    expect(candidate.channelId).toBe('discord')

    // 校验用的是**当前栏目**的规格，所以除了归属错误还会有规格错误；
    // 这里只要求归属那一条在里面
    const message = errorsOf(candidate).join('；')
    expect(message).toContain('社区文章')
    expect(message).toContain('Discord 文章')
  })

  it('页面：同一份 JSON 在对应栏目上传不报归属错误', () => {
    const [candidate] = parseJsonContent(
      communityPageRaw(),
      'f.json',
      'community-post'
    ).candidates

    expect(candidate.channelId).toBe('community-post')
    expect(errorsOf(candidate)).toEqual([])
  })

  it('文章：Buying Guide 的 class 在 Tech & AI Hub 页上传', () => {
    const raw = JSON.stringify([
      {
        'blog title': 'T',
        url: 'a-b',
        'meta title': 'MT',
        'meta description': 'MD',
        summary: 'S',
        html代码: HTML_WITH_4_H2, // zima-buying-guide-article
      },
    ])
    const [candidate] = parseJsonContent(
      raw,
      'f.json',
      'tech-ai-hub'
    ).candidates

    expect(candidate.channelId).toBe('tech-ai-hub')
    expect(errorsOf(candidate).join('；')).toContain('Buying Guides')
  })

  it('归属一致不报错', () => {
    const raw = JSON.stringify([
      {
        'blog title': 'T',
        url: 'a-b',
        'meta title': 'MT',
        'meta description': 'MD',
        summary: 'S',
        html代码: HTML_WITH_4_H2,
      },
    ])
    const [candidate] = parseJsonContent(
      raw,
      'f.json',
      'buying-guide'
    ).candidates

    expect(errorsOf(candidate)).toEqual([])
  })

  it('认不出归属不报错（那是"不认识"，不是"属于别处"）', () => {
    const raw = JSON.stringify([
      {
        'blog title': 'T',
        url: 'a-b',
        'meta title': 'MT',
        'meta description': 'MD',
        summary: 'S',
        html代码: '<article><h2>A</h2><h2>B</h2><h2>C</h2><h2>D</h2></article>',
      },
    ])
    const [candidate] = parseJsonContent(
      raw,
      'f.json',
      'tech-ai-hub'
    ).candidates

    expect(errorsOf(candidate)).toEqual([])
  })

  it('没指定当前栏目（无 fallback）时不做判断', () => {
    const [candidate] = parseJsonContent(
      communityPageRaw(),
      'f.json',
      undefined
    ).candidates

    // 没有"当前栏目"就无从比较，沿用自动识别
    expect(candidate.channelId).toBe('community-post')
    expect(errorsOf(candidate)).toEqual([])
  })
})
