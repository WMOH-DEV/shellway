/// <reference types="vite/client" />

import type { NovadeckAPI } from '../electron/preload'

/** Injected at build time by Vite `define` from package.json version */
declare const __APP_VERSION__: string

declare global {
  interface Window {
    novadeck: NovadeckAPI
  }
}
