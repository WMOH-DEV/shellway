import type { BrowserWindow } from 'electron'
import type { SSHConnection } from './SSHService'
import type {
  MonitorRawData,
  MonitorSnapshot,
  MonitorStatus,
  CpuJiffies
} from '../../src/types/monitor'

/**
 * Build the monitoring shell script as a plain string array joined with semicolons.
 * This avoids template literal escaping issues entirely.
 * All shell variables use $var (no braces) where possible.
 *
 * The script uses awk for JSON construction — it's safer and handles
 * special characters better than shell string concatenation.
 */
function buildFastPollScript(): string {
  // Each line is a separate shell statement joined with newlines
  const lines = [
    // Suppress errors (but we also capture stderr separately)
    'exec 2>/dev/null',
    // Safety net for zsh: unmatched globs should pass literally, not abort
    'setopt nonomatch 2>/dev/null || true',
    'p=/proc',

    // CPU aggregate (first line of /proc/stat)
    'read -r _ cu ni sy id io ir si st _ < $p/stat',

    // Per-core CPU — use awk for safe JSON construction
    'cores=$(awk \'BEGIN{printf "["} /^cpu[0-9]/{if(NR>2)printf ","; printf "{\\\"us\\\":%s,\\\"ni\\\":%s,\\\"sy\\\":%s,\\\"id\\\":%s,\\\"io\\\":%s,\\\"ir\\\":%s,\\\"si\\\":%s,\\\"st\\\":%s}",$2,$3,$4,$5,$6,$7,$8,$9} END{printf "]"}\' $p/stat)',

    // Memory — use awk to parse /proc/meminfo
    'eval $(awk -F\'[: ]+\' \'/^MemTotal/{printf "mt=%s;",$2} /^MemAvailable/{printf "ma=%s;",$2} /^MemFree/{printf "mf=%s;",$2} /^Buffers/{printf "mb=%s;",$2} /^Cached:/{printf "mc=%s;",$2} /^SwapTotal/{printf "st_t=%s;",$2} /^SwapFree/{printf "sf=%s;",$2}\' $p/meminfo)',

    // Load
    'read -r l1 l5 l15 _ < $p/loadavg',

    // Uptime
    'read -r up _ < $p/uptime',

    // Hostname & kernel (safe — only alphanumeric/dots/dashes expected)
    'read -r hn < $p/sys/kernel/hostname',
    'read -r kr < $p/sys/kernel/osrelease',

    // CPU count
    'cc=$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || grep -c ^processor $p/cpuinfo 2>/dev/null || echo 1)',

    // Network — use awk for safe JSON
    'ns=$(awk \'BEGIN{printf "["} NR>2{gsub(/:/,"",$1); if(n++)printf ","; printf "{\\\"if\\\":\\\"%s\\\",\\\"rx\\\":%s,\\\"tx\\\":%s}",$1,$2,$10} END{printf "]"}\' $p/net/dev)',

    // Disk I/O from /proc/diskstats — use awk
    'dio=$(awk \'{n=$3; if(n~/^(loop|ram|dm-)/ || n~/[0-9]$/ && n!~/^nvme[0-9]+n[0-9]+$/) next; if(c++)printf ","; printf "{\\\"dev\\\":\\\"%s\\\",\\\"reads\\\":%s,\\\"writes\\\":%s}",n,$6,$10}\' $p/diskstats)',
    'dio="[$dio]"',

    // Output JSON using printf — safe because all string values are from /proc (no user-controlled data with special chars)
    'printf \'{"cpu":{"us":%s,"ni":%s,"sy":%s,"id":%s,"io":%s,"ir":%s,"si":%s,"st":%s},"cores":%s,"mem":{"total":%s,"avail":%s,"free":%s,"buffers":%s,"cached":%s,"swapTotal":%s,"swapFree":%s},"load":[%s,%s,%s],"uptime":%s,"hostname":"%s","kernel":"%s","cpuCount":%s,"net":%s,"diskio":%s,"disks":[],"procs":[]}\\n\' "$cu" "$ni" "$sy" "$id" "$io" "$ir" "$si" "$st" "$cores" "$mt" "${ma:-0}" "$mf" "$mb" "$mc" "${st_t:-0}" "${sf:-0}" "$l1" "$l5" "$l15" "$up" "$hn" "$kr" "$cc" "$ns" "$dio"',
  ]
  return lines.join('\n')
}

