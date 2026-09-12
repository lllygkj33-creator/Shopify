/**
 * 界面多语言（i18n）。
 *
 * ## 为什么自己写而不引库
 *
 * 需求只有两条：中英切换、跟着浏览器语言。整个应用要翻译的字符串约两百多个，
 * 引一个 i18n 框架（react-i18next 之类）带来的配置、命名空间、加载器都比翻译本身重。
 * 这里就是一张表 + 一个查表函数。
 *
 * ## 怎么加翻译
 *
 * 在 `src/i18n/locales/` 下按**业务区域**建文件（例如 `dashboard.ts`、`channels.ts`），
 * 每个文件导出 `zh` / `en` 两张表：
 *
 *     export const zh = { 'dashboard.title': '概览' }
 *     export const en = { 'dashboard.title': 'Overview' }
 *
 * 文件会被下面的 `import.meta.glob` 自动收集 —— **不需要改任何共享文件**，
 * 所以多个区域可以并行翻译而不冲突。
 *
 * 键名约定：`<区域>.<语义>`，同一句话在多个地方用就提到 `common.*`。
 *
 * ## 语言从哪来
 *
 * 1. 用户显式选过 → cookie（和主题一样，一年有效）
 * 2. 没选过 → 浏览器语言：`zh*` 用中文，其余用英文
 */

export type Lang = 'zh' | 'en'

export const LANGS: Lang[] = ['zh', 'en']

export const LANG_COOKIE_NAME = 'content-publisher-lang'
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

type Dict = Record<string, string>
type LocaleModule = { zh?: Dict; en?: Dict }

const modules = import.meta.glob<LocaleModule>('./locales/*.ts', { eager: true })

const messages: Record<Lang, Dict> = { zh: {}, en: {} }
for (const [path, mod] of Object.entries(modules)) {
  if (!mod.zh && !mod.en) {
    // 写错了就早点吼出来，别等到界面上出现原始键名
    throw new Error(`${path} 必须导出 zh / en 两张表`)
  }
  Object.assign(messages.zh, mod.zh ?? {})
  Object.assign(messages.en, mod.en ?? {})
}

/** 当前语言。React 组件请用 `useI18n()`，非组件代码（校验器等）用这里的 `t()` */
let current: Lang = 'zh'

export function getLang(): Lang {
  return current
}

/** 由 I18nProvider 调用，保证非组件代码也能拿到当前语言 */
export function setLangGlobal(lang: Lang): void {
  current = lang
}

/**
 * 默认语言：取站点配置的 `ui.defaultLang`，没配就用英文。
 *
 * 为什么默认英文而不是跟浏览器：这个平台面向的是**海外发布**场景，
 * 界面截图、演示、给外部看都以英文为准。用户自己切过语言后 cookie 优先，
 * 所以中文使用者仍然能一键切回中文。
 */
export function defaultLang(): Lang {
  const configured = normalizeLang(configuredDefault)
  if (configured) return configured
  return 'en'
}

let configuredDefault: string | undefined

/** 由 Provider 启动时注入配置里的默认语言（避免 i18n 模块直接依赖站点配置） */
export function setConfiguredDefaultLang(value: string | undefined): void {
  configuredDefault = value
}

export function normalizeLang(value: string | undefined | null): Lang | null {
  return value === 'zh' || value === 'en' ? value : null
}

export function translate(
  lang: Lang,
  key: string,
  params?: Record<string, string | number>
): string {
  const text = messages[lang][key] ?? messages.zh[key]
  if (text === undefined) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn(`[i18n] 缺少翻译键：${key}`)
    }
    return key
  }
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  )
}

/** 非组件代码用（读模块级当前语言）。React 里请用 `useI18n().t` 以便切换后重渲染 */
export function t(
  key: string,
  params?: Record<string, string | number>
): string {
  return translate(current, key, params)
}

/** 已登记的键（测试用：保证 zh/en 两侧都不缺） */
export function allKeys(): string[] {
  return [...new Set([...Object.keys(messages.zh), ...Object.keys(messages.en)])]
}

export function messagesFor(lang: Lang): Dict {
  return messages[lang]
}
