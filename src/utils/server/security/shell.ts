export const shq = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

export const ROOT_PRELUDE = [
  'if [ "$(id -u)" = 0 ]; then R=""; elif sudo -n true 2>/dev/null; then R="sudo -n"; else R=-; fi',
  'asroot() { [ "$R" = - ] && return 99; $R "$@"; }',
  'if [ "$R" = - ]; then echo "@@root"; echo no; else echo "@@root"; echo yes; fi'
].join('\n')

export function sections(stdout: string): Map<string, string[]> {
  const result = new Map<string, string[]>()
  let current: string[] | null = null
  const lines = stdout.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  for (const line of lines) {
    const marker = /^@@([a-z0-9_.-]+)\s*$/.exec(line)
    if (marker) {
      current = []
      result.set(marker[1], current)
    } else if (current) {
      current.push(line.replace(/\r$/, ''))
    }
  }
  return result
}

export const sectionText = (parts: Map<string, string[]>, name: string): string => (parts.get(name) ?? []).join('\n').trim()

export const firstLine = (parts: Map<string, string[]>, name: string): string => (parts.get(name) ?? []).map((line) => line.trim()).find(Boolean) ?? ''

export const hasRoot = (parts: Map<string, string[]>): boolean => firstLine(parts, 'root') === 'yes'

export function keyValues(lines: string[], separator: RegExp = /=/): Map<string, string> {
  const result = new Map<string, string>()
  for (const line of lines) {
    const match = separator.exec(line)
    if (!match || match.index === 0) continue
    result.set(line.slice(0, match.index).trim(), line.slice(match.index + match[0].length).trim())
  }
  return result
}

export function sshClientPart(sshConnection: string, field: 0 | 3): string {
  return sshConnection.trim().split(/\s+/)[field] ?? ''
}

export function fileWithSha(name: string, path: string, root: boolean): string {
  const read = root ? 'asroot cat' : 'cat'
  const sum = root ? 'asroot sha256sum' : 'sha256sum'
  return [
    `echo "@@${name}.sha"`,
    `if [ -e ${shq(path)} ]; then ${sum} ${shq(path)} 2>/dev/null | cut -d' ' -f1; else echo absent; fi`,
    `echo "@@${name}"`,
    `${read} ${shq(path)} 2>/dev/null`,
    'echo'
  ].join('\n')
}

export interface TrackedFile {
  sha256: string | null
  content: string
}

export function trackedFile(parts: Map<string, string[]>, name: string): TrackedFile | null {
  const sha = firstLine(parts, `${name}.sha`)
  if (!sha) return null
  if (sha === 'absent') return { sha256: null, content: '' }
  if (!/^[0-9a-f]{64}$/.test(sha)) return null
  const lines = [...(parts.get(name) ?? [])]
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return { sha256: sha, content: lines.length > 0 ? `${lines.join('\n')}\n` : '' }
}
