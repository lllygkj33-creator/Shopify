import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { getCookie, setCookie } from '@/lib/cookies'
import { site } from '@/config/site'
import {
  defaultLang,
  setConfiguredDefaultLang,
  LANG_COOKIE_MAX_AGE,
  LANG_COOKIE_NAME,
  normalizeLang,
  setLangGlobal,
  translate,
  type Lang,
} from '@/i18n'

type I18nProviderState = {
  lang: Lang
  setLang: (lang: Lang) => void
  /** 按当前语言取文案；组件用它可以做到"切换语言后立刻重渲染" */
  t: (key: string, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nProviderState | null>(null)

function initialLang(): Lang {
  setConfiguredDefaultLang(site.defaultLang)
  return normalizeLang(getCookie(LANG_COOKIE_NAME)) ?? defaultLang()
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)

  // 非组件代码（校验器、api 层）也要用当前语言 → 同步到模块级
  setLangGlobal(lang)

  useEffect(() => {
    setLangGlobal(lang)
    setCookie(LANG_COOKIE_NAME, lang, LANG_COOKIE_MAX_AGE)
    // 让浏览器/无障碍工具知道文档语言（也影响中日韩字体回退）
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  }, [lang])

  const value = useMemo<I18nProviderState>(
    () => ({
      lang,
      setLang: setLangState,
      t: (key, params) => translate(lang, key, params),
    }),
    [lang]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nProviderState {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n 必须在 I18nProvider 内部使用')
  }
  return context
}