function buildFullPollScript(): string {
  const lines = [
    // NOTE: No exec 2>/dev/null here — we capture stderr in JS for diagnostics.
    // Individual commands that may fail have their own 2>/dev/null.
    // Safety net for zsh: unmatched globs should pass literally, not abort
    'setopt nonomatch 2>/dev/null || true',
    'p=/proc',

    // CPU aggregate
    'read -r _ cu ni sy id io ir si st _ < $p/stat',

    // Per-core CPU
    'cores=$(awk \'BEGIN{printf "["} /^cpu[0-9]/{if(NR>2)printf ","; printf "{\\\"us\\\":%s,\\\"ni\\\":%s,\\\"sy\\\":%s,\\\"id\\\":%s,\\\"io\\\":%s,\\\"ir\\\":%s,\\\"si\\\":%s,\\\"st\\\":%s}",$2,$3,$4,$5,$6,$7,$8,$9} END{printf "]"}\' $p/stat)',

    // Memory
    'eval $(awk -F\'[: ]+\' \'/^MemTotal/{printf "mt=%s;",$2} /^MemAvailable/{printf "ma=%s;",$2} /^MemFree/{printf "mf=%s;",$2} /^Buffers/{printf "mb=%s;",$2} /^Cached:/{printf "mc=%s;",$2} /^SwapTotal/{printf "st_t=%s;",$2} /^SwapFree/{printf "sf=%s;",$2}\' $p/meminfo)',

    // Load, uptime, hostname, kernel
    'read -r l1 l5 l15 _ < $p/loadavg',
    'read -r up _ < $p/uptime',
    'read -r hn < $p/sys/kernel/hostname',
    'read -r kr < $p/sys/kernel/osrelease',

    // CPU count and model
    'cc=$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || grep -c ^processor $p/cpuinfo 2>/dev/null || echo 1)',
    // CPU model — sanitize quotes (single-quoted sed to avoid " breaking shell double-quoting)
    'cm=$(grep -m1 "model name" $p/cpuinfo 2>/dev/null | cut -d: -f2 | sed \'s/^ //;s/["\\\\]//g\' || echo "")',
    // OS name — sanitize quotes (single-quoted sed)
    'os=$(. /etc/os-release 2>/dev/null && printf "%s" "$PRETTY_NAME" | sed \'s/["\\\\]//g\' || cat /etc/redhat-release 2>/dev/null | sed \'s/["\\\\]//g\' || echo "Linux")',

    // Network
    'ns=$(awk \'BEGIN{printf "["} NR>2{gsub(/:/,"",$1); if(n++)printf ","; printf "{\\\"if\\\":\\\"%s\\\",\\\"rx\\\":%s,\\\"tx\\\":%s}",$1,$2,$10} END{printf "]"}\' $p/net/dev)',

    // Disk I/O
    'dio=$(awk \'{n=$3; if(n~/^(loop|ram|dm-)/ || n~/[0-9]$/ && n!~/^nvme[0-9]+n[0-9]+$/) next; if(c++)printf ","; printf "{\\\"dev\\\":\\\"%s\\\",\\\"reads\\\":%s,\\\"writes\\\":%s}",n,$6,$10}\' $p/diskstats)',
    'dio="[$dio]"',

    // Disk usage — use awk for JSON (handles spaces in mount paths)
    'ds=$(df -P -x tmpfs -x devtmpfs -x squashfs -x overlay -x efivarfs 2>/dev/null | awk \'NR>1{sz=$2*1024;us=$3*1024;av=$4*1024;fs=$1;mp="";for(i=6;i<=NF;i++){if(i>6)mp=mp" ";mp=mp$i};gsub(/[\"\\\\]/,"",fs);gsub(/[\"\\\\]/,"",mp);if(c++)printf ",";printf "{\\\"fs\\\":\\\"%s\\\",\\\"type\\\":\\\"\\\",\\\"size\\\":%s,\\\"used\\\":%s,\\\"avail\\\":%s,\\\"mount\\\":\\\"%s\\\"}",fs,sz,us,av,mp}\')',
    'ds="[${ds:-}]"',

    // Processes (top 20 by CPU)
    'tp=$(ps -eo pid,pcpu,pmem,rss,user,comm --sort=-pcpu --no-headers 2>/dev/null | head -20 | awk \'{gsub(/[\"\\\\]/,"",$5);gsub(/[\"\\\\]/,"",$6);if(c++)printf ",";printf "{\\\"pid\\\":%s,\\\"cpu\\\":%.1f,\\\"mem\\\":%.1f,\\\"rss\\\":%s,\\\"user\\\":\\\"%s\\\",\\\"name\\\":\\\"%s\\\"}",$1,$2,$3,$4,$5,$6}\')',
    'tp="[${tp:-}]"',

    // Services (systemd)
    'sv="[]"',
    'if command -v systemctl >/dev/null 2>&1; then sv=$(systemctl list-units --type=service --no-pager --plain --no-legend 2>/dev/null | head -50 | awk \'{unit=$1;sub(/\\.service$/,"",unit);gsub(/[\"\\\\]/,"",unit);load=$2;act=$3;sub_=$4;desc="";for(i=5;i<=NF;i++){if(i>5)desc=desc" ";desc=desc$i};gsub(/[\"\\\\]/,"",desc);if(c++)printf ",";printf "{\\\"name\\\":\\\"%s\\\",\\\"load\\\":\\\"%s\\\",\\\"active\\\":\\\"%s\\\",\\\"sub\\\":\\\"%s\\\",\\\"desc\\\":\\\"%s\\\"}",unit,load,act,sub_,desc}\'); sv="[$sv]"; fi',

    // Docker
    'dk="[]"',
    'if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then dk=$(docker stats --no-stream --format "{{.ID}}\\t{{.Name}}\\t{{.CPUPerc}}\\t{{.MemUsage}}" 2>/dev/null | awk -F"\\t" \'{cpu=$3;sub(/%/,"",cpu);gsub(/[\"\\\\]/,"",$2);if(c++)printf ",";printf "{\\\"id\\\":\\\"%s\\\",\\\"name\\\":\\\"%s\\\",\\\"cpu\\\":%s,\\\"mem\\\":0,\\\"memLimit\\\":0,\\\"image\\\":\\\"\\\",\\\"status\\\":\\\"running\\\",\\\"netIn\\\":0,\\\"netOut\\\":0}",$1,$2,cpu+0}\'); dk="[$dk]"; fi',

    // Temperatures — use find instead of glob to avoid zsh NOMATCH fatal error on VPS without thermal zones
    'temps=""',
    'for tz in $(find /sys/class/thermal -name temp -path "*/thermal_zone*" 2>/dev/null); do [ -r "$tz" ] || continue; t=$(cat "$tz" 2>/dev/null || echo 0); label=$(cat "${tz%temp}type" 2>/dev/null || echo zone); label=$(echo "$label" | tr -d \'\\"\\\\\'); if [ -n "$temps" ]; then temps="$temps,"; fi; temps="$temps{\\\"label\\\":\\\"$label\\\",\\\"temp\\\":$t}"; done',
    'temps="[$temps]"',

    // Listening ports
    'ports="[]"',
    'if command -v ss >/dev/null 2>&1; then ports=$(ss -tlnp 2>/dev/null | awk \'NR>1{local=$4;gsub(/[\"\\\\]/,"",local);pid=0;proc="";if(match($0,/pid=([0-9]+)/)){pid=substr($0,RSTART+4,RLENGTH-4)};if(match($0,/\\(\"([^\"]+)\"/)){proc=substr($0,RSTART+2,RLENGTH-3)};gsub(/[\"\\\\]/,"",proc);if(c++)printf ",";printf "{\\\"proto\\\":\\\"tcp\\\",\\\"local\\\":\\\"%s\\\",\\\"pid\\\":%d,\\\"process\\\":\\\"%s\\\"}",local,pid,proc}\'); ports="[$ports]"; fi',

    // Failed SSH logins (last 24h)
    // NOTE: grep -c outputs "0" but exits with code 1 when no matches → || echo 0 would add a second "0" line, breaking JSON.
    // Use || true to swallow the non-zero exit without extra output, then ${fl:-0} ensures a safe fallback.
    'fl=0',
    'if command -v journalctl >/dev/null 2>&1; then fl=$(journalctl -u sshd -u ssh --since "24 hours ago" --no-pager -q 2>/dev/null | grep -c "Failed password" 2>/dev/null || true); fl=${fl:-0}; fi',

    // Active SSH sessions
    'ss_list=$(w -h 2>/dev/null | head -10 | awk \'{gsub(/[\"\\\\]/,"",$1);gsub(/[\"\\\\]/,"",$3);gsub(/[\"\\\\]/,"",$4);if(c++)printf ",";printf "{\\\"user\\\":\\\"%s\\\",\\\"from\\\":\\\"%s\\\",\\\"loginTime\\\":\\\"%s\\\"}",$1,$3,$4}\')',
    'ss_list="[${ss_list:-}]"',

    // Sanitize string vars that go into JSON quoted fields (strip \ and " and control chars)
    'hn=$(printf "%s" "$hn" | tr -d \'\\"\\\\\' | tr -d \'\\000-\\037\')',
    'kr=$(printf "%s" "$kr" | tr -d \'\\"\\\\\' | tr -d \'\\000-\\037\')',

    // Output JSON
    'printf \'{"cpu":{"us":%s,"ni":%s,"sy":%s,"id":%s,"io":%s,"ir":%s,"si":%s,"st":%s},"cores":%s,"mem":{"total":%s,"avail":%s,"free":%s,"buffers":%s,"cached":%s,"swapTotal":%s,"swapFree":%s},"load":[%s,%s,%s],"uptime":%s,"hostname":"%s","kernel":"%s","cpuCount":%s,"cpuModel":"%s","os":"%s","net":%s,"diskio":%s,"disks":%s,"procs":%s,"services":%s,"docker":%s,"temps":%s,"ports":%s,"failedLogins":%s,"sshSessions":%s}\\n\' "$cu" "$ni" "$sy" "$id" "$io" "$ir" "$si" "$st" "$cores" "$mt" "${ma:-0}" "$mf" "$mb" "$mc" "${st_t:-0}" "${sf:-0}" "$l1" "$l5" "$l15" "$up" "$hn" "$kr" "$cc" "$cm" "$os" "$ns" "$dio" "$ds" "$tp" "$sv" "$dk" "$temps" "$ports" "$fl" "$ss_list"',
  ]
  return lines.join('\n')
}

