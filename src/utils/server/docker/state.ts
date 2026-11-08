import { ACCESS_PRELUDE, MISSING_MARKER, lines } from './shell'
import type { DockerAccess, DockerState } from './types'

export const STATE_SCRIPT = [
  `command -v docker >/dev/null 2>&1 || { echo ${MISSING_MARKER}; exit 0; }`,
  ACCESS_PRELUDE,
  'echo "access=$A"',
  'if [ "$A" = root ] || sudo -n true 2>/dev/null; then echo sudo=yes; else echo sudo=no; fi',
  'echo "active=$(systemctl is-active docker 2>/dev/null)"',
  'echo "client=$(docker version --format "{{.Client.Version}}" 2>/dev/null)"',
  '[ "$A" = none ] && exit 0',
  'echo "server=$($D version --format "{{.Server.Version}}" 2>/dev/null)"',
  'echo "compose=$($D compose version --short 2>/dev/null)"',
  ''
].join('\n')

const ACCESS_VALUES: readonly DockerAccess[] = ['root', 'group', 'sudo', 'none']

const NOT_INSTALLED: DockerState = {
  installed: false,
  access: 'none',
  sudo: false,
  clientVersion: null,
  serverVersion: null,
  composeVersion: null,
  serviceActive: false
}

function keyValues(stdout: string): Record<string, string> {
  return Object.fromEntries(lines(stdout).flatMap((line) => {
    const index = line.indexOf('=')
    return index > 0 ? [[line.slice(0, index), line.slice(index + 1).trim()]] : []
  }))
}

const orNull = (value: string | undefined): string | null => (value ? value : null)

export function parseDockerState(stdout: string): DockerState {
  if (lines(stdout).includes(MISSING_MARKER)) return NOT_INSTALLED
  const values = keyValues(stdout)
  const access = ACCESS_VALUES.find((candidate) => candidate === values.access) ?? 'none'
  return {
    installed: true,
    access,
    sudo: values.sudo === 'yes',
    clientVersion: orNull(values.client),
    serverVersion: orNull(values.server),
    composeVersion: orNull(values.compose?.replace(/^v/, '')),
    serviceActive: values.active === 'active'
  }
}

export const isDaemonReachable = (state: DockerState): boolean => state.installed && state.access !== 'none' && state.serverVersion !== null

export const majorVersion = (version: string | null): number => Number(/^(\d+)/.exec(version ?? '')?.[1] ?? 0)
