import { useEffect, useState } from 'react'
import type { ServerPrefs } from '@/utils/server/settings/prefs'
import { serverApi } from '../../serverApi'

export interface ServerPrefsState {
  prefs: ServerPrefs | null
  error: string | null
}

export function useServerPrefs(sessionId: string): ServerPrefsState {
  const [state, setState] = useState<ServerPrefsState>({ prefs: null, error: null })

  useEffect(() => {
    let current = true
    void serverApi().settings.prefs(sessionId).then((result) => {
      if (current) setState(result.success ? { prefs: result.data, error: null } : { prefs: null, error: result.error })
    })
    return () => {
      current = false
    }
  }, [sessionId])

  return state
}
