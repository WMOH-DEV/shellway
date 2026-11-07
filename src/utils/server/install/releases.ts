import type { OsInfo } from '@/types/server/identity'

export type DebianFamily = 'ubuntu' | 'debian'

export interface DebianRelease {
  family: DebianFamily
  versionId: string
  codename: string
  name: string
  php: string
  postgresql: string
  phpRepo: 'ondrej' | 'sury' | null
}

export const DEBIAN_RELEASES: readonly DebianRelease[] = [
  { family: 'ubuntu', versionId: '22.04', codename: 'jammy', name: 'Ubuntu 22.04', php: '8.1', postgresql: '14', phpRepo: 'ondrej' },
  { family: 'ubuntu', versionId: '24.04', codename: 'noble', name: 'Ubuntu 24.04', php: '8.3', postgresql: '16', phpRepo: 'ondrej' },
  { family: 'ubuntu', versionId: '26.04', codename: 'resolute', name: 'Ubuntu 26.04', php: '8.5', postgresql: '18', phpRepo: null },
  { family: 'debian', versionId: '12', codename: 'bookworm', name: 'Debian 12', php: '8.2', postgresql: '15', phpRepo: 'sury' },
  { family: 'debian', versionId: '13', codename: 'trixie', name: 'Debian 13', php: '8.4', postgresql: '17', phpRepo: 'sury' }
]

export const PHP_VERSIONS: readonly string[] = ['8.5', '8.4', '8.3', '8.2']

export const POSTGRES_VERSIONS: readonly string[] = ['18', '17', '16', '15', '14']

export const NODE_MAJORS: readonly string[] = ['26', '24', '22']

export const NODE_DEFAULT = '26'

const PREFERRED_PHP = '8.4'

const SUPPORTED_NAMES = DEBIAN_RELEASES.map((release) => release.name).join(', ')

export const findRelease = (os: OsInfo): DebianRelease | undefined =>
  DEBIAN_RELEASES.find((release) => release.family === os.family && release.versionId === os.versionId)

export function releaseSupport(os: OsInfo): string | null {
  if (os.family === 'rhel') return `${os.prettyName} is not supported yet. Shellway sets up Ubuntu and Debian servers for now.`
  if (findRelease(os)) return null
  return `${os.prettyName || 'This system'} is not supported. Shellway sets up ${SUPPORTED_NAMES}.`
}

export const offeredPhpVersions = (release: DebianRelease): string[] => (release.phpRepo ? [...PHP_VERSIONS] : [release.php])

export const defaultPhpVersion = (release: DebianRelease): string => (PHP_VERSIONS.includes(release.php) ? release.php : PREFERRED_PHP)
