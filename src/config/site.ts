import baseConfig from '../../site.config.json'

/**
 * 站点配置（前端侧）—— 与后端 `backend/app/site_config.py` 读同一份文件。
 *
 * ## 为什么要有它
 *
 * 原来代码里写死了真实域名（`shop.zimaspace.com`、`community.zimaspace.com`）、
 * 品牌名、产品名、博客标题、主题模板名。那些是**部署信息**，不是程序逻辑；
 * 写死之后仓库不能给别人用，一推公开仓库就把自己的店铺结构带出去了。
 *
 * ## 两层
 *
 * | 文件 | 是否提交 | 内容 |
 * |---|---|---|
 * | `site.config.json` | ✅ | 通用占位值，克隆下来即可跑演示模式 |
 * | `site.config.local.json` | ❌ gitignore | 真实部署的值，深度覆盖上一层 |
 *
 * 用 `import.meta.glob` 读本地覆盖：这个文件在克隆下来的仓库里**不存在**，
 * 直接 `import` 会构建失败，glob 拿不到就返回空对象。
 */

type Json = Record<string, unknown>

/** 字典逐层合并；其他类型（含数组）整体替换 —— 与后端 `_deep_merge` 一致 */
function deepMerge(base: unknown, override: unknown): unknown {
  if (
    base &&
    override &&
    typeof base === 'object' &&
    typeof override === 'object' &&
    !Array.isArray(base) &&
    !Array.isArray(override)
  ) {
    const merged: Json = { ...(base as Json) }
    for (const [key, value] of Object.entries(override as Json)) {
      merged[key] = deepMerge((base as Json)[key], value)
    }
    return merged
  }
  return override === undefined ? base : override
}

const localModules = import.meta.glob<{ default: Json }>(
  '../../site.config.local.json',
  { eager: true }
)

const localConfig: Json =
  Object.values(localModules)[0]?.default ?? ({} as Json)

const merged = deepMerge(baseConfig as Json, localConfig) as Json

function get(path: string, fallback = ''): string {
  let node: unknown = merged
  for (const part of path.split('.')) {
    if (!node || typeof node !== 'object') return fallback
    node = (node as Json)[part]
  }
  return node === undefined || node === null ? fallback : String(node)
}

function getList(path: string): string[] {
  let node: unknown = merged
  for (const part of path.split('.')) {
    if (!node || typeof node !== 'object') return []
    node = (node as Json)[part]
  }
  return Array.isArray(node) ? node.map((item) => String(item)) : []
}

export const site = {
  brandName: get('brand.name', 'Content Publisher'),
  brandSubtitle: get('brand.subtitle'),
  /** 前台域名（拼已发布内容的 URL 用） */
  storefrontDomain: get('storefront.domain', 'shop.example.com'),
  /** 自家域名后缀：这些域名按站内处理，不强制新标签页 */
  firstPartySuffixes: getList('firstPartySuffixes'),
  defaultAuthor: get('defaults.author'),
  defaultReviewers: getList('defaults.reviewers'),
  relatedProducts: getList('defaults.relatedProducts'),
  channels: (merged.channels ?? []) as ChannelConfig[],
}

/** 站点配置里的栏目条目形状（Stage B 接栏目表时使用） */
type ChannelConfig = {
  id: string
  name: string
  nameZh?: string
  defaultFolder: string
  contentType: 'blog_article' | 'page'
  color: string
  template?: string
  blogName?: string
  blogHandle?: string
  htmlClass?: string
  page?: Record<string, unknown>
}
