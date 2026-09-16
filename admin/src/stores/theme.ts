import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'system'

const THEME_KEY = 'admin_theme_mode'

/** 管理后台主题模式并同步到根节点。 */
export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>((localStorage.getItem(THEME_KEY) as ThemeMode) || 'light')
  const isDark = ref(false)
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  const resolvedMode = computed(() => mode.value === 'system' ? (mediaQuery.matches ? 'dark' : 'light') : mode.value)

  /** 将主题模式应用到文档根节点。 */
  function applyTheme(): void {
    const dark = resolvedMode.value === 'dark'
    isDark.value = dark
    document.documentElement.dataset.theme = resolvedMode.value
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = resolvedMode.value
    localStorage.setItem(THEME_KEY, mode.value)
  }

  /** 切换浅色和暗色主题。 */
  function toggle(): void {
    mode.value = resolvedMode.value === 'dark' ? 'light' : 'dark'
    applyTheme()
  }

  watch(mode, applyTheme, { immediate: true })
  mediaQuery.addEventListener?.('change', applyTheme)

  return { mode, isDark, resolvedMode, applyTheme, toggle }
})
