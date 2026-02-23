import { useEffect } from 'react'
import { useConnectionStore } from '@/stores/connectionStore'
import { matchesBinding } from '@/stores/keybindingStore'

/**
 * Global keyboard shortcuts for quick-launch actions.
 * Keybindings are read from the keybinding store (customizable via Settings → Shortcuts).
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // ── New terminal tab ──
      if (matchesBinding(e, 'global:newTerminalTab')) {
        e.preventDefault()
        const activeTabId = useConnectionStore.getState().activeTabId
        if (!activeTabId) return

        const activeTab = useConnectionStore.getState().tabs.find((t) => t.id === activeTabId)
        if (!activeTab || activeTab.status !== 'connected') return

        useConnectionStore.getState().updateTab(activeTabId, { activeSubTab: 'terminal' })
        window.dispatchEvent(
          new CustomEvent('novadeck:new-terminal', { detail: { connectionId: activeTabId } })
        )
        return
      }

      // ── Switch to SFTP ──
      if (matchesBinding(e, 'global:switchToSFTP')) {
        e.preventDefault()
        const activeTabId = useConnectionStore.getState().activeTabId
        if (!activeTabId) return

        const activeTab = useConnectionStore.getState().tabs.find((t) => t.id === activeTabId)
        if (!activeTab || activeTab.status !== 'connected') return

        useConnectionStore.getState().updateTab(activeTabId, { activeSubTab: 'sftp' })
        return
      }

      // ── Switch to SQL ──
      if (matchesBinding(e, 'global:switchToSQL')) {
        e.preventDefault()
        const activeTabId = useConnectionStore.getState().activeTabId
        if (!activeTabId) return

        const activeTab = useConnectionStore.getState().tabs.find((t) => t.id === activeTabId)
        if (!activeTab || activeTab.status !== 'connected') return

        useConnectionStore.getState().updateTab(activeTabId, { activeSubTab: 'sql' })
        return
      }

      // ── Toggle Terminal + SFTP split view ──
      if (matchesBinding(e, 'global:toggleSplitView')) {
        e.preventDefault()
        const activeTabId = useConnectionStore.getState().activeTabId
        if (!activeTabId) return

        const activeTab = useConnectionStore.getState().tabs.find((t) => t.id === activeTabId)
        if (!activeTab || activeTab.status !== 'connected') return

        const newSplitView = !activeTab.splitView
        useConnectionStore.getState().updateTab(activeTabId, { splitView: newSplitView })

        if (newSplitView && activeTab.activeSubTab !== 'terminal' && activeTab.activeSubTab !== 'sftp') {
          useConnectionStore.getState().updateTab(activeTabId, { activeSubTab: 'terminal' })
        }
        return
      }

      // ── Focus terminal pane ──
      if (matchesBinding(e, 'global:focusTerminal')) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('novadeck:focus-pane', { detail: { pane: 'terminal' } }))
        return
      }

      // ── Focus SFTP pane ──
      if (matchesBinding(e, 'global:focusSFTP')) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('novadeck:focus-pane', { detail: { pane: 'sftp' } }))
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
