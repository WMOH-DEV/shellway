import type { SSHConnection } from './SSHService'
import type {
  SystemdService,
  ServiceDetails,
  ServiceLogEntry,
  ServiceAction
} from '../../src/types/serviceManager'

/** Timeout for all SSH commands (ms) */
const COMMAND_TIMEOUT = 10_000

/** Allowed service actions for validation */
const VALID_ACTIONS: ReadonlySet<ServiceAction> = new Set([
  'start', 'stop', 'restart', 'reload', 'enable', 'disable', 'mask', 'unmask'
])

/** Validates a unit name against injection attacks (max 256 chars) */
function isValidUnitName(unit: string): boolean {
  return unit.length > 0 && unit.length <= 256 && /^[a-zA-Z0-9@._-]+$/.test(unit)
}

/** Priority number to syslog severity name */
const PRIORITY_MAP: Record<string, ServiceLogEntry['priority']> = {
  '0': 'emerg',
  '1': 'alert',
  '2': 'crit',
  '3': 'err',
  '4': 'warning',
  '5': 'notice',
  '6': 'info',
  '7': 'debug'
}

/**
 * Executes a command over SSH with a timeout.
 * Returns stdout/stderr and exit code.
 * Uses a `settled` flag to prevent double-resolution from timeout/close/error races.
 */
function execCommand(
  conn: SSHConnection,
  command: string,
  timeoutMs: number = COMMAND_TIMEOUT
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    if (conn.status !== 'connected') {
      return reject(new Error('SSH connection is not active'))
    }

    conn._client.exec(command, (err: Error | undefined, stream: any) => {
      if (err) return reject(err)

      let stdout = ''
      let stderr = ''
      let settled = false

      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn()
      }

      const timer = setTimeout(() => {
        settle(() => {
          stream.destroy()
          reject(new Error(`Command timed out after ${timeoutMs}ms`))
        })
      }, timeoutMs)

      stream.on('data', (d: Buffer) => {
        if (!settled) stdout += d.toString()
      })

      stream.stderr.on('data', (d: Buffer) => {
        if (!settled) stderr += d.toString()
      })

      // Prevent unhandled 'error' events from crashing the main process
      stream.on('error', (streamErr: Error) => {
        settle(() => reject(streamErr))
      })
      stream.stderr.on('error', () => {})

      stream.on('close', (code: number) => {
        settle(() => resolve({ stdout, stderr, code }))
      })
    })
  })
}

/**
 * Manages systemd services on remote servers via SSH.
 *
 * Stateless service — each method is a standalone request
 * that executes systemctl/journalctl commands over an existing SSH connection.
 */
