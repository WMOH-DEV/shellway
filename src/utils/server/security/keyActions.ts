import type { ActionDefinition } from '@/types/server/core'
import { KEYS_PROBE, parseKeyLine, type KeyOwner, type KeysFacts } from './keys'
import { commandStep, factData, needsRoot, precondition, securityPlan, unavailable } from './plan'
import { shq } from './shell'
import { SSH_PROBE, type SshFacts } from './ssh'
import { asRecord, assertUser } from './validate'

const PUBLIC_KEY = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/]+={0,3}( [\x20-\x7e]{1,200})?$/
const FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/
const HOME = /^\/[A-Za-z0-9._/-]*$/

export function assertPublicKey(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (/[\r\n]/.test(text)) throw new Error('Paste one key at a time')
  const key = text.replace(/\s+/g, ' ')
  if (!PUBLIC_KEY.test(key)) throw new Error('Paste one public key, like "ssh-ed25519 AAAA… name"')
  return key
}

export function assertFingerprint(value: unknown): string {
  if (typeof value !== 'string' || !FINGERPRINT.test(value)) throw new Error('Invalid key fingerprint')
  return value
}

function ownerOf(keys: KeysFacts, user: string): KeyOwner | null {
  const owner = keys.owners.find((candidate) => candidate.user === user)
  return owner && HOME.test(owner.home) ? owner : null
}

const keysFile = (owner: KeyOwner): string => shq(`${owner.home.replace(/\/+$/, '')}/.ssh/authorized_keys`)
const sshDir = (owner: KeyOwner): string => shq(`${owner.home.replace(/\/+$/, '')}/.ssh`)
const refuseLinks = (owner: KeyOwner): string =>
  `if [ -L ${sshDir(owner)} ] || [ -L "$F" ]; then echo "The key file or its folder is a link to another file. Shellway will not change it." >&2; exit 4; fi`

export function addKeyScript(owner: KeyOwner, key: string, asOwner: boolean): string {
  const chown = asOwner ? [] : [`chown -h ${shq(owner.user)}:"$(id -gn ${shq(owner.user)})" ${sshDir(owner)} "$F"`]
  return [
    'set -e',
    `F=${keysFile(owner)}`,
    refuseLinks(owner),
    't=$(mktemp)',
    `printf '%s\\n' ${shq(key)} > "$t"`,
    'if ! ssh-keygen -lf "$t" >/dev/null 2>&1; then rm -f "$t"; echo "This is not a valid public key" >&2; exit 2; fi',
    'rm -f "$t"',
    `install -d -m 700 ${sshDir(owner)}`,
    'touch "$F"',
    'if [ -s "$F" ] && [ -n "$(tail -c 1 "$F")" ]; then echo >> "$F"; fi',
    `printf '%s\\n' ${shq(key)} >> "$F"`,
    ...chown,
    'chmod 600 "$F"'
  ].join('\n')
}

export function removeKeyLineScript(owner: KeyOwner, key: string): string {
  return [`F=${keysFile(owner)}`, `grep -vxF ${shq(key)} "$F" > "$F.shellway-tmp" || true`, 'cat "$F.shellway-tmp" > "$F"', 'rm -f "$F.shellway-tmp"'].join('\n')
}

export function removeKeyScript(owner: KeyOwner, fingerprint: string): string {
  return [
    'set -e',
    `F=${keysFile(owner)}`,
    refuseLinks(owner),
    'cp -p "$F" "$F.shellway-bak"',
    't=$(mktemp); out=$(mktemp); removed=0',
    'while IFS= read -r line || [ -n "$line" ]; do',
    '  case "$line" in ""|"#"*) printf "%s\\n" "$line" >> "$out"; continue;; esac',
    '  printf "%s\\n" "$line" > "$t"',
    `  if [ "$(ssh-keygen -lf "$t" 2>/dev/null | awk '{print $2}')" = ${shq(fingerprint)} ]; then removed=$((removed + 1)); continue; fi`,
    '  printf "%s\\n" "$line" >> "$out"',
    'done < "$F"',
    'if [ "$removed" -eq 0 ]; then rm -f "$t" "$out"; echo "That key is no longer in the file" >&2; exit 3; fi',
    'cat "$out" > "$F"',
    'rm -f "$t" "$out"',
    'echo "Removed $removed key(s)"'
  ].join('\n')
}

