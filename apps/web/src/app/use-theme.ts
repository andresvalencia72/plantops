import { useEffect, useState } from 'react'
import type { ColorTheme } from './types'

const storageKey = 'plantops:theme'

function readInitialTheme(): ColorTheme {
  try {
    return window.localStorage.getItem(storageKey) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<ColorTheme>(readInitialTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.colorScheme = theme
    try {
      window.localStorage.setItem(storageKey, theme)
    } catch {
      // Storage may be disabled. The visual preference still works in memory.
    }
  }, [theme])

  return { theme, setTheme } as const
}
