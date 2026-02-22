import { create } from 'zustand'
import type { Theme } from '@/types/settings'

interface UIState {
  // ── Theme ──
  theme: Theme
  resolvedTheme: 'dark' | 'light'
  setTheme: (theme: Theme) => void

  // ── Sidebar ──
  sidebarOpen: boolean
  sidebarWidth: number
  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void

  // ── Transfer queue ──
  transferQueueOpen: boolean
  toggleTransferQueue: () => void

  // ── Bottom panel tab ──
  bottomPanelTab: 'transfers' | 'log'
  setBottomPanelTab: (tab: 'transfers' | 'log') => void

  // ── Modals / panels ──
  settingsOpen: boolean
  toggleSettings: () => void
  aboutOpen: boolean
  toggleAbout: () => void

  // ── Host Key Manager ──
  hostKeyManagerOpen: boolean
  toggleHostKeyManager: () => void

  // ── Client Key Manager ──
  clientKeyManagerOpen: boolean
  toggleClientKeyManager: () => void

  // ── Split View ──
  splitViewEnabled: boolean
  splitViewLayout: 'horizontal' | 'vertical'
  splitViewRatio: number
  setSplitView: (enabled: boolean, layout?: 'horizontal' | 'vertical', ratio?: number) => void

  // ── Session Form (triggered from WelcomeScreen) ──
  sessionFormRequested: boolean
  requestSessionForm: () => void
  clearSessionFormRequest: () => void

  // ── Quick Connect focus (triggered from WelcomeScreen) ──
  quickConnectFocusKey: number
  requestQuickConnectFocus: () => void

  // ── Database connect (triggered from WelcomeScreen) ──
  databaseConnectRequested: boolean
  requestDatabaseConnect: () => void
  clearDatabaseConnectRequest: () => void
}

/** Resolve theme value to actual 'dark' | 'light' */
function resolveTheme(theme: Theme): 'dark' | 'light' {
  if (theme === 'system') {
    // Check system preference
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return 'dark'
  }
  return theme
}

/** Apply theme class to document */
function applyTheme(resolved: 'dark' | 'light'): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.remove('dark', 'light')
  root.classList.add(resolved)
}

export const useUIStore = create<UIState>((set) => ({
  // ── Theme ──
  theme: 'dark',
  resolvedTheme: 'dark',
  setTheme: (theme) => {
    const resolved = resolveTheme(theme)
    applyTheme(resolved)
    set({ theme, resolvedTheme: resolved })
  },

  // ── Sidebar ──
  sidebarOpen: true,
  sidebarWidth: 260,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),

  // ── Transfer queue ──
  transferQueueOpen: false,
  toggleTransferQueue: () => set((s) => ({ transferQueueOpen: !s.transferQueueOpen })),

  // ── Bottom panel tab ──
  bottomPanelTab: 'transfers',
  setBottomPanelTab: (tab) => set({ bottomPanelTab: tab }),

  // ── Modals ──
  settingsOpen: false,
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
  aboutOpen: false,
  toggleAbout: () => set((s) => ({ aboutOpen: !s.aboutOpen })),

  // ── Host Key Manager ──
  hostKeyManagerOpen: false,
  toggleHostKeyManager: () => set((s) => ({ hostKeyManagerOpen: !s.hostKeyManagerOpen })),

  // ── Client Key Manager ──
  clientKeyManagerOpen: false,
  toggleClientKeyManager: () => set((s) => ({ clientKeyManagerOpen: !s.clientKeyManagerOpen })),

  // ── Split View ──
  splitViewEnabled: false,
  splitViewLayout: 'horizontal',
  splitViewRatio: 0.5,
  setSplitView: (enabled, layout, ratio) =>
    set((s) => ({
      splitViewEnabled: enabled,
      splitViewLayout: layout ?? s.splitViewLayout,
      splitViewRatio: ratio ?? s.splitViewRatio
    })),

  // ── Session Form (triggered from WelcomeScreen) ──
  sessionFormRequested: false,
  requestSessionForm: () => set({ sessionFormRequested: true }),
  clearSessionFormRequest: () => set({ sessionFormRequested: false }),

  // ── Quick Connect focus ──
  quickConnectFocusKey: 0,
  requestQuickConnectFocus: () => set((s) => ({ quickConnectFocusKey: s.quickConnectFocusKey + 1 })),

  // ── Database connect ──
  databaseConnectRequested: false,
  requestDatabaseConnect: () => set({ databaseConnectRequested: true }),
  clearDatabaseConnectRequest: () => set({ databaseConnectRequested: false }),
}))
