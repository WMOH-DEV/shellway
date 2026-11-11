export type PortForwardType = 'local' | 'remote' | 'dynamic'

export interface PortForwardSpec {
  id: string
  type: PortForwardType
  name?: string
  sourceHost: string
  sourcePort: number
  destinationHost?: string
  destinationPort?: number
}

export interface PortForwardEntry extends PortForwardSpec {
  connectionId: string
  status: 'active' | 'error'
  error?: string
  lastError?: string
  openConnections: number
  bytes: number
}

export interface PortForwardStartResult {
  success: boolean
  data?: PortForwardEntry
  error?: string
}
