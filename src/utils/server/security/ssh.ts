import type { ProbeDefinition } from '@/types/server/core'
import { ROOT_PRELUDE, firstLine, hasRoot, keyValues, sections, sshClientPart, trackedFile, fileWithSha, type TrackedFile } from './shell'

export const SSH_PROBE = 'security.ssh'
export const SHELLWAY_SSH_DROPIN = '/etc/ssh/sshd_config.d/00-shellway.conf'

export type RootLogin = 'yes' | 'no' | 'prohibit-password' | 'forced-commands-only'

export interface SshEffective {
  ports: number[]
  passwordAuthentication: boolean
  kbdInteractiveAuthentication: boolean
  pubkeyAuthentication: boolean
  permitRootLogin: RootLogin
  authenticationMethods: string
}

export interface SshFacts {
  root: boolean
  effective: SshEffective | null
  socketActivated: boolean
  includesDropIns: boolean
  dropIns: string[]
  shellwayDropIn: TrackedFile | null
  sessionPort: number | null
  clientIp: string
}

const script = [
  ROOT_PRELUDE,
  'SSHD=/usr/sbin/sshd; [ -x "$SSHD" ] || SSHD=sshd',
  'echo "@@effective"; asroot "$SSHD" -T 2>/dev/null | grep -Ei "^(port|passwordauthentication|kbdinteractiveauthentication|challengeresponseauthentication|pubkeyauthentication|permitrootlogin|authenticationmethods) "',
  'echo "@@socket"; systemctl is-active ssh.socket 2>/dev/null',
  'echo "@@include"; grep -Ei "^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config.d/" /etc/ssh/sshd_config 2>/dev/null',
  'echo "@@dropins"; ls -1 /etc/ssh/sshd_config.d/ 2>/dev/null',
  fileWithSha('shellway', SHELLWAY_SSH_DROPIN, false),
  'echo "@@session"; echo "$SSH_CONNECTION"'
].join('\n')

const ROOT_LOGIN_VALUES: readonly RootLogin[] = ['yes', 'no', 'prohibit-password', 'forced-commands-only']

function parseRootLogin(value: string | undefined): RootLogin {
  if (value === 'without-password') return 'prohibit-password'
  return ROOT_LOGIN_VALUES.find((candidate) => candidate === value) ?? 'prohibit-password'
}

export function parseSshEffective(lines: string[]): SshEffective | null {
  const ports = lines.filter((line) => /^port /i.test(line)).map((line) => Number(line.split(/\s+/)[1])).filter((port) => Number.isInteger(port) && port > 0)
  if (ports.length === 0) return null
  const values = keyValues(lines.filter((line) => !/^port /i.test(line)), /\s+/)
  const flag = (name: string) => values.get(name)?.toLowerCase() === 'yes'
  return {
    ports,
    passwordAuthentication: flag('passwordauthentication'),
    kbdInteractiveAuthentication: flag('kbdinteractiveauthentication') || flag('challengeresponseauthentication'),
    pubkeyAuthentication: flag('pubkeyauthentication'),
    permitRootLogin: parseRootLogin(values.get('permitrootlogin')?.toLowerCase()),
    authenticationMethods: values.get('authenticationmethods') ?? 'any'
  }
}

export function parseSsh(stdout: string): SshFacts {
  const parts = sections(stdout)
  const session = firstLine(parts, 'session')
  const port = Number(sshClientPart(session, 3))
  return {
    root: hasRoot(parts),
    effective: parseSshEffective((parts.get('effective') ?? []).map((line) => line.trim()).filter(Boolean)),
    socketActivated: firstLine(parts, 'socket') === 'active',
    includesDropIns: firstLine(parts, 'include') !== '',
    dropIns: (parts.get('dropins') ?? []).map((line) => line.trim()).filter(Boolean),
    shellwayDropIn: trackedFile(parts, 'shellway'),
    sessionPort: Number.isInteger(port) && port > 0 ? port : null,
    clientIp: sshClientPart(session, 0)
  }
}

export const sshProbe: ProbeDefinition<SshFacts> = {
  id: SSH_PROBE,
  area: 'security',
  root: false,
  timeoutSeconds: 15,
  script,
  parse: parseSsh
}
