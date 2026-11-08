import type { ProbeDefinition } from '@/types/server/core'
import { SUDO_PROBE, type SudoAccess } from '@/types/server/identity'

export const SUDO_SCRIPT = `echo "user=$(id -un)"
if ! command -v sudo >/dev/null 2>&1; then echo sudo=missing; exit 0; fi
if sudo -n true >/dev/null 2>&1 </dev/null; then echo sudo=ok; else echo sudo=password; fi
exit 0
`

export const needsSudoReason = (user: string): string => `Needs passwordless sudo for ${user || 'this user'}`

function keyValues(stdout: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of stdout.split('\n')) {
    const at = line.indexOf('=')
    if (at > 0) values[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return values
}

export function parseSudo(stdout: string): SudoAccess {
  const values = keyValues(stdout)
  if (values.sudo === 'ok') return { available: true, passwordless: true, reason: '' }
  if (values.sudo === 'missing') return { available: false, passwordless: false, reason: 'sudo is not installed on this server' }
  return { available: values.sudo === 'password', passwordless: false, reason: needsSudoReason(values.user ?? '') }
}

export const sudoProbe: ProbeDefinition<SudoAccess> = {
  id: SUDO_PROBE,
  area: 'core',
  root: false,
  timeoutSeconds: 10,
  script: SUDO_SCRIPT,
  parse: parseSudo
}
