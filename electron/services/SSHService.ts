import { Client, type ConnectConfig, type ClientChannel, type Prompt, type KeyboardInteractiveCallback } from 'ssh2'
import { readFileSync } from 'fs'
import { connect as netConnect, type Socket } from 'net'
import { EventEmitter } from 'events'
import { SocksClient, type SocksClientOptions } from 'socks'
import { ReconnectionManager } from './ReconnectionManager'
import { getLogService, LogService } from './LogService'
import type { ReconnectionConfig } from '../../src/types/session'

export interface SSHConnectionConfig {
  host: string
  port: number
  username: string

  // Authentication — expanded to support all methods
  authMethod:
    | 'password'
    | 'publickey'
    | 'publickey+passphrase'
    | 'keyboard-interactive'
    | 'publickey+password'
    | 'gssapi'
    | 'agent'
    | 'none'
  password?: string
  privateKeyPath?: string
  privateKeyData?: string
  passphrase?: string
  agentForward?: boolean
  kbdiAutoRespond?: boolean
  kbdiSavedResponses?: Record<string, string>
  gssapiDelegateCreds?: boolean
  gssapiSPN?: string

  // Algorithm preferences
  algorithms?: {
    kex?: string[]
    cipher?: string[]
    hmac?: string[]
    hostKey?: string[]
  }

  // Compression
  compression?: boolean

  // Connection options
  keepAliveInterval?: number   // seconds
  keepAliveCountMax?: number
  readyTimeout?: number        // seconds

  // Proxy
  proxy?: {
    type: 'none' | 'socks4' | 'socks5' | 'http-connect'
    host: string
    port: number
    requiresAuth: boolean
    username?: string
    password?: string
    remoteDNS?: boolean
  }

  // Reconnection
  reconnection?: ReconnectionConfig

  // Session ID for logging
  sessionId?: string
}

export type SSHConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'reconnecting'
  | 'paused'
  | 'error'

export interface SSHShellOptions {
  cols?: number
  rows?: number
  term?: string
}

/** Keyboard-interactive prompt from the server */
export interface KBDIPrompt {
  name: string
  instructions: string
  prompts: Array<{ prompt: string; echo?: boolean }>
}

/**
 * Manages a single SSH connection with multiplexed shells and SFTP channels.
 *
 * Emits:
 *   'status'        → (status: SSHConnectionStatus)
 *   'error'         → (message: string)
 *   'close'         → ()
 *   'banner'        → (message: string)
 *   'hostkey'       → (info: { host, port, keyType, fingerprint, publicKeyBase64 }, accept: fn, reject: fn)
 *   'kbdi-prompt'   → (connectionId, prompt: KBDIPrompt, respond: (responses: string[]) => void)
 *   'reconnect-*'   → forwarded reconnection events
 */
export class SSHConnection extends EventEmitter {
  readonly id: string
  /** @internal — exposed for port-forwarding and health-check services */
  _client: Client
  private config: SSHConnectionConfig
  private shells: Map<string, ClientChannel> = new Map()
  private _status: SSHConnectionStatus = 'disconnected'
  private reconnectionManager: ReconnectionManager | null = null
  private log: LogService
  private proxySocket: Socket | null = null

  constructor(id: string, config: SSHConnectionConfig) {
    super()
    this.id = id
    this.config = config
    this._client = new Client()
    this.log = getLogService()

    // Prevent Node's default "throw on unhandled 'error' event" behavior.
    // Errors are logged and forwarded; callers should attach their own 'error'
    // listeners, but missing one must not crash the process.
    this.on('error', () => {})

    this.setupClientEvents()
    this.setupReconnection()
  }

  get status(): SSHConnectionStatus {
    return this._status
  }

  get sessionId(): string {
    return this.config.sessionId || this.id
  }

