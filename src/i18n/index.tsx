import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type Lang = 'vi' | 'en'

interface LangValue {
  lang: Lang
  setLang: (l: Lang) => void
  /** Pick the string for the active language: tr('Tiếng Việt', 'English'). */
  tr: (vi: string, en: string) => string
}

const LangContext = createContext<LangValue | null>(null)
const STORAGE_KEY = 'sure2p.lang'

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'vi' || saved === 'en') return saved
  } catch {
    // storage unavailable
  }
  return 'vi'
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)
  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      // ignore
    }
    document.documentElement.lang = l
  }, [])
  const value = useMemo<LangValue>(
    () => ({ lang, setLang, tr: (vi, en) => (lang === 'vi' ? vi : en) }),
    [lang, setLang],
  )
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

export function useLang(): LangValue {
  const v = useContext(LangContext)
  if (!v) throw new Error('useLang must be used inside LangProvider')
  return v
}
