import { useEffect } from 'react'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSQLStore } from '@/stores/sqlStore'
import { heldResources } from '@/utils/windowHandoff'

export function useHeldResources(): void {
  useEffect(() => {
    let lastSent = ''
    const sync = () => {
      const resources = heldResources()
      const key = resources.join('\n')
      if (key === lastSent) return
      lastSent = key
      window.novadeck.window.setHeldResources(resources)
    }

    sync()
    const unsubscribers = [useConnectionStore.subscribe(sync), useSQLStore.subscribe(sync)]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [])
}