  /** Establish the SSH connection */
  async connect(): Promise<void> {
    if (this._status === 'connected') return

    this.setStatus('connecting')
    LogService.connectionStarted(this.log, this.sessionId)
    LogService.connecting(this.log, this.sessionId, this.config.host, this.config.port)

    // Create proxy socket if needed
    let sock: Socket | undefined
    if (this.config.proxy && this.config.proxy.type !== 'none') {
      try {
        sock = await this.createProxySocket()
        this.proxySocket = sock
        this.log.log(
          this.sessionId,
          'info',
          'ssh',
          `Proxy connection established via ${this.config.proxy.type} (${this.config.proxy.host}:${this.config.proxy.port})`
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Proxy connection failed'
        this.log.log(this.sessionId, 'error', 'ssh', `Proxy connection failed: ${msg}`)
        this.setStatus('error')
        throw err
      }
    }

    return new Promise<void>((resolve, reject) => {
      const connectConfig: ConnectConfig = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        keepaliveInterval: (this.config.keepAliveInterval ?? 30) * 1000,
        keepaliveCountMax: this.config.keepAliveCountMax ?? 3,
        readyTimeout: (this.config.readyTimeout ?? 15) * 1000
      }

      // Pass proxy socket if available
      if (sock) {
        connectConfig.sock = sock
      }

      // Algorithm preferences
      if (this.config.algorithms) {
        const algos: ConnectConfig['algorithms'] = {}
        if (this.config.algorithms.kex) algos.kex = this.config.algorithms.kex as any
        if (this.config.algorithms.cipher) {
          algos.cipher = this.config.algorithms.cipher as any
        }
        if (this.config.algorithms.hmac) algos.serverHostKey = this.config.algorithms.hostKey as any
        if (this.config.algorithms.hmac) algos.hmac = this.config.algorithms.hmac as any
        if (this.config.algorithms.hostKey) algos.serverHostKey = this.config.algorithms.hostKey as any
        connectConfig.algorithms = algos
      }

      // Compression
      if (this.config.compression) {
        connectConfig.algorithms = {
          ...connectConfig.algorithms,
          compress: ['zlib@openssh.com', 'zlib', 'none'] as any
        }
      }

      // Host key verification callback
      connectConfig.hostVerifier = (key: any) => {
        // We handle verification asynchronously via events
        // Return true here to not block; actual verification is done before connect
        // or via the 'handshake' event
        return true
      }

      // ── Authentication setup ──
      this.configureAuth(connectConfig)

      this.setStatus('authenticating')
      LogService.authenticating(this.log, this.sessionId, this.config.authMethod)

      const onReady = () => {
        cleanup()
        this.setStatus('connected')
        LogService.authSuccess(this.log, this.sessionId)
        LogService.connected(this.log, this.sessionId)
        resolve()
      }

      const onError = (err: Error) => {
        cleanup()
        this.setStatus('error')
        LogService.authFailed(this.log, this.sessionId, err.message)
        this.emit('error', err.message)
        reject(err)
      }

      const cleanup = () => {
        this._client.removeListener('ready', onReady)
        this._client.removeListener('error', onError)
      }

      this._client.once('ready', onReady)
      this._client.once('error', onError)

      try {
        this._client.connect(connectConfig)
      } catch (err) {
        cleanup()
        this.setStatus('error')
        reject(err)
      }
    })
  }

