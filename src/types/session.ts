/** SSH authentication method — expanded to support all Bitvise-equivalent methods */
export type AuthMethod =
  | 'password'
  | 'publickey'
  | 'publickey+passphrase'
  | 'keyboard-interactive'
  | 'publickey+password'
  | 'gssapi'
  | 'agent'
  | 'none'

/** Authentication configuration for a session */
export interface SessionAuth {
  /** Primary authentication method */
  initialMethod: AuthMethod

  // Password auth fields
  password?: string              // Encrypted at rest
  
  // Public key auth fields
  privateKeyPath?: string        // Path to private key file
  privateKeyData?: string        // OR inline key data (encrypted at rest)
  passphrase?: string            // Key passphrase (encrypted at rest)
  clientKeyId?: string           // Reference to key in Key Manager

  // Keyboard-interactive fields
  kbdiAutoRespond?: boolean      // Auto-respond with saved password
  kbdiSavedResponses?: Record<string, string> // Prompt → response mapping (encrypted)

  // GSSAPI/Kerberos fields
  gssapiDelegateCreds?: boolean
  gssapiSPN?: string             // Service Principal Name

  // Agent fields
  agentForward?: boolean         // Forward agent to remote host
}

/** Proxy configuration for a session */
export interface ProxyConfig {
  type: 'none' | 'socks4' | 'socks5' | 'http-connect'
  host: string
  port: number
  requiresAuth: boolean
  username?: string
  password?: string              // Encrypted
  remoteDNS?: boolean            // SOCKS5: resolve DNS through proxy (default true)
}

/** Per-session setting overrides — all fields optional; when absent, global defaults apply */
export interface SessionOverrides {
  // Terminal overrides
  terminal?: {
    fontFamily?: string
    fontSize?: number
    lineHeight?: number
    cursorStyle?: 'block' | 'underline' | 'bar'
    cursorBlink?: boolean
    scrollbackLines?: number
    colorScheme?: string
    copyOnSelect?: boolean
    rightClickPaste?: boolean
    bellBehavior?: 'sound' | 'visual' | 'none'
  }

  // SFTP overrides
  sftp?: {
    defaultViewMode?: 'list' | 'grid'
    showHiddenFiles?: boolean
    doubleClickAction?: 'open' | 'transfer' | 'edit'
    defaultConflictResolution?: 'ask' | 'overwrite' | 'overwrite-newer' | 'skip' | 'rename'
    concurrentTransfers?: number  // 1-10
    bandwidthLimitUp?: number     // KB/s, 0 = unlimited
    bandwidthLimitDown?: number
    preserveTimestamps?: boolean
    followSymlinks?: boolean
  }

  // SSH overrides
  ssh?: {
    keepAliveInterval?: number    // Seconds, 0 = disabled
    keepAliveCountMax?: number    // Max missed keepalives before disconnect
    connectionTimeout?: number    // Seconds
    reconnectAttempts?: number    // 0 = disabled
    reconnectDelay?: number       // Seconds between attempts
    compression?: boolean         // Enable zlib compression
    preferredCiphers?: string[]
    preferredKex?: string[]
    preferredHmac?: string[]
    preferredHostKey?: string[]
  }

  // Connection overrides
  connection?: {
    proxyType?: 'none' | 'socks4' | 'socks5' | 'http-connect'
    proxyHost?: string
    proxyPort?: number
    proxyUsername?: string
    proxyPassword?: string       // Encrypted
  }
}

/** Structured startup command for post-connect execution */
export interface StartupCommand {
  command: string
  delay?: number                 // ms to wait after previous command before executing
  waitForPrompt?: boolean        // Wait for shell prompt before executing (default: true)
  enabled: boolean               // Toggle individual commands on/off
}

/** Reconnection strategy configuration */
export interface ReconnectionConfig {
  enabled: boolean               // Default: true
  maxAttempts: number            // Default: 0 (0 = unlimited)
  initialDelay: number           // Seconds before first retry. Default: 1
  maxDelay: number               // Maximum delay cap in seconds. Default: 120
  backoffMultiplier: number      // Multiply delay by this each failure. Default: 2
  jitter: boolean                // Add randomness to prevent thundering herd. Default: true
  resetAfterSuccess: boolean     // Reset delay counter after successful reconnect. Default: true
}

/** Per-session view preferences for quick-launch behavior */
export interface SessionViewPreferences {
  /** What opens when you double-click / connect to a session */
  defaultView: 'terminal' | 'sftp' | 'both' | 'last-used'
  /** Layout when both terminal and SFTP are open */
  splitLayout: 'horizontal' | 'vertical'
  /** Split ratio: 0.5 = equal, 0.3 = 30% terminal 70% SFTP, etc. */
  splitRatio: number
}

/** Port forwarding rule */
export interface PortForwardRule {
  id: string
  type: 'local' | 'remote' | 'dynamic'
  name?: string
  sourceHost: string
  sourcePort: number
  destinationHost?: string
  destinationPort?: number
  autoStart: boolean
  enabled: boolean
}

/** Saved SSH session — full model with all supplement expansions */
export interface Session {
  // Identity
  id: string
  name: string
  group?: string
  color?: string
  icon?: string
  notes?: string

  // Connection
  host: string
  port: number                               // Default: 22
  username: string

  // Authentication
  auth: SessionAuth

  // Proxy
  proxy: ProxyConfig

  // Port forwarding
  portForwardings?: PortForwardRule[]

  // Per-session setting overrides
  overrides: SessionOverrides

  // Startup
  defaultDirectory?: string
  startupCommands?: StartupCommand[]

  // Environment variables to set on connect
  environmentVariables?: Record<string, string>

  // Shell / PTY
  shellCommand?: string                      // Custom shell command (empty = default)
  terminalType?: string                      // Default: 'xterm-256color'
  encoding?: string                          // Default: 'utf-8'

  // View preferences
  viewPreferences?: SessionViewPreferences

  // Metadata
  lastConnected?: number
  createdAt: number
  updatedAt: number
  isModified?: boolean                       // Unsaved changes indicator

  // Ordering
  sortOrder?: number                         // Manual sort position (lower = higher)
}

/** Connection status — includes reconnection-related paused states */
export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'reconnecting'
  | 'paused'
  | 'error'

/** Active connection tab */
export interface ConnectionTab {
  id: string
  /** For SSH tabs: the saved session ID. For database tabs: a synthetic `db-{uuid}` key. */
  sessionId: string
  sessionName: string
  sessionColor?: string
  /** Tab type — 'ssh' (default) for full SSH sessions, 'database' for standalone SQL connections */
  type?: 'ssh' | 'database'
  status: ConnectionStatus
  activeSubTab: 'terminal' | 'sftp' | 'sql' | 'port-forwarding' | 'info' | 'log'
  /** Whether Terminal + SFTP split view is active for this tab */
  splitView?: boolean
  error?: string
  /** Reconnection state shown in UI overlay */
  reconnectionState?: {
    attempt: number
    maxAttempts: number          // 0 = unlimited
    nextRetryAt: number | null   // Unix ms timestamp of next retry, null if not waiting
    state: 'idle' | 'waiting' | 'attempting' | 'paused'
  }
}
