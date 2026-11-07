import { useEffect } from 'react'
import { create } from 'zustand'

interface ClassicTabsState {
  enabled: boolean
  loaded: boolean
}

export const useClassicTabsStore = create<ClassicTabsState>(() => ({ enabled: false, loaded: false }))

let pendingLoad: Promise<boolean> | null = null

async function readSetting(): Promise<boolean> {
  try {
    const settings = await window.novadeck.settings.getAll()
    return settings?.classicServerTabs === true
  } catch {
    return false
  }
}

let following = false

function followSettingChanges(): void {
  if (following) return
  following = true
  window.novadeck.settings.onChanged?.((settings) => {
    if (typeof settings?.classicServerTabs === 'boolean') setClassicTabs(settings.classicServerTabs)
  })
}

export function loadClassicTabs(): Promise<boolean> {
  followSettingChanges()
  pendingLoad ??= readSetting().then((enabled) => {
    if (!useClassicTabsStore.getState().loaded) useClassicTabsStore.setState({ enabled, loaded: true })
    return useClassicTabsStore.getState().enabled
  })
  return pendingLoad
}

export function setClassicTabs(enabled: boolean): void {
  useClassicTabsStore.setState({ enabled, loaded: true })
  pendingLoad = Promise.resolve(enabled)
}

export function useClassicTabs(): ClassicTabsState {
  useEffect(() => { void loadClassicTabs() }, [])
  const enabled = useClassicTabsStore((state) => state.enabled)
  const loaded = useClassicTabsStore((state) => state.loaded)
  return { enabled, loaded }
}