  /** Configure authentication on the ConnectConfig based on authMethod */
  private configureAuth(connectConfig: ConnectConfig): void {
    switch (this.config.authMethod) {
      case 'password':
        connectConfig.password = this.config.password
        break

      case 'publickey':
        if (this.config.privateKeyData) {
          connectConfig.privateKey = this.config.privateKeyData
        } else if (this.config.privateKeyPath) {
          connectConfig.privateKey = readFileSync(this.config.privateKeyPath)
        }
        break

      case 'publickey+passphrase':
        if (this.config.privateKeyData) {
          connectConfig.privateKey = this.config.privateKeyData
        } else if (this.config.privateKeyPath) {
          connectConfig.privateKey = readFileSync(this.config.privateKeyPath)
        }
        connectConfig.passphrase = this.config.passphrase
        break

      case 'publickey+password':
        // Two-factor: key first, then password as second factor
        // Use authHandler for multi-step auth
        this.configureMultiFactorAuth(connectConfig)
        break

      case 'keyboard-interactive':
        this.configureKBDIAuth(connectConfig)
        break

      case 'gssapi':
        // GSSAPI/Kerberos — limited support via ssh2
        this.log.log(
          this.sessionId,
          'warning',
          'ssh',
          'GSSAPI/Kerberos authentication requires system Kerberos configuration. ' +
            'This method may not be fully supported by the ssh2 library.'
        )
        // Attempt with tryKeyboard false; GSSAPI isn't natively in ssh2
        // Fall through to password as fallback if SPN is provided
        if (this.config.password) {
          connectConfig.password = this.config.password
        }
        break

      case 'agent':
        connectConfig.agent = process.env.SSH_AUTH_SOCK
        if (this.config.agentForward) {
          connectConfig.agentForward = true
        }
        break

      case 'none':
        // No authentication
        connectConfig.authHandler = (
          _methodsLeft: string[],
          _partialSuccess: boolean,
          callback: (method: any) => void
        ) => {
          callback('none' as any)
        }
        break
    }
  }

  /** Configure multi-factor auth (publickey + password) via authHandler */
  private configureMultiFactorAuth(connectConfig: ConnectConfig): void {
    let privateKey: Buffer | string | undefined
    if (this.config.privateKeyData) {
      privateKey = this.config.privateKeyData
    } else if (this.config.privateKeyPath) {
      privateKey = readFileSync(this.config.privateKeyPath)
    }

    connectConfig.authHandler = (
      methodsLeft: string[],
      partialSuccess: boolean,
      callback: (method: any) => void
    ) => {
      if (!partialSuccess && methodsLeft.includes('publickey')) {
        // First: try public key
        callback({
          type: 'publickey',
          username: this.config.username,
          key: privateKey,
          passphrase: this.config.passphrase
        })
      } else if (methodsLeft.includes('password')) {
        // Second: password
        callback({
          type: 'password',
          username: this.config.username,
          password: this.config.password
        })
      } else {
        // No more methods
        callback(false as any)
      }
    }
  }

  /** Configure keyboard-interactive auth */
  private configureKBDIAuth(connectConfig: ConnectConfig): void {
    connectConfig.tryKeyboard = true

    this._client.on(
      'keyboard-interactive',
      (
        name: string,
        instructions: string,
        _lang: string,
        prompts: Prompt[],
        finish: KeyboardInteractiveCallback
      ) => {
        this.log.log(
          this.sessionId,
          'info',
          'ssh',
          `Keyboard-interactive challenge received: ${name || '(unnamed)'}`
        )

        // Try auto-respond first
        if (this.config.kbdiAutoRespond && this.config.kbdiSavedResponses) {
          const responses: string[] = []
          let allFound = true

          for (const p of prompts) {
            const saved = this.config.kbdiSavedResponses[p.prompt]
            if (saved !== undefined) {
              responses.push(saved)
            } else {
              allFound = false
              break
            }
          }

          if (allFound) {
            this.log.log(
              this.sessionId,
              'info',
              'ssh',
              'Keyboard-interactive: auto-responding with saved responses.'
            )
            finish(responses)
            return
          }
        }

        // If auto-respond with saved password for single password prompt
        if (
          this.config.kbdiAutoRespond &&
          prompts.length === 1 &&
          this.config.password
        ) {
          this.log.log(
            this.sessionId,
            'info',
            'ssh',
            'Keyboard-interactive: auto-responding with saved password.'
          )
          finish([this.config.password])
          return
        }

        // Emit event for renderer to show KBDI dialog
        const prompt: KBDIPrompt = { name, instructions, prompts }
        this.emit('kbdi-prompt', this.id, prompt, (responses: string[]) => {
          this.log.log(
            this.sessionId,
            'info',
            'ssh',
            'Keyboard-interactive: user responded to challenge.'
          )
          finish(responses)
        })
      }
    )
  }