interface AddKeyParams {
  user: string
  key: string
}

const addKey: ActionDefinition<AddKeyParams> = {
  type: 'security.keys.add',
  area: 'security',
  needs: [KEYS_PROBE],
  validate(raw) {
    const input = asRecord(raw)
    return { user: assertUser(input.user), key: assertPublicKey(input.key) }
  },
  plan(params, facts) {
    const keys = factData<KeysFacts>(facts, KEYS_PROBE)
    const title = `Add SSH key for ${params.user}`
    if (!keys) return securityPlan({ title, summary: '', steps: [], blocked: unavailable('SSH keys') })
    const owner = ownerOf(keys, params.user)
    const asOwner = params.user === keys.loginUser
    const blob = parseKeyLine(params.key)?.blob
    const duplicate = owner?.keys.some((key) => key.blob === blob) ?? false
    const blocked = !owner ? precondition(`User ${params.user} was not found.`) : !asOwner && !keys.root ? needsRoot('Adding keys for other users') : duplicate ? precondition('This key is already allowed.') : null
    const steps = owner ? [commandStep('add-key', 'Add the key to authorized_keys', addKeyScript(owner, params.key, asOwner), { root: !asOwner, rollback: removeKeyLineScript(owner, params.key) })] : []
    return securityPlan({ title, summary: `${params.key.slice(0, 40)}…`, steps, blocked })
  }
}

interface RemoveKeyParams {
  user: string
  fingerprint: string
  protectedFingerprints: string[]
  sessionKeyUnknown: boolean
}

function lockoutReason(params: RemoveKeyParams, owner: KeyOwner, ssh: SshFacts | null): string {
  if (params.protectedFingerprints.includes(params.fingerprint)) return 'This is the key this PC uses to log in. Shellway will not remove it.'
  if (params.sessionKeyUnknown) return `Shellway could not read which key this PC logs in with, so it will not remove keys from ${owner.user} right now. Reconnect and try again.`
  const remaining = owner.keys.filter((key) => key.fingerprint !== params.fingerprint).length
  if (remaining > 0) return ''
  if (!ssh?.effective) return 'Could not check whether password login is on, so the last key stays.'
  return ssh.effective.passwordAuthentication ? '' : `This is the last key for ${owner.user} and password login is off. Removing it would lock ${owner.user} out.`
}

const removeKey: ActionDefinition<RemoveKeyParams> = {
  type: 'security.keys.remove',
  area: 'security',
  needs: [KEYS_PROBE, SSH_PROBE],
  validate(raw) {
    const input = asRecord(raw)
    const protectedFingerprints = Array.isArray(input.protectedFingerprints) ? input.protectedFingerprints.map(assertFingerprint) : []
    return { user: assertUser(input.user), fingerprint: assertFingerprint(input.fingerprint), protectedFingerprints, sessionKeyUnknown: input.sessionKeyUnknown === true }
  },
  plan(params, facts) {
    const keys = factData<KeysFacts>(facts, KEYS_PROBE)
    const title = `Remove SSH key from ${params.user}`
    if (!keys) return securityPlan({ title, summary: '', steps: [], blocked: unavailable('SSH keys') })
    const owner = ownerOf(keys, params.user)
    const asOwner = params.user === keys.loginUser
    const key = owner?.keys.find((candidate) => candidate.fingerprint === params.fingerprint)
    const reason = owner ? lockoutReason(params, owner, factData<SshFacts>(facts, SSH_PROBE)) : ''
    const blocked = !owner || !key ? precondition('That key was not found. Refresh and try again.') : !asOwner && !keys.root ? needsRoot('Removing keys of other users') : reason ? precondition(reason) : null
    const steps = owner ? [commandStep('remove-key', 'Remove the key from authorized_keys', removeKeyScript(owner, params.fingerprint), { root: !asOwner, rollback: `F=${keysFile(owner)}\ncp -p "$F.shellway-bak" "$F"` })] : []
    return securityPlan({ title, summary: key ? `${key.algorithm} ${key.fingerprint} ${key.comment}`.trim() : params.fingerprint, steps, blocked })
  }
}

export const keyActions: ActionDefinition[] = [addKey, removeKey] as ActionDefinition[]
