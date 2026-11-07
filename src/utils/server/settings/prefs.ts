export type OsFamilyOverride = 'auto' | 'ubuntu' | 'debian' | 'rhel'

export interface ServerPrefs {
  deployUser: string
  osFamily: OsFamilyOverride
}

export const OS_FAMILY_OVERRIDES: readonly OsFamilyOverride[] = ['auto', 'ubuntu', 'debian', 'rhel']

export const OS_FAMILY_LABEL: Record<OsFamilyOverride, string> = {
  auto: 'Detect',
  ubuntu: 'Ubuntu',
  debian: 'Debian',
  rhel: 'RHEL family'
}

export const DEFAULT_SERVER_PREFS: ServerPrefs = { deployUser: '', osFamily: 'auto' }

const LINUX_USER = /^[a-z_][a-z0-9_-]{0,31}$/

export function deployUserError(user: string): string | null {
  if (user === '' || LINUX_USER.test(user)) return null
  return 'Use a Linux user name: lowercase letters, digits, - and _'
}

export function parseServerPrefs(raw: unknown): ServerPrefs {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid server settings')
  const { deployUser, osFamily } = raw as Record<string, unknown>
  if (typeof deployUser !== 'string' || deployUserError(deployUser)) throw new Error('Invalid deploy user')
  if (!OS_FAMILY_OVERRIDES.includes(osFamily as OsFamilyOverride)) throw new Error('Invalid OS family')
  return { deployUser, osFamily: osFamily as OsFamilyOverride }
}