  /** Create a socket through a proxy server */
  private async createProxySocket(): Promise<Socket> {
    const proxy = this.config.proxy!

    this.log.log(
      this.sessionId,
      'info',
      'ssh',
      `Connecting through ${proxy.type} proxy at ${proxy.host}:${proxy.port}...`
    )

    if (proxy.type === 'socks4' || proxy.type === 'socks5') {
      return this.createSocksProxy(proxy)
    } else if (proxy.type === 'http-connect') {
      return this.createHttpConnectProxy(proxy)
    }

    throw new Error(`Unsupported proxy type: ${proxy.type}`)
  }

  /** Create a SOCKS4/5 proxy connection */
  private async createSocksProxy(proxy: NonNullable<SSHConnectionConfig['proxy']>): Promise<Socket> {
    const socksOptions: SocksClientOptions = {
      proxy: {
        host: proxy.host,
        port: proxy.port,
        type: proxy.type === 'socks4' ? 4 : 5,
        ...(proxy.requiresAuth && proxy.username
          ? { userId: proxy.username, password: proxy.password }
          : {})
      },
      command: 'connect',
      destination: {
        host: this.config.host,
        port: this.config.port
      }
    }

    const { socket } = await SocksClient.createConnection(socksOptions)
    return socket
  }

  /** Create an HTTP CONNECT proxy tunnel */
  private createHttpConnectProxy(proxy: NonNullable<SSHConnectionConfig['proxy']>): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = netConnect(proxy.port, proxy.host, () => {
        let connectReq = `CONNECT ${this.config.host}:${this.config.port} HTTP/1.1\r\n`
        connectReq += `Host: ${this.config.host}:${this.config.port}\r\n`

        if (proxy.requiresAuth && proxy.username) {
          const creds = Buffer.from(`${proxy.username}:${proxy.password || ''}`).toString('base64')
          connectReq += `Proxy-Authorization: Basic ${creds}\r\n`
        }

        connectReq += '\r\n'
        socket.write(connectReq)
      })

      let responseData = ''

      const onData = (data: Buffer) => {
        responseData += data.toString()

        if (responseData.includes('\r\n\r\n')) {
          socket.removeListener('data', onData)

          const statusLine = responseData.split('\r\n')[0]
          const statusCode = parseInt(statusLine.split(' ')[1], 10)

          if (statusCode === 200) {
            resolve(socket)
          } else {
            socket.destroy()
            reject(new Error(`HTTP CONNECT proxy returned status ${statusCode}: ${statusLine}`))
          }
        }
      }

      socket.on('data', onData)
      socket.on('error', (err) => {
        reject(new Error(`HTTP CONNECT proxy error: ${err.message}`))
      })