/** Simple probe command to verify /proc exists and exec works */
const PROBE_COMMAND = 'cat /proc/loadavg'

/** Per-connection monitoring state */
interface MonitorState {
  timer: ReturnType<typeof setInterval> | null
  pollInFlight: boolean
  pollCount: number
  missedPolls: number
  consecutiveTimeouts: number
  consecutiveParseErrors: number
  currentInterval: number
  previousCpuJiffies: CpuJiffies | null
  previousCoreJiffies: CpuJiffies[] | null
  previousNetCounters: Map<string, { rx: number; tx: number }> | null
  previousDiskCounters: Map<string, { reads: number; writes: number }> | null
  previousTimestamp: number | null
  history: MonitorSnapshot[]
  win: BrowserWindow | null
  status: MonitorStatus
  probed: boolean
  /** Cached extended data from the last successful full poll */
  lastFullSnapshot: MonitorSnapshot | null
}

const DEFAULT_INTERVAL = 3000
const FULL_POLL_EVERY = 10  // Every 10th poll is a full poll (every 30s)
const HISTORY_MAX = 300     // ~15 min at 3s intervals
const POLL_TIMEOUT = 8000
const MAX_INTERVAL = 30000

// Build scripts once at module load
const FAST_POLL_SCRIPT = buildFastPollScript()
const FULL_POLL_SCRIPT = buildFullPollScript()

