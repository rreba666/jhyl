/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  /** 品牌标识（X-App-Key）：今华有礼为 longping。 */
  readonly VITE_APP_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
