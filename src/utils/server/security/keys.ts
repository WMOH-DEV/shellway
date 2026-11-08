import type { ProbeDefinition } from '@/types/server/core'
import { ROOT_PRELUDE } from './shell'

export const KEYS_PROBE = 'security.keys'

export interface AuthorizedKey {
  type: string
  algorithm: string
  bits: number | null
  fingerprint: string
  comment: string
  hasOptions: boolean
  blob: string
  weak: boolean
  weakReason: string
}

export interface KeyOwner {
  user: string
  home: string
  keys: AuthorizedKey[]
}

export interface KeysFacts {
  root: boolean
  loginUser: string
  owners: KeyOwner[]
}

const script = [
  ROOT_PRELUDE,
  'me=$(id -un)',
  'echo "@@me"; echo "$me"',
  'if [ "$R" = - ]; then users="$me:$HOME"; else users=$(getent passwd | awk -F: \'($3==0 || ($3>=1000 && $3<60000)) && $7 !~ /(nologin|false)$/ {print $1":"$6}\'); fi',
  't=$(mktemp 2>/dev/null || echo /tmp/shellway-key.$$)',
  'printf "%s\\n" "$users" | while IFS=: read -r user home; do',
  '  [ -n "$user" ] || continue',
  '  printf "@@user\\t%s\\t%s\\n" "$user" "$home"',
  '  f="$home/.ssh/authorized_keys"',
  '  if [ "$user" = "$me" ]; then content=$(cat "$f" 2>/dev/null); else content=$(asroot cat "$f" 2>/dev/null); fi',
  '  printf "%s\\n" "$content" | while IFS= read -r line; do',
  '    case "$line" in ""|"#"*) continue;; esac',
  '    printf "%s\\n" "$line" > "$t"',
  '    fp=$(ssh-keygen -lf "$t" 2>/dev/null | head -n 1)',
  '    printf "@@key\\t%s\\t%s\\n" "$fp" "$line"',
  '  done',
  'done',
  'rm -f "$t"'
].join('\n')

const KEY_TYPE = /^(ssh-(rsa|dss|ed25519)|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)$/

const ALGORITHM: Record<string, string> = {
  'ssh-rsa': 'RSA',
  'ssh-dss': 'DSA',
  'ssh-ed25519': 'ED25519',
  'sk-ssh-ed25519@openssh.com': 'ED25519-SK',
  'sk-ecdsa-sha2-nistp256@openssh.com': 'ECDSA-SK'
}

const algorithmOf = (type: string): string => ALGORITHM[type] ?? (type.startsWith('ecdsa') ? 'ECDSA' : type)

export function weakness(algorithm: string, bits: number | null): string {
  if (algorithm === 'DSA') return 'DSA keys are no longer safe'
  if (algorithm === 'RSA' && bits !== null && bits < 2048) return `RSA ${bits} is too short`
  return ''
}

export function parseKeyLine(line: string): Pick<AuthorizedKey, 'type' | 'blob' | 'comment' | 'hasOptions'> | null {
  const tokens = line.trim().split(/\s+/)
  const typeAt = tokens.findIndex((token) => KEY_TYPE.test(token))
  if (typeAt < 0 || !tokens[typeAt + 1]) return null
  return { type: tokens[typeAt], blob: tokens[typeAt + 1], comment: tokens.slice(typeAt + 2).join(' '), hasOptions: typeAt > 0 }
}

export function parseFingerprintLine(output: string): { bits: number | null; fingerprint: string } {
  const match = /^(\d+)\s+(SHA256:[A-Za-z0-9+/]+)/.exec(output.trim())
  return match ? { bits: Number(match[1]), fingerprint: match[2] } : { bits: null, fingerprint: '' }
}

function toKey(fingerprintOutput: string, line: string): AuthorizedKey | null {
  const parsed = parseKeyLine(line)
  if (!parsed) return null
  const { bits, fingerprint } = parseFingerprintLine(fingerprintOutput)
  const algorithm = algorithmOf(parsed.type)
  const weakReason = weakness(algorithm, bits)
  return { ...parsed, algorithm, bits, fingerprint, weak: weakReason !== '', weakReason }
}

export function parseKeys(stdout: string): KeysFacts {
  const lines = stdout.split('\n').map((line) => line.replace(/\r$/, ''))
  const owners: KeyOwner[] = []
  const meAt = lines.indexOf('@@me')
  for (const line of lines) {
    const [marker, first = '', ...rest] = line.split('\t')
    if (marker === '@@user') owners.push({ user: first, home: rest[0] ?? '', keys: [] })
    if (marker === '@@key' && owners.length > 0) {
      const key = toKey(first, rest.join('\t'))
      if (key) owners[owners.length - 1].keys.push(key)
    }
  }
  const rootAt = lines.indexOf('@@root')
  return {
    root: rootAt >= 0 && lines[rootAt + 1]?.trim() === 'yes',
    loginUser: meAt >= 0 ? (lines[meAt + 1] ?? '').trim() : '',
    owners
  }
}

export const keysProbe: ProbeDefinition<KeysFacts> = {
  id: KEYS_PROBE,
  area: 'security',
  root: false,
  timeoutSeconds: 20,
  script,
  parse: parseKeys
}
