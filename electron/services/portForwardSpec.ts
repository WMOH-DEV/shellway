import type { PortForwardSpec, PortForwardType } from '../../src/types/portForward'

const TYPES: readonly PortForwardType[] = ['local', 'remote', 'dynamic']
const MAX_HOST_LENGTH = 255

function host(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_HOST_LENGTH || /\s/.test(value)) {
    throw new Error(`Invalid ${field}`)
  }
  return value
}

function port(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Invalid ${field}`)
  }
  return value
}

export function parseForwardSpec(raw: unknown): PortForwardSpec {
  const rule = (raw ?? {}) as Record<string, unknown>
  if (typeof rule.id !== 'string' || rule.id === '') throw new Error('Invalid rule id')
  if (!TYPES.includes(rule.type as PortForwardType)) throw new Error('Invalid forwarding type')
  const type = rule.type as PortForwardType
  const spec: PortForwardSpec = {
    id: rule.id,
    type,
    name: typeof rule.name === 'string' ? rule.name : undefined,
    sourceHost: host(rule.sourceHost, 'listen address'),
    sourcePort: port(rule.sourcePort, 'listen port')
  }
  if (type === 'dynamic') return spec
  return {
    ...spec,
    destinationHost: host(rule.destinationHost, 'destination host'),
    destinationPort: port(rule.destinationPort, 'destination port')
  }
}
