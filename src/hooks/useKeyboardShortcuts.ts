import { useEffect } from 'react'
import { useConnectionStore } from '@/stores/connectionStore'
import { useUIStore } from '@/stores/uiStore'

/**
 * Global keyboard shortcuts for quick-launch actions.
 *
 * Shortcuts:
 *   Ctrl+Shift+T  — New terminal tab on current connection
 *   Ctrl+Shift+F  — Open/switch to SFTP on current connection
 *   Ctrl+Shift+B  — Toggle Terminal + SFTP split view
 *   Ctrl+1        — Focus terminal pane
 *   Ctrl+2        — Focus SFTP pane
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey

      // ── Ctrl+Shift+T: New terminal tab ──
      if (ctrl && e.shiftKey && e.key === 'T') {
        e.preventDefault()
        const activeTabId = useConnectionStore.getState().activeTabId
        if (!activeTabId) return

        const activeTab = useConnectionStore.getState().tabs.find((t) => t.id === activeTabId)
        if (!activeTab || activeTab.status !== 'connected') return

        // Switch to terminal sub-tab and emit event for new terminal shell
        useConnectionStore.getState().updateTab(activeTabId, { activeSubTab: 'terminal' })
        window.dispatchEvent(
          new CustomEvent('novadeck:new-terminal', { detail: { connectionId: activeTabId } })
        )
        return
      }

      // ── Ctrl+Shift+F: Open/switch to SFTP ──
      if (ctrl && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        const activeTabId = useConnectionStore.getState().activeTabId
        if (!activeTabId) return

        const activeTab = useConnectionStore.getState().tabs.find((t) => t.id === activeTabId)
        if (!activeTab || activeTab.status !== 'connected') return

        useConnectionStore.getState().updateTab(activeTabId, { activeSubTab: 'sftp' })
        return
      }

      // ── Ctrl+Shift+B: Toggle Terminal + SFTP split view ──
      if (ctrl && e.shiftKey && e.key === 'B') {
        e.preventDefault()
        const { splitViewEnabled, setSplitView } = useUIStore.getState()
        setSplitView(!splitViewEnabled)
        return
      }

      // ── Ctrl+1: Focus terminal pane ──
      if (ctrl && !e.shiftKey && e.key === '1') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('novadeck:focus-pane', { detail: { pane: 'terminal' } }))
        return
      }

      // ── Ctrl+2: Focus SFTP pane ──
      if (ctrl && !e.shiftKey && e.key === '2') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('novadeck:focus-pane', { detail: { pane: 'sftp' } }))
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
