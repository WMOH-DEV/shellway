import { useSessionStore } from '@/stores/sessionStore'
import type { AuthMethod } from '@/types/session'

const KEY_METHODS: readonly AuthMethod[] = ['publickey', 'publickey+passphrase', 'agent']

export function useKeyLogin(sessionId: string): boolean {
  const method = useSessionStore((state) => state.sessions.find((session) => session.id === sessionId)?.auth.initialMethod)
  return method !== undefined && KEY_METHODS.includes(method)
}
