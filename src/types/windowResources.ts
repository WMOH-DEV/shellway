export type WindowResourceKind = 'ssh' | 'sql'

export function sshResource(connectionId: string): string {
  return `ssh:${connectionId}`
}

export function sqlResource(sqlSessionId: string): string {
  return `sql:${sqlSessionId}`
}

export function parseResource(resource: string): { kind: WindowResourceKind; id: string } | null {
  const separator = resource.indexOf(':')
  const kind = resource.slice(0, separator)
  if (kind !== 'ssh' && kind !== 'sql') return null
  return { kind, id: resource.slice(separator + 1) }
}

export interface FeatureWindowRef {
  tabId: string
  subTab: string
}

export function isFeatureWindowRef(value: unknown): value is FeatureWindowRef {
  const ref = value as FeatureWindowRef
  return typeof ref === 'object' && ref !== null && typeof ref.tabId === 'string' && typeof ref.subTab === 'string'
}
