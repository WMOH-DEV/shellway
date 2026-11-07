import { ROOT_PRELUDE, fileWithSha, firstLine, hasRoot, sections, shq, sshClientPart, trackedFile } from './shell'
import { SHELLWAY_SSH_DROPIN, type RootLogin } from './ssh'
import { parseUfwRule, ruleTargetsPort, type UfwAction, type UfwPolicy } from './ufw'
import { asRecord, assertBoolean, assertOneOf, assertPort, isIpOrCidr } from './validate'

export const REVERT_SECONDS = 60
export const RECHECK_SECONDS = 75
export const VERIFY_COMMAND = 'cat /etc/machine-id 2>/dev/null || hostname'

export interface UfwRuleInput {
  port: string
  proto: 'tcp' | 'udp' | 'any'
  from: string
  action: UfwAction
  comment: string
}

export interface UfwRuleRef {
  number: number
  raw: string
}

export type GuardRequest =
  | { kind: 'ufw.enable' }
  | { kind: 'ufw.rule.add'; rule: UfwRuleInput }
  | { kind: 'ufw.rule.remove'; rules: UfwRuleRef[] }
  | { kind: 'ufw.default'; direction: 'incoming' | 'outgoing'; policy: UfwPolicy }
  | { kind: 'ssh.port'; port: number }
  | { kind: 'ssh.password'; enabled: boolean }
  | { kind: 'ssh.rootLogin'; value: RootLogin }

export type GuardKind = GuardRequest['kind']

export interface GuardContext {
  root: boolean
  sshPort: number
  loginUser: string
  socketActivated: boolean
  ufwInstalled: boolean
  dropIn: string
  machine: string
  ufwRules: string[]
}

export interface GuardedChange {
  kind: GuardKind
  title: string
  summary: string
  files: string[]
  apply: string
  revertTail: string
  newPort: number | null
  warnings: string[]
}

export type GuardStepId = 'backup' | 'arm' | 'apply' | 'verify' | 'disarm' | 'recheck'
export type GuardStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'
export type GuardOutcome = 'running' | 'done' | 'reverting' | 'reverted' | 'failed' | 'locked'

export interface GuardStep {
  id: GuardStepId
  label: string
  status: GuardStepStatus
  detail: string
  display: string
  output: string
}

export interface GuardRun {
  id: string
  connectionId: string
  kind: GuardKind
  title: string
  startedAt: number
  finishedAt: number | null
  revertAt: number | null
  outcome: GuardOutcome
  message: string
  steps: GuardStep[]
}

export interface SecuritySessionInfo {
  keyAuth: boolean
  fingerprints: string[]
  source: 'key' | 'agent' | 'none'
  canVerify: boolean
  reason: string
  configPort: number
}

export interface GuardPreview {
  title: string
  summary: string
  commands: string
  verifyPort: number
  warnings: string[]
}

const UFW_FILES = ['/etc/ufw/user.rules', '/etc/ufw/user6.rules', '/etc/ufw/ufw.conf', '/etc/default/ufw']
const STATE_DIR = '/var/lib/shellway'
const RUN_ID = /^[a-z0-9]{8,32}$/
const COMMENT = /^[A-Za-z0-9 ._,:/()+-]{0,60}$/
const RULE_RAW_MAX = 300

export class GuardRefusal extends Error {}

const refuse = (message: string): never => {
  throw new GuardRefusal(message)
}

export const UFW_RELOAD = 'if [ -x /usr/sbin/ufw ]; then if grep -q "^ENABLED=yes" /etc/ufw/ufw.conf; then ufw reload; else ufw disable; fi; fi'

export function sshRestartScript(socketActivated: boolean): string {
  return socketActivated
    ? 'systemctl daemon-reload && systemctl restart ssh.socket && systemctl try-reload-or-restart ssh.service'
    : 'systemctl reload ssh 2>/dev/null || systemctl reload sshd'
}

function validatePortSpec(value: unknown, proto: UfwRuleInput['proto']): string {
  if (typeof value !== 'string') return refuse('Invalid port')
  const match = /^(\d{1,5})(?::(\d{1,5}))?$/.exec(value.trim())
  if (!match) return refuse('Port must be a number like 443 or a range like 8000:8100')
  const low = assertPort(Number(match[1]))
  if (match[2] === undefined) return String(low)
  const high = assertPort(Number(match[2]))
  if (high <= low) refuse('The end of a port range must be higher than the start')
  if (proto === 'any') refuse('A port range needs TCP or UDP')
  return `${low}:${high}`
}