export class ServiceManagerService {
  /**
   * Probe whether the remote server has systemd available.
   * @returns The systemd version string if available, or an error.
   */
  async probe(
    conn: SSHConnection
  ): Promise<{ success: boolean; systemdVersion?: string; error?: string }> {
    try {
      const { stdout, code } = await execCommand(
        conn,
        'systemctl --version 2>/dev/null | head -1'
      )

      if (code !== 0 || !stdout.trim()) {
        return { success: false, error: 'systemd is not available on this server' }
      }

      // Parse version from output like "systemd 252 (252.22-1~deb12u1)"
      const match = stdout.trim().match(/systemd\s+(\d+)/)
      const systemdVersion = match ? match[1] : stdout.trim()

      return { success: true, systemdVersion }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  /**
   * List all systemd services on the remote server.
   * @returns An array of SystemdService objects.
   */
  async listServices(
    conn: SSHConnection
  ): Promise<{ success: boolean; data?: SystemdService[]; error?: string }> {
    try {
      const { stdout, code } = await execCommand(
        conn,
        'systemctl list-units --type=service --all --no-pager --no-legend --plain'
      )

      if (code !== 0) {
        return { success: false, error: `systemctl exited with code ${code}` }
      }

      const services: SystemdService[] = []

      for (const line of stdout.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue

        // Format: UNIT LOAD ACTIVE SUB DESCRIPTION...
        const parts = trimmed.split(/\s+/)
        if (parts.length < 4) continue

        services.push({
          unit: parts[0],
          load: parts[1],
          active: parts[2],
          sub: parts[3],
          description: parts.slice(4).join(' ')
        })
      }

      return { success: true, data: services }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  /**
   * Get detailed information about a specific systemd service.
   * @param unit - The unit name (e.g. "nginx.service")
   * @returns Parsed ServiceDetails from `systemctl show`.
   */
  async getServiceDetails(
    conn: SSHConnection,
    unit: string
  ): Promise<{ success: boolean; data?: ServiceDetails; error?: string }> {
    if (!isValidUnitName(unit)) {
      return { success: false, error: 'Invalid unit name' }
    }

    try {
      const { stdout, code } = await execCommand(
        conn,
        `systemctl show ${unit} --no-pager`
      )

      if (code !== 0) {
        return { success: false, error: `systemctl show exited with code ${code}` }
      }

      // Parse Key=Value pairs
      const props = new Map<string, string>()
      for (const line of stdout.split('\n')) {
        const eqIdx = line.indexOf('=')
        if (eqIdx === -1) continue
        const key = line.substring(0, eqIdx)
        const value = line.substring(eqIdx + 1).trim()
        props.set(key, value)
      }

      const parseOptionalNumber = (val: string | undefined): number | undefined => {
        if (!val || val === '[not set]' || val === 'infinity') return undefined
        const n = Number(val)
        return Number.isFinite(n) ? n : undefined
      }

      const splitList = (val: string | undefined): string[] | undefined => {
        if (!val || val === '') return undefined
        const items = val.split(/\s+/).filter(Boolean)
        return items.length > 0 ? items : undefined
      }

      const details: ServiceDetails = {
        unit,
        description: props.get('Description') || '',
        loadState: props.get('LoadState') || '',
        activeState: props.get('ActiveState') || '',
        subState: props.get('SubState') || '',
        unitFileState: props.get('UnitFileState') || '',
        fragmentPath: props.get('FragmentPath') || '',
        mainPID: parseInt(props.get('MainPID') || '0', 10) || 0,
        execMainStartTimestamp: props.get('ExecMainStartTimestamp') || '',
        activeEnterTimestamp: props.get('ActiveEnterTimestamp') || '',
        inactiveEnterTimestamp: props.get('InactiveEnterTimestamp') || '',
        memoryCurrentBytes: parseOptionalNumber(props.get('MemoryCurrent')),
        cpuUsageNSec: parseOptionalNumber(props.get('CPUUsageNSec')),
        tasksCurrent: parseOptionalNumber(props.get('TasksCurrent')),
        restartCount: parseOptionalNumber(props.get('NRestarts')),
        type: props.get('Type') || undefined,
        requires: splitList(props.get('Requires')),
        wantedBy: splitList(props.get('WantedBy')),
        after: splitList(props.get('After')),
        before: splitList(props.get('Before'))
      }

      return { success: true, data: details }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  /**
   * Perform a systemctl action on a service unit.
   * @param unit - The unit name (e.g. "nginx.service")
   * @param action - The action to perform (start, stop, restart, etc.)
   */
  async performAction(
    conn: SSHConnection,
    unit: string,
    action: ServiceAction
  ): Promise<{ success: boolean; error?: string }> {
    if (!isValidUnitName(unit)) {
      return { success: false, error: 'Invalid unit name' }
    }

    if (!VALID_ACTIONS.has(action)) {
      return { success: false, error: `Invalid action: ${action}` }
    }

    try {
      const { stderr, code } = await execCommand(
        conn,
        `sudo systemctl ${action} ${unit} 2>&1`
      )

      if (code === 0) {
        return { success: true }
      }

      return { success: false, error: stderr.trim() || `Exit code ${code}` }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  /**
   * Retrieve journal logs for a systemd service.
   * @param unit - The unit name (e.g. "nginx.service")
   * @param lines - Number of log lines to retrieve (max 10000, default 100)
   * @param since - Optional time filter (e.g. "1 hour ago", "2024-01-01 00:00:00")
   * @returns Parsed log entries.
   */
  async getLogs(
    conn: SSHConnection,
    unit: string,
    lines: number = 100,
    since?: string
  ): Promise<{ success: boolean; data?: ServiceLogEntry[]; error?: string }> {
    if (!isValidUnitName(unit)) {
      return { success: false, error: 'Invalid unit name' }
    }

    if (!Number.isInteger(lines) || lines < 1 || lines > 10000) {
      return { success: false, error: 'Lines must be a positive integer ≤ 10000' }
    }

    // Validate since format — allow alphanumeric, spaces, colons, dashes (max 64 chars)
    if (since !== undefined && (since.length > 64 || !/^[a-zA-Z0-9 :._-]+$/.test(since))) {
      return { success: false, error: 'Invalid since parameter' }
    }

    try {
      // Try JSON output first
      let cmd = `journalctl -u ${unit} --no-pager -n ${lines} --output=json`
      if (since) {
        cmd += ` --since="${since}"`
      }

      const result = await execCommand(conn, cmd)

      if (result.code === 0 && result.stdout.trim()) {
        const entries = this.parseJsonLogs(result.stdout)
        if (entries.length > 0) {
          return { success: true, data: entries }
        }
      }

      // Fallback to plain text if JSON output is unavailable or empty
      let fallbackCmd = `journalctl -u ${unit} --no-pager -n ${lines}`
      if (since) {
        fallbackCmd += ` --since="${since}"`
      }

      const fallback = await execCommand(conn, fallbackCmd)

      if (fallback.code !== 0) {
        return {
          success: false,
          error: fallback.stderr.trim() || `journalctl exited with code ${fallback.code}`
        }
      }

      const entries = this.parsePlainLogs(fallback.stdout, unit)
      return { success: true, data: entries }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  // ── Private helpers ──

  /**
   * Parse journalctl JSON output (one JSON object per line).
   */
  private parseJsonLogs(output: string): ServiceLogEntry[] {
    const entries: ServiceLogEntry[] = []

    for (const line of output.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue

      try {
        const obj = JSON.parse(trimmed)

        // __REALTIME_TIMESTAMP is microseconds since epoch
        const usec = parseInt(obj.__REALTIME_TIMESTAMP, 10)
        const timestamp = Number.isFinite(usec)
          ? new Date(usec / 1000).toISOString()
          : new Date().toISOString()

        const priorityStr = String(obj.PRIORITY ?? '6')
        const priority = PRIORITY_MAP[priorityStr] || priorityStr

        entries.push({
          timestamp,
          priority,
          message: String(obj.MESSAGE ?? ''),
          unit: obj._SYSTEMD_UNIT || undefined
        })
      } catch {
        // Skip unparseable lines
      }
    }

    return entries
  }

  /**
   * Parse plain-text journalctl output as a fallback.
   * Format: "Mon DD HH:MM:SS hostname unit[pid]: message"
   */
  private parsePlainLogs(output: string, unit: string): ServiceLogEntry[] {
    const entries: ServiceLogEntry[] = []

    for (const line of output.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('--')) continue

      // Best-effort parse: first 15 chars are typically the timestamp
      // e.g. "Jan 01 12:00:00 hostname sshd[1234]: message here"
      const match = trimmed.match(/^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+\S+\s+\S+:\s*(.*)$/)

      entries.push({
        timestamp: match ? match[1] : '',
        priority: 'info',
        message: match ? match[2] : trimmed,
        unit
      })
    }

    return entries
  }
}
