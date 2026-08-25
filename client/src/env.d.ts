/// <reference types="vite/client" />

/** Disuntikkan Vite lewat `define`; lihat vite.config.ts. */
declare const __SERVER_URL__: string

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