function validateRuleInput(raw: unknown): UfwRuleInput {
  const input = asRecord(raw)
  const proto = assertOneOf(input.proto, ['tcp', 'udp', 'any'] as const, 'protocol')
  const from = typeof input.from === 'string' ? input.from.trim() : ''
  if (from !== 'any' && !isIpOrCidr(from)) refuse('"From" must be "any", an IP address or a network like 10.0.0.0/8')
  const comment = typeof input.comment === 'string' ? input.comment.trim() : ''
  if (!COMMENT.test(comment)) refuse('Notes can use letters, numbers, spaces and . , : / ( ) + - (60 characters max)')
  return { port: validatePortSpec(input.port, proto), proto, from, action: assertOneOf(input.action, ['allow', 'deny', 'reject', 'limit'] as const, 'action'), comment }
}

function validateRuleRefs(raw: unknown): UfwRuleRef[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 8) return refuse('Pick the rule to remove')
  return raw.map((entry) => {
    const ref = asRecord(entry)
    const number = typeof ref.number === 'number' && Number.isInteger(ref.number) && ref.number > 0 && ref.number < 10000 ? ref.number : refuse('Invalid rule number')
    const text = typeof ref.raw === 'string' ? ref.raw : ''
    if (!text || text.length > RULE_RAW_MAX || /[\u0000-\u001f]/.test(text) || parseUfwRule(text)?.number !== number) refuse('Invalid rule')
    return { number, raw: text }
  })
}

export function validateGuardRequest(raw: unknown): GuardRequest {
  const input = asRecord(raw)
  const kind = assertOneOf(input.kind, ['ufw.enable', 'ufw.rule.add', 'ufw.rule.remove', 'ufw.default', 'ssh.port', 'ssh.password', 'ssh.rootLogin'] as const, 'change')
  switch (kind) {
    case 'ufw.enable':
      return { kind }
    case 'ufw.rule.add':
      return { kind, rule: validateRuleInput(input.rule) }
    case 'ufw.rule.remove':
      return { kind, rules: validateRuleRefs(input.rules) }
    case 'ufw.default':
      return { kind, direction: assertOneOf(input.direction, ['incoming', 'outgoing'] as const, 'direction'), policy: assertOneOf(input.policy, ['allow', 'deny', 'reject'] as const, 'policy') }
    case 'ssh.port':
      return { kind, port: assertPort(input.port) }
    case 'ssh.password':
      return { kind, enabled: assertBoolean(input.enabled, 'setting') }
    case 'ssh.rootLogin':
      return { kind, value: assertOneOf(input.value, ['yes', 'no', 'prohibit-password'] as const, 'root login setting') }
  }
}

const allowSsh = (ctx: GuardContext): string => `ufw allow ${ctx.sshPort}/tcp`

export function ufwRuleCommand(rule: UfwRuleInput): string {
  const proto = rule.proto === 'any' ? '' : ` proto ${rule.proto}`
  const comment = rule.comment ? ` comment ${shq(rule.comment)}` : ''
  return `ufw ${rule.action}${proto} from ${rule.from} to any port ${rule.port}${comment}`
}

function blocksPort(rule: UfwRuleInput, port: number): boolean {
  if (rule.proto === 'udp' || (rule.action !== 'deny' && rule.action !== 'reject')) return false
  const [low, high = low] = rule.port.split(':').map(Number)
  return port >= low && port <= high
}

function ufwChange(ctx: GuardContext, kind: GuardKind, title: string, summary: string, commands: string[], warnings: string[] = []): GuardedChange {
  if (!ctx.ufwInstalled) refuse('ufw is not installed. Install it first.')
  return { kind, title, summary, files: UFW_FILES, apply: ['set -e', ...commands, 'ufw status verbose'].join('\n'), revertTail: UFW_RELOAD, newPort: null, warnings }
}