/**
 * Collects server metrics over SSH by executing shell scripts that read /proc.
 *
 * Two script variants:
 * - Fast poll (every 3s): CPU, memory, load, network — /proc reads only
 * - Full poll (every 30s): Everything + df, ps, systemctl, docker, security
 *
 * Polling is demand-driven: starts when user opens Monitor tab, stops when they leave.
 */
export class MonitorService {
  private states = new Map<string, MonitorState>()

  /**
   * Start monitoring a connection.
   * First runs a probe command to verify the server supports monitoring.
   */
  startMonitoring(conn: SSHConnection, win: BrowserWindow): void {
    // If already monitoring this connection, just update the window reference
    const existing = this.states.get(conn.id)
    if (existing) {
      existing.win = win
      if (existing.status === 'stopped') {
        existing.status = 'active'
        this.sendStatus(conn.id)
        this.startTimer(conn)
      }
      return
    }

    const state: MonitorState = {
      timer: null,
      pollInFlight: false,
      pollCount: 0,
      missedPolls: 0,
      consecutiveTimeouts: 0,
      consecutiveParseErrors: 0,
      currentInterval: DEFAULT_INTERVAL,
      previousCpuJiffies: null,
      previousCoreJiffies: null,
      previousNetCounters: null,
      previousDiskCounters: null,
      previousTimestamp: null,
      history: [],
      win,
      status: 'active',
      probed: false,
      lastFullSnapshot: null
    }

    this.states.set(conn.id, state)

    // Probe first, then start polling
    this.probe(conn)
  }

