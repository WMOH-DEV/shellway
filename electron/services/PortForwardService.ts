import { createServer, type Server, type Socket } from 'net'
import type { SSHConnection } from './SSHService'
import { getLogService } from './LogService'

export interface PortForwardEntry {
  id: string
  connectionId: string
  type: 'local' | 'remote' | 'dynamic'
  name?: string
  sourceHost: string
  sourcePort: number
  destinationHost?: string
  destinationPort?: number
  status: 'active' | 'stopped' | 'error'
  error?: string
  bytesIn: number
  bytesOut: number
}

interface ActiveForward {
  entry: PortForwardEntry
  server: Server
  sockets: Set<Socket>
}

/**
 * Manages port forwarding rules for SSH connections.
 * Focuses on local port forwarding (most common use case):
 *   Listens locally on sourceHost:sourcePort, tunnels to destinationHost:destinationPort through SSH.
 */
export class PortForwardService {
  /** connectionId -> ruleId -> ActiveForward */
  private forwards = new Map<string, Map<string, ActiveForward>>()

  /**
   * Add and start a local port forwarding rule.
   */
  async add(
    conn: SSHConnection,
    rule: {
      id: string
      type: 'local' | 'remote' | 'dynamic'
      name?: string
      sourceHost: string
      sourcePort: number
      destinationHost?: string
      destinationPort?: number
    }
  ): Promise<PortForwardEntry> {
    const log = getLogService()
    const connectionId = conn.id

    if (rule.type !== 'local') {
      // Only local forwarding is implemented currently
      const entry: PortForwardEntry = {
        id: rule.id,
        connectionId,
        type: rule.type,
        name: rule.name,
        sourceHost: rule.sourceHost,
        sourcePort: rule.sourcePort,
        destinationHost: rule.destinationHost,
        destinationPort: rule.destinationPort,
        status: 'error',
        error: `${rule.type} forwarding is not yet implemented`,
        bytesIn: 0,
        bytesOut: 0
      }
      return entry
    }

    const destHost = rule.destinationHost || 'localhost'
    const destPort = rule.destinationPort || 0

    const entry: PortForwardEntry = {
      id: rule.id,
      connectionId,
      type: 'local',
      name: rule.name,
      sourceHost: rule.sourceHost,
      sourcePort: rule.sourcePort,
      destinationHost: destHost,
      destinationPort: destPort,
      status: 'stopped',
      bytesIn: 0,
      bytesOut: 0
    }

    const sockets = new Set<Socket>()

    const server = createServer((localSocket) => {
      sockets.add(localSocket)

      if (conn.status !== 'connected') {
        localSocket.destroy()
        sockets.delete(localSocket)
        return
      }

      // Use forwardOut to create a tunnel through the SSH connection
      conn._client.forwardOut(
        rule.sourceHost,
        rule.sourcePort,
        destHost,
        destPort,
        (err: Error | undefined, stream: any) => {
          if (err) {
            log.log(conn.sessionId, 'error', 'portforward', `Tunnel error: ${err.message}`)
            localSocket.destroy()
            sockets.delete(localSocket)
            return
          }

          // Pipe bidirectionally
          localSocket.pipe(stream)
          stream.pipe(localSocket)

          stream.on('data', (chunk: Buffer) => {
            entry.bytesIn += chunk.length
          })

          localSocket.on('data', (chunk: Buffer) => {
            entry.bytesOut += chunk.length
          })

          localSocket.on('close', () => {
            stream.destroy()
            sockets.delete(localSocket)
          })

          stream.on('close', () => {
            localSocket.destroy()
            sockets.delete(localSocket)
          })

          localSocket.on('error', () => {
            stream.destroy()
            sockets.delete(localSocket)
          })

          stream.on('error', () => {
            localSocket.destroy()
            sockets.delete(localSocket)
          })
        }
      )
    })

    return new Promise<PortForwardEntry>((resolve, reject) => {
      server.on('error', (err) => {
        entry.status = 'error'
        entry.error = err.message
        log.log(conn.sessionId, 'error', 'portforward', `Listen error on ${rule.sourceHost}:${rule.sourcePort}: ${err.message}`)
        resolve(entry)
      })

      server.listen(rule.sourcePort, rule.sourceHost, () => {
        entry.status = 'active'
        log.log(
          conn.sessionId,
          'info',
          'portforward',
          `Local forward active: ${rule.sourceHost}:${rule.sourcePort} -> ${destHost}:${destPort}`
        )

        // Store the forward
        if (!this.forwards.has(connectionId)) {
          this.forwards.set(connectionId, new Map())
        }
        this.forwards.get(connectionId)!.set(rule.id, { entry, server, sockets })

        resolve(entry)
      })
    })
  }

  /**
   * Remove (stop) a forwarding rule.
   */
  remove(connectionId: string, ruleId: string): boolean {
    const connForwards = this.forwards.get(connectionId)
    if (!connForwards) return false

    const fwd = connForwards.get(ruleId)
    if (!fwd) return false

    // Close all active sockets
    for (const sock of fwd.sockets) {
      sock.destroy()
    }
    fwd.sockets.clear()

    // Close the listening server
    fwd.server.close()
    fwd.entry.status = 'stopped'

    connForwards.delete(ruleId)
    if (connForwards.size === 0) {
      this.forwards.delete(connectionId)
    }

    const log = getLogService()
    log.log(connectionId, 'info', 'portforward', `Forward removed: ${fwd.entry.sourceHost}:${fwd.entry.sourcePort}`)

    return true
  }

  /**
   * List all active forwardings for a connection.
   */
  list(connectionId: string): PortForwardEntry[] {
    const connForwards = this.forwards.get(connectionId)
    if (!connForwards) return []
    return Array.from(connForwards.values()).map((f) => ({ ...f.entry }))
  }

  /**
   * Remove all forwardings for a connection (e.g., on disconnect).
   */
  removeAll(connectionId: string): void {
    const connForwards = this.forwards.get(connectionId)
    if (!connForwards) return

    for (const [ruleId] of connForwards) {
      this.remove(connectionId, ruleId)
    }
  }
}