function ruleRemoval(ctx: GuardContext, rules: UfwRuleRef[]): GuardedChange {
  const parsed = rules.map((ref) => parseUfwRule(ref.raw))
  if (parsed.some((rule) => rule && rule.direction === 'in' && (rule.action === 'allow' || rule.action === 'limit') && ruleTargetsPort(rule.to, ctx.sshPort))) {
    refuse(`This rule lets you reach SSH on port ${ctx.sshPort}. It is protected and cannot be removed.`)
  }
  const missing = rules.filter((ref) => !ctx.ufwRules.includes(ref.raw))
  if (missing.length > 0) refuse('The firewall rules changed since this page loaded. Refresh and try again.')
  const checks = rules.map((ref) => `printf '%s\\n' "$current" | grep -qxF ${shq(ref.raw)} || { echo "The firewall rules changed. Refresh and try again." >&2; exit 3; }`)
  const deletes = [...rules].sort((a, b) => b.number - a.number).map((ref) => `ufw --force delete ${ref.number}`)
  const current = `current=$(ufw status numbered | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')`
  return ufwChange(ctx, 'ufw.rule.remove', 'Remove firewall rule', rules.map((ref) => ref.raw.replace(/^\[\s*\d+\]\s*/, '')).join('\n'), [current, ...checks, ...deletes, allowSsh(ctx)])
}

export function mergeDropIn(current: string, settings: Record<string, string | null>): string {
  const names = new Set(Object.keys(settings).map((name) => name.toLowerCase()))
  const kept = current.split('\n').map((line) => line.trimEnd()).filter((line) => line && !names.has(line.trim().split(/\s+/)[0]?.toLowerCase() ?? ''))
  const added = Object.entries(settings).filter((entry): entry is [string, string] => entry[1] !== null).map(([name, value]) => `${name} ${value}`)
  return `${[...kept, ...added].join('\n')}\n`
}

function sshChange(ctx: GuardContext, kind: GuardKind, title: string, summary: string, settings: Record<string, string | null>, expect: string, extra: { pre?: string[]; newPort?: number | null; warnings?: string[]; files?: string[]; revert?: string } = {}): GuardedChange {
  const content = mergeDropIn(ctx.dropIn, settings)
  const apply = [
    'set -e',
    ...(extra.pre ?? []),
    'SSHD=/usr/sbin/sshd; [ -x "$SSHD" ] || SSHD=sshd',
    'install -d -m 755 /etc/ssh/sshd_config.d',
    `cat > ${SHELLWAY_SSH_DROPIN}.tmp <<'SHELLWAY_EOF'`,
    content.trimEnd(),
    'SHELLWAY_EOF',
    `chmod 644 ${SHELLWAY_SSH_DROPIN}.tmp`,
    `mv -f ${SHELLWAY_SSH_DROPIN}.tmp ${SHELLWAY_SSH_DROPIN}`,
    '"$SSHD" -t',
    `"$SSHD" -T | grep -Eqx ${shq(expect)} || { echo "sshd did not pick up the new setting. Check that /etc/ssh/sshd_config includes sshd_config.d." >&2; exit 4; }`,
    sshRestartScript(ctx.socketActivated)
  ].join('\n')
  const revertTail = [extra.revert, sshRestartScript(ctx.socketActivated)].filter(Boolean).join('\n')
  return { kind, title, summary, files: [SHELLWAY_SSH_DROPIN, ...(extra.files ?? [])], apply, revertTail, newPort: extra.newPort ?? null, warnings: extra.warnings ?? [] }
}

function portChange(ctx: GuardContext, port: number): GuardedChange {
  if (port === ctx.sshPort) refuse(`SSH already uses port ${port}`)
  const warnings = [
    `After this works, change the port of this saved session to ${port}, or the next connection will fail.`,
    'A firewall outside the server (your cloud provider) must also allow the new port, otherwise the check fails and the change is undone.',
    'If fail2ban watches SSH, its jail keeps watching the old port until you update it.'
  ]
  const pre = ctx.ufwInstalled ? [`ufw allow ${port}/tcp`] : []
  return sshChange(ctx, 'ssh.port', `Change SSH port to ${port}`, `sshd will listen on port ${port}. Shellway checks a new connection on port ${port} before keeping it.`, { Port: String(port) }, `port ${port}`, {
    pre,
    newPort: port,
    warnings,
    files: ctx.ufwInstalled ? UFW_FILES : [],
    revert: ctx.ufwInstalled ? UFW_RELOAD : undefined
  })
}

