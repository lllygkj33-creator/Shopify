import { describe, expect, it } from 'vitest'

import { resolveSiteConfig, site } from './site'

/**
 * 站点配置的来源优先级。
 *
 * 关键约定：**后端注入的配置整体采用**，不与构建期配置合并 ——
 * 后端给的就是"基础 + 本地覆盖"的完整结果，合并反而会把通用占位值掺回真实值。
 *
 * 这条约定是"镜像可以公开"的前提：镜像里的前端只有通用占位值，
 * 真实域名/品牌由容器里的后端在响应 index.html 时注入。
 *
 * 注意：这里测的是 `resolveSiteConfig` 这个纯函数，不是模块级常量 ——
 * 浏览器模式下 `vi.resetModules()` 不会让真实 ES 模块重新求值，
 * 靠导入顺序去测会得到"假通过"（后一个用例其实还在用第一个用例注入的值）。
 */
const BASE = {
  brand: { name: 'Content Publisher', subtitle: 'Shopify content hosting' },
  storefront: { domain: 'shop.example-store.test' },
  firstPartySuffixes: ['example-store.test'],
  channels: [
    {
      id: 'base-a',
      name: 'Base A',
      defaultFolder: 'base-a',
      contentType: 'blog_article',
      color: '#000001',
    },
  ],
}

describe('站点配置来源', () => {
  it('有注入时整体采用注入值，不掺入构建期配置', () => {
    const runtime = {
      brand: { name: '注入品牌', subtitle: '注入副标题' },
      storefront: { domain: 'injected.example.test' },
      firstPartySuffixes: ['injected.test'],
      defaults: { author: '注入作者' },
      channels: [
        {
          id: 'injected-a',
          name: 'Injected A',
          nameZh: '注入栏目 A',
          defaultFolder: 'injected-a',
          contentType: 'blog_article',
          color: '#123456',
          blogName: 'Injected Blog',
          htmlClass: 'injected-class',
        },
        {
          id: 'injected-hidden',
          name: 'Injected Hidden',
          defaultFolder: 'injected-hidden',
          contentType: 'page',
          color: '#654321',
          hidden: true,
        },
      ],
    }

    const { site: s, channels, all } = resolveSiteConfig(runtime, BASE, {})

    expect(s.brandName).toBe('注入品牌')
    expect(s.brandSubtitle).toBe('注入副标题')
    expect(s.storefrontDomain).toBe('injected.example.test')
    expect(s.firstPartySuffixes).toEqual(['injected.test'])
    expect(s.defaultAuthor).toBe('注入作者')
    // 只认注入的栏目：BASE 里那个不该出现
    expect(channels.map((c) => c.id)).toEqual(['injected-a'])
    // 隐藏栏目不进菜单，但解析器要认得
    expect(all.map((c) => c.id)).toEqual(['injected-a', 'injected-hidden'])
  })

  it('没有注入时按"基础 + 本地覆盖"合并', () => {
    const local = {
      brand: { name: '本地品牌' },
      channels: [
        {
          id: 'local-a',
          name: 'Local A',
          defaultFolder: 'local-a',
          contentType: 'blog_article',
          color: '#000002',
        },
      ],
    }

    const { site: s } = resolveSiteConfig(undefined, BASE, local)

    expect(s.brandName).toBe('本地品牌')
    // 没被覆盖的项继承基础配置
    expect(s.brandSubtitle).toBe('Shopify content hosting')
    // 数组整体替换（不合并）
    expect(s.channels.map((c) => c.id)).toEqual(['local-a'])
  })

  it('注入值里的 ${a.b} 仍会展开（避免同一域名写两遍）', () => {
    const runtime = {
      community: { threadPrefix: 'community.injected.test/t/' },
      channels: [
        {
          id: 'x',
          name: 'X',
          defaultFolder: 'x',
          contentType: 'page',
          color: '#000000',
          // 真实配置里就是这种写法（见 site.config.json 的 page.source.url）
          page: { source: { url: '${community.threadPrefix}' } },
        },
      ],
    }

    const { site: s } = resolveSiteConfig(runtime, BASE, {})
    const page = s.channels[0].page as { source: { url: string } }

    expect(page.source.url).toBe('community.injected.test/t/')
  })

  it('本地覆盖支持 $replace 整体替换', () => {
    // $replace 的用处：占位值里有一整套示例时，逐键合并会把示例与真实值混在一起。
    // 这里借 brand 验证：整体替换之后，基础配置的 subtitle 不该再被继承。
    const base = { brand: { name: 'Content Publisher', subtitle: '占位副标题' } }
    const local = { brand: { $replace: true, name: '真实品牌' } }

    const { site: s } = resolveSiteConfig(undefined, base, local)

    expect(s.brandName).toBe('真实品牌')
    expect(s.brandSubtitle).toBe('')
  })

  it('模块级常量在无注入时也能用（构建期回落到通用配置）', () => {
    expect(site.brandName.length).toBeGreaterThan(0)
    expect(site.channels.length).toBeGreaterThan(0)
  })
})
