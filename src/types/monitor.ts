/** Raw output from the monitoring shell script (JSON-parsed) */
export interface MonitorRawData {
  cpu: {
    us: number   // user jiffies
    ni: number   // nice jiffies
    sy: number   // system jiffies
    id: number   // idle jiffies
    io: number   // iowait jiffies
    ir: number   // irq jiffies
    si: number   // softirq jiffies
    st: number   // steal jiffies
  }
  /** Per-core CPU jiffies: same shape as cpu but one entry per core */
  cores?: Array<{
    us: number; ni: number; sy: number; id: number
    io: number; ir: number; si: number; st: number
  }>
  mem: {
    total: number     // kB
    avail: number     // kB (may be 0 on old kernels)
    free: number      // kB
    buffers: number   // kB
    cached: number    // kB
    swapTotal: number // kB
    swapFree: number  // kB
  }
  load: [number, number, number]
  uptime: number      // seconds
  hostname: string
  kernel: string
  cpuCount: number
  cpuModel?: string
  os?: string         // Distro name from /etc/os-release
  disks: Array<{
    fs: string        // filesystem device
    type: string      // fstype (ext4, xfs, etc.)
    size: number      // bytes
    used: number      // bytes
    avail: number     // bytes
    mount: string     // mountpoint
  }>
  diskio?: Array<{
    dev: string       // device name
    reads: number     // sectors read (cumulative)
    writes: number    // sectors written (cumulative)
  }>
  net: Array<{
    if: string        // interface name
    rx: number        // bytes received (cumulative)
    tx: number        // bytes transmitted (cumulative)
  }>
  procs: Array<{
    pid: number
    cpu: number       // %
    mem: number       // %
    rss: number       // kB
    user?: string
    name: string
  }>
  services?: Array<{
    name: string
    load: string      // loaded | not-found
    active: string    // active | inactive | failed
    sub: string       // running | dead | exited | failed
    desc: string
  }>
  docker?: Array<{
    id: string
    name: string
    image: string
    status: string
    cpu: number
    mem: number
    memLimit: number
    netIn: number
    netOut: number
  }>
  /** Temperature readings (millidegrees celsius) */
  temps?: Array<{
    label: string
    temp: number      // millidegrees C
  }>
  /** Open listening ports */
  ports?: Array<{
    proto: string     // tcp | udp
    local: string     // addr:port
    pid: number
    process: string
  }>
  /** Failed SSH login attempts (last 24h) */
  failedLogins?: number
  /** Active SSH sessions */
  sshSessions?: Array<{
    user: string
    from: string
    loginTime: string
  }>
}

/** Processed snapshot with computed values — stored in history ring buffer */
export interface MonitorSnapshot {
  timestamp: number

  // CPU
  cpuPercent: number
  cpuBreakdown: {
    user: number      // % of total CPU time
    system: number
    iowait: number
    steal: number
    nice: number
    irq: number
  }
  perCoreCpu?: number[]    // % usage per core

  // Memory
  memTotalBytes: number
  memUsedBytes: number
  memAvailableBytes: number
  memCachedBytes: number
  memBuffersBytes: number
  memUsedPercent: number
  swapTotalBytes: number
  swapUsedBytes: number
  swapUsedPercent: number

  // Load
  load: [number, number, number]

  // System
  uptime: number
  hostname: string
  kernel: string
  cpuCount: number
  cpuModel?: string
  os?: string

  // Disk
  disks: Array<{
    filesystem: string
    type: string
    sizeBytes: number
    usedBytes: number
    availBytes: number
    mountpoint: string
    usedPercent: number
  }>

  // Disk I/O (computed from deltas)
  diskIO?: Array<{
    device: string
    readBytesPerSec: number
    writeBytesPerSec: number
  }>

  // Network
  netInterfaces: Array<{
    name: string
    rxBytesPerSec: number
    txBytesPerSec: number
    rxTotalBytes: number
    txTotalBytes: number
  }>

  // Processes
  processes: Array<{
    pid: number
    cpuPercent: number
    memPercent: number
    rssBytes: number
    user?: string
    name: string
  }>

  // Services (from full poll)
  services?: Array<{
    name: string
    isLoaded: boolean
    active: 'active' | 'inactive' | 'failed' | string
    sub: string
    description: string
  }>

  // Docker (from full poll)
  docker?: Array<{
    id: string
    name: string
    image: string
    status: string
    cpuPercent: number
    memUsageBytes: number
    memLimitBytes: number
    netInBytes: number
    netOutBytes: number
  }>

  // Temperature
  temperatures?: Array<{
    label: string
    celsius: number
  }>

  // Security
  listeningPorts?: Array<{
    protocol: string
    localAddress: string
    pid: number
    processName: string
  }>
  failedSSHLogins?: number
  activeSessions?: Array<{
    user: string
    from: string
    loginTime: string
  }>
}

/** Monitor connection status */
export type MonitorStatus = 'active' | 'stale' | 'error' | 'stopped' | 'unsupported'

/** CPU jiffies for delta calculation */
export interface CpuJiffies {
  user: number
  nice: number
  system: number
  idle: number
  iowait: number
  irq: number
  softirq: number
  steal: number
  total: number
}