function passwordChange(ctx: GuardContext, enabled: boolean, keyAuth: boolean): GuardedChange {
  if (!enabled && !keyAuth) refuse('This session did not log in with a key. Connect with an SSH key first, then turn password login off.')
  const settings = enabled ? { PasswordAuthentication: 'yes', KbdInteractiveAuthentication: null } : { PasswordAuthentication: 'no', KbdInteractiveAuthentication: 'no' }
  const title = enabled ? 'Turn password login on' : 'Turn password login off'
  const summary = enabled ? 'Anyone with the password can log in again.' : 'Only SSH keys can log in. Your key login is checked with a new connection first.'
  return sshChange(ctx, 'ssh.password', title, summary, settings, `passwordauthentication ${enabled ? 'yes' : 'no'}`)
}

function rootLoginChange(ctx: GuardContext, value: RootLogin, keyAuth: boolean): GuardedChange {
  if (ctx.loginUser === 'root' && value === 'no') refuse('You are logged in as root. Log in as another user with sudo before turning root login off.')
  if (ctx.loginUser === 'root' && value === 'prohibit-password' && !keyAuth) refuse('You are logged in as root with a password. Use an SSH key first.')
  const expect = value === 'prohibit-password' ? 'permitrootlogin (prohibit-password|without-password)' : `permitrootlogin ${value}`
  const warnings = value === 'yes' ? ['Root can log in with a password. Keys only is safer.'] : []
  return sshChange(ctx, 'ssh.rootLogin', `Set root login to "${value}"`, `PermitRootLogin ${value}`, { PermitRootLogin: value }, expect, { warnings })
}

export function buildGuardedChange(request: GuardRequest, ctx: GuardContext, keyAuth: boolean): GuardedChange {
  switch (request.kind) {
    case 'ufw.enable':
      return ufwChange(ctx, request.kind, 'Turn the firewall on', `SSH port ${ctx.sshPort} is allowed first, then ufw is turned on.`, [allowSsh(ctx), 'ufw --force enable'])
    case 'ufw.rule.add':
      if (blocksPort(request.rule, ctx.sshPort)) refuse(`Port ${ctx.sshPort} is your SSH port. It cannot be blocked.`)
      return ufwChange(ctx, request.kind, 'Add firewall rule', `${request.rule.action} ${request.rule.port}/${request.rule.proto} from ${request.rule.from}`, [allowSsh(ctx), ufwRuleCommand(request.rule)])
    case 'ufw.rule.remove':
      return ruleRemoval(ctx, request.rules)
    case 'ufw.default':
      return ufwChange(ctx, request.kind, `Set default ${request.direction} policy`, `${request.policy} ${request.direction}`, [allowSsh(ctx), `ufw default ${request.policy} ${request.direction}`])
    case 'ssh.port':
      return portChange(ctx, request.port)
    case 'ssh.password':
      return passwordChange(ctx, request.enabled, keyAuth)
    case 'ssh.rootLogin':
      return rootLoginChange(ctx, request.value, keyAuth)
  }
}

export const PREFLIGHT_SCRIPT = [
  ROOT_PRELUDE,
  'echo "@@session"; echo "$SSH_CONNECTION"',
  'echo "@@user"; id -un',
  'echo "@@socket"; systemctl is-active ssh.socket 2>/dev/null',
  'echo "@@ufw"; if [ -x /usr/sbin/ufw ]; then echo yes; else echo no; fi',
  `echo "@@machine"; ${VERIFY_COMMAND}`,
  'echo "@@numbered"; asroot ufw status numbered 2>/dev/null | sed \'s/^[[:space:]]*//;s/[[:space:]]*$//\'',
  fileWithSha('dropin', SHELLWAY_SSH_DROPIN, false)
].join('\n')

export function parsePreflight(stdout: string): GuardContext {
  const parts = sections(stdout)
  const port = Number(sshClientPart(firstLine(parts, 'session'), 3))
  return {
    root: hasRoot(parts),
    sshPort: Number.isInteger(port) && port > 0 ? port : 0,
    loginUser: firstLine(parts, 'user'),
    socketActivated: firstLine(parts, 'socket') === 'active',
    ufwInstalled: firstLine(parts, 'ufw') === 'yes',
    dropIn: trackedFile(parts, 'dropin')?.content ?? '',
    machine: firstLine(parts, 'machine'),
    ufwRules: (parts.get('numbered') ?? []).filter((line) => line.startsWith('['))
  }
}

export interface GuardPaths {
  dir: string
  backup: string
  script: string
  pid: string
  done: string
  unit: string
}