  /**
   * Stop monitoring (but keep history for resuming).
   */
  stopMonitoring(connectionId: string): void {
    const state = this.states.get(connectionId)
    if (!state) return

    if (state.timer) {
      clearInterval(state.timer)
      state.timer = null
    }
    state.status = 'stopped'
    state.pollInFlight = false
    this.sendStatus(connectionId)
  }

  /**
   * Fully remove monitoring state (on disconnect).
   */
  removeMonitoring(connectionId: string): void {
    const state = this.states.get(connectionId)
    if (state) {
      if (state.timer) clearInterval(state.timer)
      this.states.delete(connectionId)
    }
  }

  /**
   * Get the latest snapshot for a connection.
   */
  getLatest(connectionId: string): MonitorSnapshot | null {
    const state = this.states.get(connectionId)
    if (!state || state.history.length === 0) return null
    return state.history[state.history.length - 1]
  }

  /**
   * Get full history for a connection.
   */
  getHistory(connectionId: string): MonitorSnapshot[] {
    const state = this.states.get(connectionId)
    return state ? [...state.history] : []
  }

  /**
   * Get monitor status.
   */
  getStatus(connectionId: string): MonitorStatus {
    const state = this.states.get(connectionId)
    return state?.status ?? 'stopped'
  }

  /**
   * Kill a process on the remote server.
   * @param signal - 15 = SIGTERM (graceful), 9 = SIGKILL (force)
   */
  killProcess(
    conn: SSHConnection,
    pid: number,
    signal: number = 15
  ): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      // Validate PID to prevent injection
      if (!Number.isInteger(pid) || pid < 1) {
        return resolve({ success: false, error: 'Invalid PID' })
      }
      const safeSignal = signal === 9 ? 9 : 15

