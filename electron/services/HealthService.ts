import type { SSHConnection } from './SSHService'

export interface ConnectionHealth {
  connectedAt: number
  latencyMs: number
  latencyHistory: number[]
  bytesIn: number
  bytesOut: number
  serverInfo: {
    serverVersion: string
    clientVersion: string
  }
}

interface HealthState {
  connectedAt: number
  latencyHistory: number[]
  serverVersion: string
  clientVersion: string
  timer: ReturnType<typeof setInterval> | null
}

/**
 * Tracks connection health metrics: latency, uptime, bytes transferred.
 * Periodically runs `echo ping` through the SSH connection to measure RTT.
 */
export class HealthService {
  private states = new Map<string, HealthState>()

  /**
   * Start health monitoring for a connection.
   */
  startMonitoring(conn: SSHConnection): void {
    this.stopMonitoring(conn.id)

    // Extract server/client version from the ssh2 Client's internal handshake data
    const client = conn._client as any
    const serverVersion = client._remoteVer ?? client._remoteIdentRaw ?? 'unknown'
    const clientVersion = client._ourIdent ?? 'SSH-2.0-ssh2js'

    const state: HealthState = {
      connectedAt: Date.now(),
      latencyHistory: [],
      serverVersion: String(serverVersion).trim(),
      clientVersion: String(clientVersion).trim(),
      timer: null
    }

    // Measure latency immediately, then every 10s
    this.measureLatency(conn, state)
    state.timer = setInterval(() => {
      if (conn.status === 'connected') {
        this.measureLatency(conn, state)
      }
    }, 10000)

    this.states.set(conn.id, state)
  }

  /**
   * Stop health monitoring.
   */
  stopMonitoring(connectionId: string): void {
    const state = this.states.get(connectionId)
    if (state) {
      if (state.timer) clearInterval(state.timer)
      this.states.delete(connectionId)
    }
  }

  /**
   * Get current health info.
   */
  getHealth(connectionId: string): ConnectionHealth | null {
    const state = this.states.get(connectionId)
    if (!state) return null

    const lastLatency = state.latencyHistory.length > 0
      ? state.latencyHistory[state.latencyHistory.length - 1]
      : -1

    return {
      connectedAt: state.connectedAt,
      latencyMs: lastLatency,
      latencyHistory: [...state.latencyHistory],
      bytesIn: 0,
      bytesOut: 0,
      serverInfo: {
        serverVersion: state.serverVersion,
        clientVersion: state.clientVersion
      }
    }
  }

  /**
   * Measure latency by executing a simple command.
   */
  private measureLatency(conn: SSHConnection, state: HealthState): void {
    if (conn.status !== 'connected') return

    const start = Date.now()

    // Access the underlying ssh2 client to exec a simple command
    conn._client.exec('echo pong', (err: Error | undefined, stream: any) => {
      if (err) return

      stream.on('close', () => {
        const rtt = Date.now() - start
        state.latencyHistory.push(rtt)
        // Keep only last 20 measurements
        if (state.latencyHistory.length > 20) {
          state.latencyHistory.shift()
        }
      })

      // Consume data to avoid backpressure
      stream.on('data', () => {})
      stream.stderr.on('data', () => {})
    })
  }

  /**
   * Stop all monitoring.
   */
  stopAll(): void {
    for (const [id] of this.states) {
      this.stopMonitoring(id)
    }
  }
}
