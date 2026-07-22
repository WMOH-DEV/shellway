import { vi } from 'vitest'
import type { NovadeckAPI } from '../../electron/preload'

type Overrides = Record<string, unknown>

function isListenerLeaf(path: string): boolean {
  const leaf = path.slice(path.lastIndexOf('.') + 1)
  return /^on[A-Z]/.test(leaf)
}

function createNode(path: string, overrides: Overrides, cache: Map<string, unknown>): unknown {
  const stub = isListenerLeaf(path) ? vi.fn(() => vi.fn()) : vi.fn(async () => undefined)

  return new Proxy(stub, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver)

      const key = path ? `${path}.${prop}` : prop
      if (cache.has(key)) return cache.get(key)

      if (Object.prototype.hasOwnProperty.call(overrides, key)) {
        cache.set(key, overrides[key])
        return overrides[key]
      }

      if (prop in target) return Reflect.get(target, prop, receiver)

      const child = createNode(key, overrides, cache)
      cache.set(key, child)
      return child
    }
  })
}

export function mockNovadeck(overrides: Overrides = {}): NovadeckAPI {
  const api = createNode('', overrides, new Map()) as NovadeckAPI
  window.novadeck = api
  return api
}