      conn._client.exec(
        `kill -${safeSignal} ${pid} 2>&1`,
        (err: Error | undefined, stream: any) => {
          if (err) return resolve({ success: false, error: err.message })

          let stderr = ''
          stream.on('data', (d: Buffer) => { stderr += d.toString() })
          stream.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

          stream.on('close', (code: number) => {
            if (code === 0) resolve({ success: true })
            else resolve({ success: false, error: stderr.trim() || `Exit code ${code}` })
          })
        }
      )
    })
  }

  /**
   * Stop all monitoring (app shutdown).
   */
  stopAll(): void {
    for (const [id] of this.states) {
      this.removeMonitoring(id)
    }
  }

  // ── Private ──

  /**
   * Probe the server with a simple command to verify /proc exists.
   */
  private probe(conn: SSHConnection): void {
    const state = this.states.get(conn.id)
    if (!state || conn.status !== 'connected') return

    conn._client.exec(PROBE_COMMAND, (err: Error | undefined, stream: any) => {
      if (err) {
        state.status = 'error'
        this.sendError(conn.id, `Cannot execute commands on server: ${err.message}`)
        this.sendStatus(conn.id)
        return
      }

      let output = ''
      let stderrOutput = ''

      stream.on('data', (data: Buffer) => { output += data.toString() })
      stream.stderr.on('data', (data: Buffer) => { stderrOutput += data.toString() })

      stream.on('close', (code: number) => {
        if (output.trim()) {
          // Probe succeeded — /proc exists and exec works
          state.probed = true
          // Do an immediate full poll, then start timer
          this.poll(conn, true)
          this.startTimer(conn)
        } else {
          // Probe failed — server doesn't have /proc
          state.status = 'unsupported'
          const detail = stderrOutput.trim() || (code !== 0 ? `exit code ${code}` : 'no /proc filesystem')
          this.sendError(conn.id, `Server does not support monitoring: ${detail}`)
          this.sendStatus(conn.id)
        }
      })
    })
  }

  private startTimer(conn: SSHConnection): void {
    const state = this.states.get(conn.id)
    if (!state) return
    if (state.timer) clearInterval(state.timer)

    state.timer = setInterval(() => {
      if (conn.status !== 'connected') return
      state.pollCount++
      const isFull = state.pollCount % FULL_POLL_EVERY === 0
      this.poll(conn, isFull)
    }, state.currentInterval)
  }

  private poll(conn: SSHConnection, full: boolean): void {
    const state = this.states.get(conn.id)
    if (!state) return

    // Overlap prevention
    if (state.pollInFlight) {
      state.missedPolls++
      if (state.missedPolls > 3) {
        console.warn(`[Monitor] ${conn.id}: missed ${state.missedPolls} polls — connection may be slow`)
      }
      return
    }

    if (conn.status !== 'connected') return

    state.pollInFlight = true
    state.missedPolls = 0

    const script = full ? FULL_POLL_SCRIPT : FAST_POLL_SCRIPT

    if (full) {
      console.log(`[Monitor] ${conn.id}: running full poll (${script.length} bytes)`)
    }

    // Set a timeout to abort slow polls
    let timedOut = false
    const timeoutHandle = setTimeout(() => {
      timedOut = true
      state.pollInFlight = false
      state.consecutiveTimeouts++

      // Adaptive backoff
      if (state.consecutiveTimeouts >= 3) {
        state.currentInterval = Math.min(state.currentInterval * 2, MAX_INTERVAL)
        this.startTimer(conn) // Restart timer with new interval
      }

      state.status = 'stale'
      this.sendStatus(conn.id)
    }, POLL_TIMEOUT)

    let output = ''
    let stderrOutput = ''

    conn._client.exec(script, (err: Error | undefined, stream: any) => {
      if (err) {
        clearTimeout(timeoutHandle)
        state.pollInFlight = false
        state.status = 'error'
        this.sendError(conn.id, err.message)
        this.sendStatus(conn.id)
        return
      }

      stream.on('data', (data: Buffer) => {
        if (!timedOut) output += data.toString()
      })

      stream.stderr.on('data', (data: Buffer) => {
        if (!timedOut) stderrOutput += data.toString()
      })

      stream.on('close', () => {
        clearTimeout(timeoutHandle)
        if (timedOut) return

        state.pollInFlight = false
        state.consecutiveTimeouts = 0

        // Reset interval if we were backed off
        if (state.currentInterval > DEFAULT_INTERVAL) {
          state.currentInterval = DEFAULT_INTERVAL
          this.startTimer(conn)
        }

        try {
          const raw: MonitorRawData = JSON.parse(output.trim())
          state.consecutiveParseErrors = 0
          const snapshot = this.processRawData(conn.id, raw)

          if (full) {
            // Full poll — cache extended data for fast poll carry-forward
            state.lastFullSnapshot = snapshot
          } else if (state.lastFullSnapshot) {
            // Fast poll — carry forward extended data from last full poll
            const prev = state.lastFullSnapshot
            if (snapshot.processes.length === 0 && prev.processes.length > 0) snapshot.processes = prev.processes
            if (snapshot.disks.length === 0 && prev.disks.length > 0) snapshot.disks = prev.disks
            if (!snapshot.services && prev.services) snapshot.services = prev.services
            if (!snapshot.docker && prev.docker) snapshot.docker = prev.docker
            if (!snapshot.temperatures && prev.temperatures) snapshot.temperatures = prev.temperatures
            if (!snapshot.listeningPorts && prev.listeningPorts) snapshot.listeningPorts = prev.listeningPorts
            if (snapshot.failedSSHLogins === undefined) snapshot.failedSSHLogins = prev.failedSSHLogins
            if (!snapshot.activeSessions && prev.activeSessions) snapshot.activeSessions = prev.activeSessions
            if (!snapshot.cpuModel && prev.cpuModel) snapshot.cpuModel = prev.cpuModel
            if (!snapshot.os && prev.os) snapshot.os = prev.os
          }

          this.pushSnapshot(conn.id, snapshot)
        } catch (parseErr: any) {
          state.consecutiveParseErrors++
          const errDetail = stderrOutput.trim()
          const outputPreview = output.trim().substring(0, 500)

          // Extract error position and show context around it
          const posMatch = parseErr.message?.match(/position (\d+)/)
          let context = ''
          if (posMatch) {
            const pos = parseInt(posMatch[1])
            const start = Math.max(0, pos - 60)
            context = `\n  context[${pos}]: ...${output.substring(start, pos + 60)}...`
          }

          console.warn(`[Monitor] ${conn.id}: ${full ? 'FULL' : 'fast'} poll parse error #${state.consecutiveParseErrors}`,
            parseErr,
            errDetail ? `\n  stderr: ${errDetail.substring(0, 1000)}` : '',
            outputPreview ? `\n  stdout(${output.length}): ${outputPreview}` : '(empty output)',
            context)

          // After 3 consecutive parse errors, report to user and stop
          if (state.consecutiveParseErrors >= 3) {
            state.status = 'error'
            const msg = errDetail
              ? `Monitoring script error: ${errDetail.substring(0, 200)}`
              : outputPreview
                ? `Monitoring returned invalid data: ${outputPreview.substring(0, 100)}`
                : 'Monitoring script produced no output. The server shell may not support the required commands.'
            this.sendError(conn.id, msg)
            this.sendStatus(conn.id)
            this.stopMonitoring(conn.id)
          }
        }
      })
    })
  }

  private processRawData(connectionId: string, raw: MonitorRawData): MonitorSnapshot {
    const state = this.states.get(connectionId)!
    const now = Date.now()
    const elapsed = state.previousTimestamp ? (now - state.previousTimestamp) / 1000 : 3

    // ── CPU % (delta-based) ──
    const currentJiffies = this.extractJiffies(raw.cpu)
    let cpuPercent = 0
    let cpuBreakdown = { user: 0, system: 0, iowait: 0, steal: 0, nice: 0, irq: 0 }

    if (state.previousCpuJiffies) {
      const prev = state.previousCpuJiffies
      const totalDelta = currentJiffies.total - prev.total
      if (totalDelta > 0) {
        cpuPercent = 100 * (1 - (currentJiffies.idle - prev.idle) / totalDelta)
        cpuBreakdown = {
          user: 100 * (currentJiffies.user - prev.user) / totalDelta,
          system: 100 * (currentJiffies.system - prev.system) / totalDelta,
          iowait: 100 * (currentJiffies.iowait - prev.iowait) / totalDelta,
          steal: 100 * (currentJiffies.steal - prev.steal) / totalDelta,
          nice: 100 * (currentJiffies.nice - prev.nice) / totalDelta,
          irq: 100 * ((currentJiffies.irq + currentJiffies.softirq) - (prev.irq + prev.softirq)) / totalDelta
        }
      }
    }
    state.previousCpuJiffies = currentJiffies

    // ── Per-core CPU ──
    let perCoreCpu: number[] | undefined
    if (raw.cores && raw.cores.length > 0) {
      const currentCoreJiffies = raw.cores.map(c => this.extractJiffies(c))
      if (state.previousCoreJiffies && state.previousCoreJiffies.length === currentCoreJiffies.length) {
        perCoreCpu = currentCoreJiffies.map((cur, i) => {
          const prev = state.previousCoreJiffies![i]
          const td = cur.total - prev.total
          return td > 0 ? 100 * (1 - (cur.idle - prev.idle) / td) : 0
        })
      }
      state.previousCoreJiffies = currentCoreJiffies
    }

    // ── Memory ──
    const KB = 1024
    const memTotal = raw.mem.total * KB
    const memAvail = (raw.mem.avail || (raw.mem.free + raw.mem.buffers + raw.mem.cached)) * KB
    const memUsed = memTotal - memAvail
    const swapTotal = raw.mem.swapTotal * KB
    const swapUsed = (raw.mem.swapTotal - raw.mem.swapFree) * KB

    // ── Network (delta-based) ──
    const netInterfaces: MonitorSnapshot['netInterfaces'] = []
    const newNetCounters = new Map<string, { rx: number; tx: number }>()

    for (const iface of raw.net) {
      newNetCounters.set(iface.if, { rx: iface.rx, tx: iface.tx })
      let rxPerSec = 0
      let txPerSec = 0

      if (state.previousNetCounters) {
        const prev = state.previousNetCounters.get(iface.if)
        if (prev && elapsed > 0) {
          rxPerSec = Math.max(0, (iface.rx - prev.rx) / elapsed)
          txPerSec = Math.max(0, (iface.tx - prev.tx) / elapsed)
        }
      }

      netInterfaces.push({
        name: iface.if,
        rxBytesPerSec: rxPerSec,
        txBytesPerSec: txPerSec,
        rxTotalBytes: iface.rx,
        txTotalBytes: iface.tx
      })
    }
    state.previousNetCounters = newNetCounters

    // ── Disk I/O (delta-based) ──
    let diskIO: MonitorSnapshot['diskIO']
    if (raw.diskio && raw.diskio.length > 0) {
      const newDiskCounters = new Map<string, { reads: number; writes: number }>()
      diskIO = []

      for (const d of raw.diskio) {
        newDiskCounters.set(d.dev, { reads: d.reads, writes: d.writes })
        let rps = 0
        let wps = 0

        if (state.previousDiskCounters) {
          const prev = state.previousDiskCounters.get(d.dev)
          if (prev && elapsed > 0) {
            // sectors are typically 512 bytes
            rps = Math.max(0, ((d.reads - prev.reads) * 512) / elapsed)
            wps = Math.max(0, ((d.writes - prev.writes) * 512) / elapsed)
          }
        }

        diskIO.push({ device: d.dev, readBytesPerSec: rps, writeBytesPerSec: wps })
      }
      state.previousDiskCounters = newDiskCounters
    }

    // ── Disks ──
    const disks = raw.disks.map(d => ({
      filesystem: d.fs,
      type: d.type,
      sizeBytes: d.size,
      usedBytes: d.used,
      availBytes: d.avail,
      mountpoint: d.mount,
      usedPercent: d.size > 0 ? (d.used / d.size) * 100 : 0
    }))

    // ── Processes ──
    const processes = raw.procs.map(p => ({
      pid: p.pid,
      cpuPercent: p.cpu,
      memPercent: p.mem,
      rssBytes: p.rss * KB,
      user: p.user,
      name: p.name
    }))

    // ── Services ──
    const services = raw.services?.map(s => ({
      name: s.name,
      isLoaded: s.load === 'loaded',
      active: s.active as MonitorSnapshot['services'] extends Array<infer U> ? U extends { active: infer A } ? A : string : string,
      sub: s.sub,
      description: s.desc
    }))

    // ── Docker ──
    const docker = raw.docker?.map(d => ({
      id: d.id,
      name: d.name,
      image: d.image,
      status: d.status,
      cpuPercent: d.cpu,
      memUsageBytes: d.mem,
      memLimitBytes: d.memLimit,
      netInBytes: d.netIn,
      netOutBytes: d.netOut
    }))

    // ── Temperature ──
    const temperatures = raw.temps?.map(t => ({
      label: t.label,
      celsius: t.temp / 1000  // millidegrees to degrees
    }))

    // ── Security ──
    const listeningPorts = raw.ports?.map(p => ({
      protocol: p.proto,
      localAddress: p.local,
      pid: p.pid,
      processName: p.process
    }))

    const activeSessions = raw.sshSessions?.map(s => ({
      user: s.user,
      from: s.from,
      loginTime: s.loginTime
    }))

    state.previousTimestamp = now
    state.status = 'active'

    return {
      timestamp: now,
      cpuPercent: Math.max(0, Math.min(100, cpuPercent)),
      cpuBreakdown,
      perCoreCpu,
      memTotalBytes: memTotal,
      memUsedBytes: memUsed,
      memAvailableBytes: memAvail,
      memCachedBytes: raw.mem.cached * KB,
      memBuffersBytes: raw.mem.buffers * KB,
      memUsedPercent: memTotal > 0 ? (memUsed / memTotal) * 100 : 0,
      swapTotalBytes: swapTotal,
      swapUsedBytes: swapUsed,
      swapUsedPercent: swapTotal > 0 ? (swapUsed / swapTotal) * 100 : 0,
      load: raw.load,
      uptime: raw.uptime,
      hostname: raw.hostname,
      kernel: raw.kernel,
      cpuCount: raw.cpuCount,
      cpuModel: raw.cpuModel,
      os: raw.os,
      disks,
      diskIO,
      netInterfaces,
      processes,
      services,
      docker,
      temperatures,
      listeningPorts,
      failedSSHLogins: raw.failedLogins,
      activeSessions
    }
  }

  private extractJiffies(cpu: MonitorRawData['cpu']): CpuJiffies {
    const user = cpu.us
    const nice = cpu.ni
    const system = cpu.sy
    const idle = cpu.id
    const iowait = cpu.io
    const irq = cpu.ir
    const softirq = cpu.si
    const steal = cpu.st
    const total = user + nice + system + idle + iowait + irq + softirq + steal

    return { user, nice, system, idle, iowait, irq, softirq, steal, total }
  }

  private pushSnapshot(connectionId: string, snapshot: MonitorSnapshot): void {
    const state = this.states.get(connectionId)
    if (!state) return

    state.history.push(snapshot)
    if (state.history.length > HISTORY_MAX) {
      state.history.shift()
    }

    // Send to renderer
    if (state.win && !state.win.isDestroyed()) {
      state.win.webContents.send('monitor:data', connectionId, snapshot)
    }

    // Update status
    state.status = 'active'
    this.sendStatus(connectionId)
  }

  private sendStatus(connectionId: string): void {
    const state = this.states.get(connectionId)
    if (!state?.win || state.win.isDestroyed()) return
    state.win.webContents.send('monitor:status', connectionId, state.status)
  }

  private sendError(connectionId: string, message: string): void {
    const state = this.states.get(connectionId)
    if (!state?.win || state.win.isDestroyed()) return
    state.win.webContents.send('monitor:error', connectionId, message)
  }
}
