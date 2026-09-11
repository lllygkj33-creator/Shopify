import baseConfig from '../../site.config.json'
import type { Channel, PageSpec } from './channels'

/**
 * 站点配置（前端侧）—— 与后端 `backend/app/site_config.py` 读同一份文件。
 *
 * ## 为什么要有它
 *
 * 原来代码里写死了真实域名（`shop.example-store.test`、`community.example-store.test`）、
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
/**
 * 与后端 `_deep_merge` 同一套规则：字典逐层合并、数组整体替换，
 * 带 `"$replace": true` 的字典整体替换上一层（避免占位示例与真实值混在一起）。
 */
function deepMerge(base: unknown, override: unknown): unknown {
  if (
    override &&
    typeof override === 'object' &&
    !Array.isArray(override) &&
    (override as Json).$replace === true
  ) {
    const { $replace: _drop, ...rest } = override as Json
    return rest
  }
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

/**
 * 展开字符串里的 `${a.b}`，值取自配置自身。
 *
 * 与后端 `site_config.py` 同一套语义：用来避免同一个域名在配置里写两遍
 * （社区域名既用于 threadPrefix，也用于 userPrefix）。
 */
function expandTokens(node: unknown, root: Json): unknown {
  if (typeof node === 'string') {
    return node.replace(/\$\{([A-Za-z0-9_.]+)\}/g, (_, path: string) => {
      let value: unknown = root
      for (const part of path.split('.')) {
        if (!value || typeof value !== 'object') {
          throw new Error(`site.config.json 里的 \${${path}} 指不到任何值`)
        }
        value = (value as Json)[part]
      }
      return String(value)
    })
  }
  if (Array.isArray(node)) return node.map((item) => expandTokens(item, root))
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node as Json).map(([key, value]) => [
        key,
        expandTokens(value, root),
      ])
    )
  }
  return node
}

const mergedRaw = deepMerge(baseConfig as Json, localConfig) as Json
const merged = expandTokens(mergedRaw, mergedRaw) as Json

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

function toChannel(cfg: ChannelConfig): Channel {
  return {
    id: cfg.id,
    name: cfg.name,
    nameZh: cfg.nameZh,
    defaultFolder: cfg.defaultFolder,
    contentType: cfg.contentType,
    color: cfg.color,
    blogName: cfg.blogName,
    blogHandle: cfg.blogHandle,
    htmlClass: cfg.htmlClass,
    template: cfg.template,
    pageSpec: cfg.page as PageSpec | undefined,
  }
}

/** 显示在菜单里的栏目（配置里的顺序即菜单顺序） */
export const CHANNELS: Channel[] = site.channels
  .filter((cfg) => !cfg.hidden)
  .map(toChannel)

/**
 * 不进菜单、但解析器要认识的栏目。
 *
 * 只用于 getChannel()，不对外导出 —— 需要时从 ALL_CHANNELS 里筛。
 */
const HIDDEN_CHANNELS: Channel[] = site.channels
  .filter((cfg) => cfg.hidden)
  .map(toChannel)

export const ALL_CHANNELS: Channel[] = [...CHANNELS, ...HIDDEN_CHANNELS]

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
  /** 不进菜单，但解析器仍认得（例如已知但未上线的栏目） */
  hidden?: boolean
  page?: Record<string, unknown>
}