export function guardPaths(id: string): GuardPaths {
  if (!RUN_ID.test(id)) throw new Error('Invalid guard id')
  return {
    dir: STATE_DIR,
    backup: `${STATE_DIR}/backup-${id}`,
    script: `${STATE_DIR}/revert-${id}.sh`,
    pid: `${STATE_DIR}/revert-${id}.pid`,
    done: `${STATE_DIR}/revert-${id}.done`,
    unit: `shellway-revert-${id}`
  }
}

export function revertScript(id: string, change: GuardedChange): string {
  const paths = guardPaths(id)
  return [
    '#!/bin/sh',
    `B=${paths.backup}`,
    'restore() { if [ -f "$B/$1.absent" ]; then rm -f "$2"; elif [ -f "$B/$1" ]; then cp -a "$B/$1" "$2"; fi; }',
    ...change.files.map((file, index) => `restore ${index} ${shq(file)}`),
    change.revertTail,
    `touch ${paths.done}`
  ].join('\n')
}

export function backupScript(id: string, change: GuardedChange): string {
  const paths = guardPaths(id)
  return [
    'set -e',
    'umask 077',
    `mkdir -p ${paths.backup}`,
    `B=${paths.backup}`,
    'backup() { if [ -e "$2" ]; then cp -a "$2" "$B/$1"; else : > "$B/$1.absent"; fi; }',
    ...change.files.map((file, index) => `backup ${index} ${shq(file)}`),
    `cat > ${paths.script} <<'SHELLWAY_REVERT_EOF'`,
    revertScript(id, change),
    'SHELLWAY_REVERT_EOF',
    `chmod 700 ${paths.script}`,
    'echo SHELLWAY_BACKUP=ok'
  ].join('\n')
}

export function armScript(id: string): string {
  const paths = guardPaths(id)
  return [
    `if command -v systemd-run >/dev/null 2>&1 && systemd-run --unit=${paths.unit} --on-active=${REVERT_SECONDS} --timer-property=AccuracySec=1s /bin/sh ${paths.script} >/dev/null 2>&1 && systemctl is-active --quiet ${paths.unit}.timer; then`,
    '  echo SHELLWAY_ARMED=timer',
    '  exit 0',
    'fi',
    `setsid nohup sh -c 'sleep ${REVERT_SECONDS}; sh ${paths.script}' >/dev/null 2>&1 </dev/null &`,
    `echo $! > ${paths.pid}`,
    `if kill -0 "$(cat ${paths.pid})" 2>/dev/null; then echo SHELLWAY_ARMED=sleep; exit 0; fi`,
    'echo "Could not arm the automatic undo" >&2',
    'exit 1'
  ].join('\n')
}

export function disarmScript(id: string): string {
  const paths = guardPaths(id)
  return [
    `systemctl stop ${paths.unit}.timer 2>/dev/null`,
    `if [ -f ${paths.pid} ]; then kill "$(cat ${paths.pid})" 2>/dev/null; fi`,
    `if systemctl is-active --quiet ${paths.unit}.timer 2>/dev/null; then echo "The undo timer is still running" >&2; exit 1; fi`,
    `if [ -f ${paths.done} ]; then echo SHELLWAY_REVERTED=1; fi`,
    `rm -rf ${paths.script} ${paths.pid} ${paths.done} ${paths.backup}`,
    'echo SHELLWAY_DISARMED=1'
  ].join('\n')
}

export function revertNowScript(id: string): string {
  const paths = guardPaths(id)
  return [
    `systemctl stop ${paths.unit}.timer 2>/dev/null`,
    `if [ -f ${paths.pid} ]; then kill "$(cat ${paths.pid})" 2>/dev/null; fi`,
    `sh ${paths.script}`,
    `rm -f ${paths.script} ${paths.pid}`,
    'echo SHELLWAY_REVERTED=1'
  ].join('\n')
}

export function cleanupScript(id: string): string {
  const paths = guardPaths(id)
  return `rm -rf ${paths.script} ${paths.pid} ${paths.done} ${paths.backup}`
}

export const STEP_LABELS: Record<GuardStepId, string> = {
  backup: 'Back up the files this change touches',
  arm: `Arm the automatic undo (${REVERT_SECONDS} s)`,
  apply: 'Apply the change',
  verify: 'Log in again with a new connection',
  disarm: 'Cancel the automatic undo',
  recheck: 'Check that you can log in again'
}

export function previewOf(change: GuardedChange, verifyPort: number): GuardPreview {
  return { title: change.title, summary: change.summary, commands: change.apply.replace(/^set -e\n/, ''), verifyPort, warnings: change.warnings }
}
