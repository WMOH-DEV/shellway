import type { HostnameStatus, NameReadiness } from '../../../types/ssl'

const isProxied = (hostnames: HostnameStatus[], name: string): boolean =>
  hostnames.find((host) => host.name === name)?.edge.state === 'proxied'

const isPort80Closed = (readiness: NameReadiness[], name: string): boolean =>
  readiness.find((row) => row.name === name)?.port80.state === 'fail'

export function certbotLikelyFails(names: string[], readiness: NameReadiness[], hostnames: HostnameStatus[]): boolean {
  return names.length > 0 && names.every((name) => isPort80Closed(readiness, name) && isProxied(hostnames, name))
}
