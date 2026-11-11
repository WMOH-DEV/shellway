import type { PortForwardRule } from '@/types/session'
import type { PortForwardSpec, PortForwardType } from '@/types/portForward'
import { formatBytes } from '@/utils/server/services/format'

export interface RuleForm {
  type: PortForwardType
  name: string
  sourceHost: string
  sourcePort: string
  destinationHost: string
  destinationPort: string
  autoStart: boolean
}

export type RuleFormErrors = Partial<Record<'sourceHost' | 'sourcePort' | 'destinationHost' | 'destinationPort', string>>

export const LOOPBACK = '127.0.0.1'

export const emptyForm = (): RuleForm => ({
  type: 'local',
  name: '',
  sourceHost: LOOPBACK,
  sourcePort: '',
  destinationHost: LOOPBACK,
  destinationPort: '',
  autoStart: false
})

export function formFromRule(rule: PortForwardRule): RuleForm {
  return {
    type: rule.type,
    name: rule.name ?? '',
    sourceHost: rule.sourceHost,
    sourcePort: String(rule.sourcePort),
    destinationHost: rule.destinationHost ?? LOOPBACK,
    destinationPort: rule.destinationPort ? String(rule.destinationPort) : '',
    autoStart: rule.autoStart
  }
}

export const hasDestination = (type: PortForwardType) => type !== 'dynamic'

export function ruleFromForm(form: RuleForm, id: string): PortForwardRule {
  const withDestination = hasDestination(form.type)
  return {
    id,
    type: form.type,
    name: form.name.trim() || undefined,
    sourceHost: form.sourceHost.trim(),
    sourcePort: Number(form.sourcePort),
    destinationHost: withDestination ? form.destinationHost.trim() : undefined,
    destinationPort: withDestination ? Number(form.destinationPort) : undefined,
    autoStart: form.autoStart,
    enabled: true
  }
}

function portError(value: string): string | undefined {
  if (value.trim() === '') return 'Enter a port'
  const port = Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? undefined : 'Use a port from 1 to 65535'
}

function hostError(value: string): string | undefined {
  if (value.trim() === '') return 'Enter a host'
  return /\s/.test(value.trim()) ? 'A host cannot contain spaces' : undefined
}

const listensOnThisComputer = (type: PortForwardType) => type !== 'remote'

export function validateForm(form: RuleForm, otherRules: PortForwardRule[]): RuleFormErrors {
  const errors: RuleFormErrors = {
    sourceHost: hostError(form.sourceHost),
    sourcePort: portError(form.sourcePort)
  }
  if (hasDestination(form.type)) {
    errors.destinationHost = hostError(form.destinationHost)
    errors.destinationPort = portError(form.destinationPort)
  }
  const clash = otherRules.find(
    (rule) =>
      listensOnThisComputer(rule.type) === listensOnThisComputer(form.type) && rule.sourcePort === Number(form.sourcePort)
  )
  if (!errors.sourcePort && clash) errors.sourcePort = `"${ruleTitle(clash)}" already uses port ${clash.sourcePort}`
  return Object.fromEntries(Object.entries(errors).filter(([, message]) => message)) as RuleFormErrors
}

export function specOf(rule: PortForwardRule): PortForwardSpec {
  return {
    id: rule.id,
    type: rule.type,
    name: rule.name,
    sourceHost: rule.sourceHost,
    sourcePort: rule.sourcePort,
    destinationHost: rule.destinationHost,
    destinationPort: rule.destinationPort
  }
}

const TYPE_TITLES: Record<PortForwardType, string> = {
  local: 'Local forward',
  remote: 'Remote forward',
  dynamic: 'SOCKS proxy'
}

export const ruleTitle = (rule: PortForwardRule) => rule.name || TYPE_TITLES[rule.type]

export function reachableAddress(rule: PortForwardRule): string {
  const host = rule.sourceHost === '0.0.0.0' || rule.sourceHost === '::' ? LOOPBACK : rule.sourceHost
  return `${host.includes(':') ? `[${host}]` : host}:${rule.sourcePort}`
}

export function routeText(rule: PortForwardRule): string {
  const source = `${rule.sourceHost}:${rule.sourcePort}`
  const destination = `${rule.destinationHost}:${rule.destinationPort}`
  if (rule.type === 'dynamic') return `${source} on this computer → any host, through the server`
  if (rule.type === 'remote') return `${source} on the server → ${destination} on this computer`
  return `${source} on this computer → ${destination} from the server`
}

export const formatTraffic = (bytes: number) => (bytes < 1024 ? `${bytes} B` : formatBytes(bytes))