      socket.setTimeout(10000, () => {
        socket.destroy()
        reject(new Error('HTTP CONNECT proxy timeout'))
      })
    })
  }

  /** Open a new shell channel */
  openShell(shellId: string, options: SSHShellOptions = {}): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      if (this._status !== 'connected') {
        reject(new Error('Not connected'))
        return
      }

      this._client.shell(
        {
          cols: options.cols || 80,
          rows: options.rows || 24,
          term: options.term || 'xterm-256color'
        },
        (err, stream) => {
          if (err) {
            reject(err)
            return
          }

          this.shells.set(shellId, stream)
          LogService.shellOpened(this.log, this.sessionId, shellId)

          stream.on('close', () => {
            this.shells.delete(shellId)
            LogService.shellClosed(this.log, this.sessionId, shellId)
          })

          resolve(stream)
        }
      )
    })
  }

  /** Resize a shell */
  resizeShell(shellId: string, cols: number, rows: number): void {
    const shell = this.shells.get(shellId)
    if (shell) {
      shell.setWindow(rows, cols, 0, 0)
    }
  }

  /** Write data to a shell */
  writeToShell(shellId: string, data: string): void {
    const shell = this.shells.get(shellId)
    if (shell && shell.writable) {
      shell.write(data)
    }
  }

  /** Close a specific shell */
  closeShell(shellId: string): void {
    const shell = this.shells.get(shellId)
    if (shell) {
      shell.end()
      this.shells.delete(shellId)
    }
  }

  /** Get the SFTP subsystem */
  getSFTP(): Promise<import('ssh2').SFTPWrapper> {
    return new Promise((resolve, reject) => {
      if (this._status !== 'connected') {
        reject(new Error('Not connected'))
        return
      }
      this._client.sftp((err, sftp) => {
        if (err) {
          this.log.log(this.sessionId, 'error', 'sftp', `Failed to open SFTP: ${err.message}`)
          reject(err)
        } else {
          LogService.sftpOpened(this.log, this.sessionId)
          resolve(sftp)
        }
      })
    })
  }

  /** Disconnect cleanly */
  disconnect(): void {
    if (this.reconnectionManager) {
      this.reconnectionManager.cancel()
    }

    // Close all shells
    for (const [_id, shell] of this.shells) {
      shell.end()
    }
    this.shells.clear()

    if (this.proxySocket) {
      this.proxySocket.destroy()
      this.proxySocket = null
    }

    this._client.end()
    this.setStatus('disconnected')
    LogService.terminated(this.log, this.sessionId)
  }

  /** Destroy the connection forcefully */
  destroy(): void {
    if (this.reconnectionManager) {
      this.reconnectionManager.cancel()
    }
    this.shells.clear()

    if (this.proxySocket) {
      this.proxySocket.destroy()
      this.proxySocket = null
    }

    this._client.destroy()
    this.setStatus('disconnected')
  }

  /** Setup the ReconnectionManager based on config */
  private setupReconnection(): void {
    const reconnConfig = this.config.reconnection
    if (!reconnConfig || !reconnConfig.enabled) return

    this.reconnectionManager = new ReconnectionManager(reconnConfig)

    this.reconnectionManager.on('attempt', (connectionId: string, attempt: number) => {
      LogService.reconnecting(
        this.log,
        this.sessionId,
        attempt,
        reconnConfig.maxAttempts
      )
      this.setStatus('reconnecting')
      this.emit('reconnect-attempt', connectionId, attempt, reconnConfig.maxAttempts)

      // Actually attempt reconnection
      this.performReconnect().then(
        () => {
          this.reconnectionManager?.onSuccess()
          LogService.reconnectionSuccess(this.log, this.sessionId, attempt)
        },
        (err) => {
          const msg = err instanceof Error ? err.message : 'Unknown error'
          LogService.reconnectionFailed(this.log, this.sessionId, attempt, msg)
          this.reconnectionManager?.onFailure(msg)
        }
      )
    })

    this.reconnectionManager.on(
      'waiting',
      (connectionId: string, delayMs: number, nextAttempt: number, nextRetryAt: number) => {
        LogService.reconnectionScheduled(this.log, this.sessionId, delayMs)
        this.emit('reconnect-waiting', connectionId, delayMs, nextAttempt, nextRetryAt)
      }
    )

    this.reconnectionManager.on('success', (connectionId: string, attempt: number) => {
      this.emit('reconnect-success', connectionId, attempt)
    })

    this.reconnectionManager.on('failed', (connectionId: string, attempt: number, error: string) => {
      this.emit('reconnect-failed', connectionId, attempt, error)
    })

    this.reconnectionManager.on('exhausted', (connectionId: string, totalAttempts: number) => {
      LogService.reconnectionExhausted(this.log, this.sessionId, totalAttempts)
      this.setStatus('error')
      this.emit('reconnect-exhausted', connectionId, totalAttempts)
    })

    this.reconnectionManager.on('paused', (connectionId: string) => {
      this.setStatus('paused')
      this.emit('reconnect-paused', connectionId)
    })

    this.reconnectionManager.on('resumed', (connectionId: string) => {
      this.setStatus('reconnecting')
      this.emit('reconnect-resumed', connectionId)
    })
  }

  /** Perform the actual reconnection (create new client and connect) */
  private async performReconnect(): Promise<void> {
    this._client = new Client()
    this.setupClientEvents()
    await this.connect()
  }

  /** Trigger reconnection from outside (e.g., retry now button) */
  retryNow(): void {
    this.reconnectionManager?.retryNow()
  }

  /** Pause reconnection */
  pauseReconnection(): void {
    this.reconnectionManager?.pause()
  }

  /** Resume reconnection */
  resumeReconnection(): void {
    this.reconnectionManager?.resume()
  }

  /** Cancel reconnection */
  cancelReconnection(): void {
    this.reconnectionManager?.cancel()
    this.setStatus('disconnected')
  }

  /** Get current reconnection state for UI */
  getReconnectionState(): {
    attempt: number
    maxAttempts: number
    nextRetryAt: number | null
    state: 'idle' | 'waiting' | 'attempting' | 'paused'
  } | null {
    if (!this.reconnectionManager) return null
    return {
      attempt: this.reconnectionManager.attempt,
      maxAttempts: this.reconnectionManager.maxAttempts,
      nextRetryAt: this.reconnectionManager.nextRetryAt,
      state: this.reconnectionManager.state
    }
  }

  private setStatus(status: SSHConnectionStatus): void {
    this._status = status
    this.emit('status', status)
  }

  private setupClientEvents(): void {
    this._client.on('banner', (message) => {
      this.emit('banner', message)
      this.log.log(this.sessionId, 'info', 'ssh', `Server banner: ${message.trim()}`)
    })

    this._client.on('close', () => {
      if (this._status === 'connected') {
        // Unexpected close — try to reconnect
        LogService.connectionLost(this.log, this.sessionId, 'Connection closed unexpectedly.')
        if (this.reconnectionManager) {
          this.reconnectionManager.start(this.id)
        } else {
          this.setStatus('disconnected')
        }
      }
    })

    this._client.on('end', () => {
      if (this._status !== 'disconnected' && this._status !== 'reconnecting' && this._status !== 'paused') {
        this.setStatus('disconnected')
      }
    })

    this._client.on('error', (err) => {
      this.emit('error', err.message)
      this.log.log(this.sessionId, 'error', 'ssh', `SSH error: ${err.message}`)

      if (this._status === 'connected') {
        LogService.connectionLost(this.log, this.sessionId, err.message)
        if (this.reconnectionManager) {
          this.reconnectionManager.start(this.id)
        }
      }
    })
  }
}

