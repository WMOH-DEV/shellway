import type { DockerAccess } from './types'

export const shellQuote = (value: string): string => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`)

export const ACCESS_PRELUDE = [
  'if [ "$(id -u)" = 0 ]; then A=root; D=docker',
  'elif id -nG | tr " " "\\n" | grep -qx docker; then A=group; D=docker',
  'elif sudo -n true 2>/dev/null; then A=sudo; D="sudo -n docker"',
  'else A=none; D=docker; fi'
].join('\n')

export const MISSING_MARKER = '@@missing'
export const NO_ACCESS_MARKER = '@@noaccess'
export const DOWN_MARKER = '@@down'

export function listProbeScript(body: string): string {
  return [
    `command -v docker >/dev/null 2>&1 || { echo ${MISSING_MARKER}; exit 0; }`,
    ACCESS_PRELUDE,
    `[ "$A" = none ] && { echo ${NO_ACCESS_MARKER}; exit 0; }`,
    body,
    ''
  ].join('\n')
}

export const runsAsRoot = (access: DockerAccess): boolean => access === 'sudo'

export const lines = (stdout: string): string[] => stdout.split('\n').map((line) => line.trim()).filter(Boolean)

export function parseJsonLines(stdout: string): Record<string, unknown>[] {
  return lines(stdout).flatMap((line) => {
    if (!line.startsWith('{')) return []
    try {
      return [JSON.parse(line) as Record<string, unknown>]
    } catch {
      return []
    }
  })
}

export function splitSections(stdout: string): Record<string, string> {
  const sections: Record<string, string[]> = { main: [] }
  let current = 'main'
  for (const line of stdout.split('\n')) {
    const marker = /^@@section (\w+)$/.exec(line.trim())
    if (marker) {
      current = marker[1]
      sections[current] = []
      continue
    }
    sections[current].push(line)
  }
  return Object.fromEntries(Object.entries(sections).map(([key, value]) => [key, value.join('\n')]))
}

export const str = (value: unknown): string => (typeof value === 'string' ? value : '')
