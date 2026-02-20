/// <reference types="vite/client" />

import type { NovadeckAPI } from '../electron/preload'

declare global {
  interface Window {
    novadeck: NovadeckAPI
  }
}