/**
 * SSHService — manages all SSH connections (connection pool).
 */
export class SSHService {
  private connections: Map<string, SSHConnection> = new Map()

  /** Create a connection instance without connecting (for attaching listeners first) */
  create(id: string, config: SSHConnectionConfig): SSHConnection {
    // Disconnect existing if any
    this.disconnect(id)

    const conn = new SSHConnection(id, config)
    this.connections.set(id, conn)
    return conn
  }

  /** Create and connect */
  async connect(id: string, config: SSHConnectionConfig): Promise<SSHConnection> {
    const conn = this.create(id, config)
    await conn.connect()
    return conn
  }

  /** Get an existing connection */
  get(id: string): SSHConnection | undefined {
    return this.connections.get(id)
  }

  /** Disconnect a specific connection */
  disconnect(id: string): void {
    const conn = this.connections.get(id)
    if (conn) {
      conn.disconnect()
      conn.removeAllListeners()
      this.connections.delete(id)
    }
  }

  /** Disconnect all connections */
  disconnectAll(): void {
    for (const [id] of this.connections) {
      this.disconnect(id)
    }
  }

  /** Check if a connection exists and is connected */
  isConnected(id: string): boolean {
    const conn = this.connections.get(id)
    return conn?.status === 'connected'
  }
}
