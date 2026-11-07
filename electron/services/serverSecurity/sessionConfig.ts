import type { SSHConnection, SSHConnectionConfig } from '../SSHService'

type CloneableConnection = SSHConnection & { cloneConfig?: () => SSHConnectionConfig }

export async function sessionConfigOf(conn: SSHConnection | undefined): Promise<SSHConnectionConfig | null> {
  if (!conn) return null
  const cloneable = conn as CloneableConnection
  if (cloneable.cloneConfig) return cloneable.cloneConfig()
  return conn.refreshConfig ? await conn.refreshConfig() : null
}
