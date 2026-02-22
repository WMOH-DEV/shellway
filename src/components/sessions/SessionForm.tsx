import { useState, useEffect, useCallback } from 'react'
import {
  X, Save, Key, Server, Shield, Terminal, Palette, Monitor,
  FolderTree, Wifi, Globe, StickyNote, Cog, Plus, Trash2,
  ChevronUp, ChevronDown, RotateCcw, AlertTriangle, Info,
  Loader2, CheckCircle, XCircle, Plug
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/utils/cn'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Toggle } from '@/components/ui/Toggle'
import { Tabs, type TabItem } from '@/components/ui/Tabs'
import { Tooltip } from '@/components/ui/Tooltip'
import { toast } from '@/components/ui/Toast'
import { FontPicker } from '@/components/settings/FontPicker'
import type {
  Session,
  AuthMethod,
  SessionAuth,
  ProxyConfig,
  SessionOverrides,
  StartupCommand,
  SessionViewPreferences
} from '@/types/session'
import { THEME_NAMES } from '@/data/terminalThemes'

// ── Props ──

interface SessionFormProps {
  open: boolean
  onClose: () => void
  session?: Session | null
  templateDefaults?: Partial<Session> | null
  groups: string[]
  onSave: (data: SessionFormData) => void
}

export interface SessionFormData {
  // Login
  name: string
  group: string
  host: string
  port: number
  username: string
  color: string
  defaultDirectory: string

  // Auth
  auth: SessionAuth

  // Proxy
  proxy: ProxyConfig

  // Overrides
  overrides: SessionOverrides
  useGlobalTerminal: boolean
  useGlobalSFTP: boolean
  useGlobalSSH: boolean

  // Notes / startup
  notes: string
  startupCommands: StartupCommand[]

  // Advanced
  environmentVariables: Record<string, string>
  shellCommand: string
  terminalType: string
  encoding: string
  sshCompression: boolean
  compressionMethod: string

  // View preferences
  viewPreferences: SessionViewPreferences
}

// ── Constants ──

const AUTH_OPTIONS = [
  { value: 'password', label: 'Password — Authenticate with password' },
  { value: 'publickey', label: 'Public Key — Authenticate with SSH key' },
  { value: 'publickey+passphrase', label: 'Public Key + Passphrase — SSH key protected by passphrase' },
  { value: 'publickey+password', label: 'Public Key + Password — Two-factor: key then password' },
  { value: 'keyboard-interactive', label: 'Keyboard Interactive — Server-prompted authentication' },
  { value: 'agent', label: 'SSH Agent — Use system SSH agent' },
  { value: 'gssapi', label: 'GSSAPI / Kerberos — Kerberos ticket authentication' }
]

const COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1'
]

const DEFAULT_VIEW_OPTIONS = [
  { value: 'terminal', label: 'Terminal' },
  { value: 'sftp', label: 'SFTP' },
  { value: 'both', label: 'Terminal + SFTP' },
  { value: 'last-used', label: 'Remember Last' }
]

const formTabs: TabItem[] = [
  { id: 'login', label: 'Login', icon: <Server size={13} /> },
  { id: 'terminal', label: 'Terminal', icon: <Monitor size={13} /> },
  { id: 'sftp', label: 'SFTP', icon: <FolderTree size={13} /> },
  { id: 'ssh', label: 'SSH', icon: <Shield size={13} /> },
  { id: 'proxy', label: 'Proxy', icon: <Globe size={13} /> },
  { id: 'notes', label: 'Notes', icon: <StickyNote size={13} /> },
  { id: 'advanced', label: 'Advanced', icon: <Cog size={13} /> }
]

// ── Algorithm Defaults ──

const DEFAULT_KEX = [
  'curve25519-sha256',
  'curve25519-sha256@libssh.org',
  'ecdh-sha2-nistp256',
  'ecdh-sha2-nistp384',
  'ecdh-sha2-nistp521',
  'diffie-hellman-group-exchange-sha256',
  'diffie-hellman-group14-sha256',
  'diffie-hellman-group14-sha1',
  'diffie-hellman-group16-sha512',
  'diffie-hellman-group18-sha512'
]

const DEFAULT_CIPHERS = [
  'aes128-gcm@openssh.com',
  'aes256-gcm@openssh.com',
  'aes128-ctr',
  'aes192-ctr',
  'aes256-ctr',
  'chacha20-poly1305@openssh.com',
  'aes128-cbc',
  'aes256-cbc',
  '3des-cbc'
]

const DEFAULT_HMAC = [
  'hmac-sha2-256-etm@openssh.com',
  'hmac-sha2-512-etm@openssh.com',
  'hmac-sha2-256',
  'hmac-sha2-512',
  'hmac-sha1'
]

const DEFAULT_HOSTKEY = [
  'ssh-ed25519',
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521',
  'rsa-sha2-512',
  'rsa-sha2-256',
  'ssh-rsa'
]

const ALGO_WARNINGS: Record<string, string> = {
  'ssh-rsa': 'ssh-rsa uses SHA-1, consider disabling',
  'diffie-hellman-group14-sha1': 'Uses SHA-1, prefer SHA-256 variants',
  'hmac-sha1': 'Uses SHA-1, prefer SHA-2 variants',
  '3des-cbc': '3DES is slow and deprecated',
  'aes128-cbc': 'CBC mode is less secure than CTR/GCM',
  'aes256-cbc': 'CBC mode is less secure than CTR/GCM'
}

// ── Default form state ──

function defaultFormData(): SessionFormData {
  return {
    name: '',
    group: '',
    host: '',
    port: 22,
    username: '',
    color: '#3b82f6',
    defaultDirectory: '',
    auth: {
      initialMethod: 'password'
    },
    proxy: {
      type: 'none',
      host: '',
      port: 1080,
      requiresAuth: false
    },
    overrides: {},
    useGlobalTerminal: true,
    useGlobalSFTP: true,
    useGlobalSSH: true,
    notes: '',
    startupCommands: [],
    environmentVariables: {},
    shellCommand: '',
    terminalType: 'xterm-256color',
    encoding: 'utf-8',
    sshCompression: false,
    compressionMethod: 'zlib',
    viewPreferences: {
      defaultView: 'terminal',
      splitLayout: 'horizontal',
      splitRatio: 0.5
    }
  }
}

function sessionToForm(session: Session): SessionFormData {
  return {
    name: session.name,
    group: session.group || '',
    host: session.host,
    port: session.port,
    username: session.username,
    color: session.color || '#3b82f6',
    defaultDirectory: session.defaultDirectory || '',
    auth: { ...session.auth },
    proxy: { ...session.proxy },
    overrides: JSON.parse(JSON.stringify(session.overrides || {})),
    useGlobalTerminal: !session.overrides?.terminal,
    useGlobalSFTP: !session.overrides?.sftp,
    useGlobalSSH: !session.overrides?.ssh,
    notes: session.notes || '',
    startupCommands: session.startupCommands ? session.startupCommands.map((c) => ({ ...c })) : [],
    environmentVariables: { ...(session.environmentVariables || {}) },
    shellCommand: session.shellCommand || '',
    terminalType: session.terminalType || 'xterm-256color',
    encoding: session.encoding || 'utf-8',
    sshCompression: session.overrides?.ssh?.compression ?? false,
    compressionMethod: 'zlib',
    viewPreferences: session.viewPreferences
      ? { ...session.viewPreferences }
      : { defaultView: 'terminal', splitLayout: 'horizontal', splitRatio: 0.5 }
  }
}

// ── Algorithm list item ──

interface AlgoItem {
  name: string
  enabled: boolean
}

// ── Component ──

export function SessionForm({ open, onClose, session, templateDefaults, groups, onSave }: SessionFormProps) {
  const [activeTab, setActiveTab] = useState('login')
  const [form, setForm] = useState<SessionFormData>(defaultFormData)

  // Client keys for the dropdown
  const [clientKeys, setClientKeys] = useState<{ id: string; name: string; keyType: string; fingerprint: string }[]>([])

  // Algorithm lists (SSH tab)
  const [kexList, setKexList] = useState<AlgoItem[]>(() => DEFAULT_KEX.map((n) => ({ name: n, enabled: true })))
  const [cipherList, setCipherList] = useState<AlgoItem[]>(() => DEFAULT_CIPHERS.map((n) => ({ name: n, enabled: true })))
  const [hmacList, setHmacList] = useState<AlgoItem[]>(() => DEFAULT_HMAC.map((n) => ({ name: n, enabled: true })))
  const [hostkeyList, setHostkeyList] = useState<AlgoItem[]>(() => DEFAULT_HOSTKEY.map((n) => ({ name: n, enabled: true })))

  // Env var editor
  const [newEnvKey, setNewEnvKey] = useState('')
  const [newEnvValue, setNewEnvValue] = useState('')

  // Load client keys for the dropdown
  useEffect(() => {
    if (!open) return
    const loadKeys = async () => {
      try {
        const keys = await window.novadeck.clientkey.getAll()
        if (keys) {
          setClientKeys(
            (keys as any[]).map((k) => ({
              id: k.id,
              name: k.name,
              keyType: k.keyType,
              fingerprint: k.fingerprint
            }))
          )
        }
      } catch {
        // Client key API may not be available
      }
    }
    loadKeys()
  }, [open])

  // Populate form when editing or using a template
  useEffect(() => {
    if (session) {
      setForm(sessionToForm(session))
      // Restore algorithm lists from session overrides if present
      if (session.overrides?.ssh?.preferredKex) {
        setKexList(session.overrides.ssh.preferredKex.map((n) => ({ name: n, enabled: true })))
      } else {
        setKexList(DEFAULT_KEX.map((n) => ({ name: n, enabled: true })))
      }
      if (session.overrides?.ssh?.preferredCiphers) {
        setCipherList(session.overrides.ssh.preferredCiphers.map((n) => ({ name: n, enabled: true })))
      } else {
        setCipherList(DEFAULT_CIPHERS.map((n) => ({ name: n, enabled: true })))
      }
      if (session.overrides?.ssh?.preferredHmac) {
        setHmacList(session.overrides.ssh.preferredHmac.map((n) => ({ name: n, enabled: true })))
      } else {
        setHmacList(DEFAULT_HMAC.map((n) => ({ name: n, enabled: true })))
      }
      if (session.overrides?.ssh?.preferredHostKey) {
        setHostkeyList(session.overrides.ssh.preferredHostKey.map((n) => ({ name: n, enabled: true })))
      } else {
        setHostkeyList(DEFAULT_HOSTKEY.map((n) => ({ name: n, enabled: true })))
      }
    } else if (templateDefaults) {
      // Pre-fill form with template defaults
      const base = defaultFormData()
      const tpl = templateDefaults
      setForm({
        ...base,
        name: tpl.name || base.name,
        host: tpl.host || base.host,
        port: tpl.port ?? base.port,
        username: tpl.username || base.username,
        auth: tpl.auth ? { ...base.auth, ...tpl.auth } : base.auth,
        proxy: tpl.proxy ? { ...base.proxy, ...tpl.proxy } : base.proxy,
        overrides: tpl.overrides ? JSON.parse(JSON.stringify(tpl.overrides)) : base.overrides,
        startupCommands: tpl.startupCommands ? tpl.startupCommands.map((c) => ({ ...c })) : base.startupCommands,
        defaultDirectory: tpl.defaultDirectory || base.defaultDirectory,
        color: tpl.color || base.color,
        group: tpl.group || base.group,
        notes: tpl.notes || base.notes,
        shellCommand: tpl.shellCommand || base.shellCommand,
        encoding: tpl.encoding || base.encoding,
        terminalType: tpl.terminalType || base.terminalType,
        environmentVariables: tpl.environmentVariables ? { ...tpl.environmentVariables } : base.environmentVariables,
        viewPreferences: tpl.viewPreferences ? { ...base.viewPreferences, ...tpl.viewPreferences } : base.viewPreferences,
      })
      setKexList(DEFAULT_KEX.map((n) => ({ name: n, enabled: true })))
      setCipherList(DEFAULT_CIPHERS.map((n) => ({ name: n, enabled: true })))
      setHmacList(DEFAULT_HMAC.map((n) => ({ name: n, enabled: true })))
      setHostkeyList(DEFAULT_HOSTKEY.map((n) => ({ name: n, enabled: true })))
    } else {
      setForm(defaultFormData())
      setKexList(DEFAULT_KEX.map((n) => ({ name: n, enabled: true })))
      setCipherList(DEFAULT_CIPHERS.map((n) => ({ name: n, enabled: true })))
      setHmacList(DEFAULT_HMAC.map((n) => ({ name: n, enabled: true })))
      setHostkeyList(DEFAULT_HOSTKEY.map((n) => ({ name: n, enabled: true })))
    }
    setActiveTab('login')
  }, [session, templateDefaults, open])

  const update = <K extends keyof SessionFormData>(key: K, value: SessionFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const updateAuth = <K extends keyof SessionAuth>(key: K, value: SessionAuth[K]) => {
    setForm((prev) => ({ ...prev, auth: { ...prev.auth, [key]: value } }))
  }

  const updateProxy = <K extends keyof ProxyConfig>(key: K, value: ProxyConfig[K]) => {
    setForm((prev) => ({ ...prev, proxy: { ...prev.proxy, [key]: value } }))
  }

  const updateOverrides = (section: keyof SessionOverrides, key: string, value: any) => {
    setForm((prev) => ({
      ...prev,
      overrides: {
        ...prev.overrides,
        [section]: {
          ...(prev.overrides[section] as any || {}),
          [key]: value
        }
      }
    }))
  }

  const updateViewPref = <K extends keyof SessionViewPreferences>(key: K, value: SessionViewPreferences[K]) => {
    setForm((prev) => ({
      ...prev,
      viewPreferences: { ...prev.viewPreferences, [key]: value }
    }))
  }

  const handleSave = () => {
    if (!form.host || !form.username) return
    if (!form.name) {
      form.name = `${form.username}@${form.host}`
    }

    // Sync algorithm lists into overrides if SSH is not global
    if (!form.useGlobalSSH) {
      const sshOverrides = form.overrides.ssh || {}
      sshOverrides.preferredKex = kexList.filter((a) => a.enabled).map((a) => a.name)
      sshOverrides.preferredCiphers = cipherList.filter((a) => a.enabled).map((a) => a.name)
      sshOverrides.preferredHmac = hmacList.filter((a) => a.enabled).map((a) => a.name)
      sshOverrides.preferredHostKey = hostkeyList.filter((a) => a.enabled).map((a) => a.name)
      sshOverrides.compression = form.sshCompression
      form.overrides.ssh = sshOverrides
    }

    // Clear overrides for sections using global
    const finalOverrides = { ...form.overrides }
    if (form.useGlobalTerminal) delete finalOverrides.terminal
    if (form.useGlobalSFTP) delete finalOverrides.sftp
    if (form.useGlobalSSH) delete finalOverrides.ssh

    onSave({ ...form, overrides: finalOverrides })
    onClose()
  }

  const handleBrowseKey = async () => {
    const result = await window.novadeck.dialog.openFile({
      title: 'Select Private Key',
      properties: ['openFile'],
      filters: [{ name: 'Key Files', extensions: ['pem', 'ppk', 'key', ''] }]
    })
    if (!result.canceled && result.filePaths[0]) {
      updateAuth('privateKeyPath', result.filePaths[0])
    }
  }

  // ── Test Connection ──
  const [testState, setTestState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')

  const handleTestConnection = useCallback(async () => {
    if (!form.host || !form.username) {
      toast.error('Missing fields', 'Host and username are required')
      return
    }

    setTestState('testing')
    const testId = `test-${Date.now()}`

    try {
      const result = await window.novadeck.ssh.connect(testId, {
        host: form.host,
        port: form.port,
        username: form.username,
        auth: form.auth,
        proxy: form.proxy,
        overrides: form.overrides,
        encoding: form.encoding || 'utf-8',
        terminalType: form.terminalType || 'xterm-256color',
        shellCommand: form.shellCommand || '',
        environmentVariables: form.environmentVariables || {}
      })

      if (result.success) {
        setTestState('success')
        toast.success('Connection successful', `Connected to ${form.host}:${form.port} as ${form.username}`)
        // Immediately disconnect — this was only a test
        window.novadeck.ssh.disconnect(testId).catch(() => {})
      } else {
        setTestState('error')
        toast.error('Connection failed', result.error || 'Unknown error')
      }
    } catch (err) {
      setTestState('error')
      toast.error('Connection failed', String(err))
    }

    // Reset indicator after 3 seconds
    setTimeout(() => setTestState('idle'), 3000)
  }, [form])

  // ── Startup command helpers ──
  const addStartupCommand = () => {
    update('startupCommands', [...form.startupCommands, { command: '', delay: 0, waitForPrompt: true, enabled: true }])
  }

  const updateStartupCommand = (idx: number, updates: Partial<StartupCommand>) => {
    const cmds = [...form.startupCommands]
    cmds[idx] = { ...cmds[idx], ...updates }
    update('startupCommands', cmds)
  }

  const removeStartupCommand = (idx: number) => {
    update('startupCommands', form.startupCommands.filter((_, i) => i !== idx))
  }

  const moveStartupCommand = (idx: number, dir: -1 | 1) => {
    const cmds = [...form.startupCommands]
    const target = idx + dir
    if (target < 0 || target >= cmds.length) return
    ;[cmds[idx], cmds[target]] = [cmds[target], cmds[idx]]
    update('startupCommands', cmds)
  }

  // ── Env var helpers ──
  const addEnvVar = () => {
    if (!newEnvKey.trim()) return
    update('environmentVariables', { ...form.environmentVariables, [newEnvKey.trim()]: newEnvValue })
    setNewEnvKey('')
    setNewEnvValue('')
  }

  const removeEnvVar = (key: string) => {
    const vars = { ...form.environmentVariables }
    delete vars[key]
    update('environmentVariables', vars)
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/40"
            onClick={onClose}
          />

          {/* Session form panel — centered overlay */}
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', damping: 30, stiffness: 400 }}
            className="fixed inset-0 z-50 m-auto w-[540px] max-h-[90vh] bg-nd-bg-secondary border border-nd-border rounded-lg flex flex-col shadow-2xl"
            style={{ height: 'fit-content', maxHeight: '90vh' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-nd-border shrink-0">
              <h2 className="text-sm font-semibold text-nd-text-primary">
                {session ? 'Edit Session' : 'New Session'}
              </h2>
              <button
                onClick={onClose}
                className="p-1 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Tabs */}
            <div className="px-3 shrink-0 overflow-x-auto">
              <Tabs tabs={formTabs} activeTab={activeTab} onTabChange={setActiveTab} size="sm" />
            </div>

            {/* Form content */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.15 }}
                >
                  {/* ═══════ LOGIN TAB ═══════ */}
                  {activeTab === 'login' && (
                    <div className="flex flex-col gap-3">
                      <Input
                        label="Display Name"
                        placeholder="My Server"
                        value={form.name}
                        onChange={(e) => update('name', e.target.value)}
                      />
                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2">
                          <Input
                            label="Host"
                            placeholder="192.168.1.1 or example.com"
                            value={form.host}
                            onChange={(e) => update('host', e.target.value)}
                          />
                        </div>
                        <Input
                          label="Port"
                          type="number"
                          value={form.port}
                          onChange={(e) => update('port', parseInt(e.target.value) || 22)}
                        />
                      </div>
                      <Input
                        label="Username"
                        placeholder="root"
                        value={form.username}
                        onChange={(e) => update('username', e.target.value)}
                      />
                      <Select
                        label="Group"
                        value={form.group}
                        onChange={(e) => update('group', e.target.value)}
                        options={[
                          { value: '', label: 'No group' },
                          ...groups.map((g) => ({ value: g, label: g }))
                        ]}
                      />

                      {/* Auth method */}
                      <Select
                        label="Authentication Method"
                        value={form.auth.initialMethod}
                        onChange={(e) => updateAuth('initialMethod', e.target.value as AuthMethod)}
                        options={AUTH_OPTIONS}
                      />

                      {/* Dynamic auth fields */}
                      <AnimatePresence mode="wait">
                        <motion.div
                          key={form.auth.initialMethod}
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
                          className="flex flex-col gap-3 overflow-hidden"
                        >
                          {/* Password */}
                          {(form.auth.initialMethod === 'password') && (
                            <Input
                              label="Password"
                              type="password"
                              value={form.auth.password || ''}
                              onChange={(e) => updateAuth('password', e.target.value)}
                              placeholder="Enter password"
                            />
                          )}

                          {/* Public Key */}
                          {(form.auth.initialMethod === 'publickey') && (
                            <>
                              <Select
                                label="Client Key"
                                value={form.auth.clientKeyId || 'browse'}
                                onChange={(e) => {
                                  const val = e.target.value
                                  if (val === 'browse') {
                                    updateAuth('clientKeyId', undefined)
                                  } else {
                                    updateAuth('clientKeyId', val)
                                    // Clear the file path when selecting a managed key
                                    updateAuth('privateKeyPath', undefined)
                                  }
                                }}
                                options={[
                                  { value: 'browse', label: 'Browse for key file...' },
                                  ...clientKeys.map((k) => ({
                                    value: k.id,
                                    label: `${k.name} (${k.keyType} — ${k.fingerprint.substring(0, 16)}...)`
                                  }))
                                ]}
                              />
                              {(!form.auth.clientKeyId || form.auth.clientKeyId === 'browse') && (
                                <PrivateKeyField
                                  value={form.auth.privateKeyPath || ''}
                                  onChange={(v) => updateAuth('privateKeyPath', v)}
                                  onBrowse={handleBrowseKey}
                                />
                              )}
                              {form.auth.clientKeyId && form.auth.clientKeyId !== 'browse' && (
                                <p className="text-2xs text-nd-text-muted flex items-center gap-1">
                                  <Key size={10} className="text-nd-accent" />
                                  Using managed key from Client Key Manager
                                </p>
                              )}
                            </>
                          )}

                          {/* Public Key + Passphrase */}
                          {form.auth.initialMethod === 'publickey+passphrase' && (
                            <>
                              <Select
                                label="Client Key"
                                value={form.auth.clientKeyId || 'browse'}
                                onChange={(e) => {
                                  const val = e.target.value
                                  if (val === 'browse') {
                                    updateAuth('clientKeyId', undefined)
                                  } else {
                                    updateAuth('clientKeyId', val)
                                    updateAuth('privateKeyPath', undefined)
                                  }
                                }}
                                options={[
                                  { value: 'browse', label: 'Browse for key file...' },
                                  ...clientKeys.map((k) => ({
                                    value: k.id,
                                    label: `${k.name} (${k.keyType} — ${k.fingerprint.substring(0, 16)}...)`
                                  }))
                                ]}
                              />
                              {(!form.auth.clientKeyId || form.auth.clientKeyId === 'browse') && (
                                <PrivateKeyField
                                  value={form.auth.privateKeyPath || ''}
                                  onChange={(v) => updateAuth('privateKeyPath', v)}
                                  onBrowse={handleBrowseKey}
                                />
                              )}
                              <Input
                                label="Passphrase"
                                type="password"
                                value={form.auth.passphrase || ''}
                                onChange={(e) => updateAuth('passphrase', e.target.value)}
                                placeholder="Key passphrase"
                              />
                            </>
                          )}

                          {/* Public Key + Password (two-factor) */}
                          {form.auth.initialMethod === 'publickey+password' && (
                            <>
                              <Select
                                label="Client Key"
                                value={form.auth.clientKeyId || 'browse'}
                                onChange={(e) => {
                                  const val = e.target.value
                                  if (val === 'browse') {
                                    updateAuth('clientKeyId', undefined)
                                  } else {
                                    updateAuth('clientKeyId', val)
                                    updateAuth('privateKeyPath', undefined)
                                  }
                                }}
                                options={[
                                  { value: 'browse', label: 'Browse for key file...' },
                                  ...clientKeys.map((k) => ({
                                    value: k.id,
                                    label: `${k.name} (${k.keyType} — ${k.fingerprint.substring(0, 16)}...)`
                                  }))
                                ]}
                              />
                              {(!form.auth.clientKeyId || form.auth.clientKeyId === 'browse') && (
                                <PrivateKeyField
                                  value={form.auth.privateKeyPath || ''}
                                  onChange={(v) => updateAuth('privateKeyPath', v)}
                                  onBrowse={handleBrowseKey}
                                />
                              )}
                              <Input
                                label="Password (second factor)"
                                type="password"
                                value={form.auth.password || ''}
                                onChange={(e) => updateAuth('password', e.target.value)}
                                placeholder="Password for two-factor auth"
                              />
                            </>
                          )}

                          {/* Keyboard Interactive */}
                          {form.auth.initialMethod === 'keyboard-interactive' && (
                            <>
                              <Toggle
                                checked={form.auth.kbdiAutoRespond ?? false}
                                onChange={(v) => updateAuth('kbdiAutoRespond', v)}
                                label="Auto-respond with saved responses"
                              />
                              <p className="text-2xs text-nd-text-muted">
                                When connected, the server will prompt for input. Saved responses can be managed after first connection.
                              </p>
                            </>
                          )}

                          {/* GSSAPI */}
                          {form.auth.initialMethod === 'gssapi' && (
                            <>
                              <Toggle
                                checked={form.auth.gssapiDelegateCreds ?? false}
                                onChange={(v) => updateAuth('gssapiDelegateCreds', v)}
                                label="Delegate credentials"
                              />
                              <Input
                                label="Service Principal Name (SPN)"
                                value={form.auth.gssapiSPN || ''}
                                onChange={(e) => updateAuth('gssapiSPN', e.target.value)}
                                placeholder="host/server.example.com"
                              />
                              <p className="text-2xs text-nd-text-muted">
                                Requires system Kerberos configuration.
                              </p>
                            </>
                          )}

                          {/* SSH Agent */}
                          {form.auth.initialMethod === 'agent' && (
                            <>
                              <Toggle
                                checked={form.auth.agentForward ?? false}
                                onChange={(v) => updateAuth('agentForward', v)}
                                label="Forward agent to remote host"
                              />
                              <p className="text-2xs text-nd-text-muted">
                                Will use your system SSH agent for authentication.
                              </p>
                            </>
                          )}
                        </motion.div>
                      </AnimatePresence>

                      {/* Default view */}
                      <Select
                        label="Default View on Connect"
                        value={form.viewPreferences.defaultView}
                        onChange={(e) => updateViewPref('defaultView', e.target.value as any)}
                        options={DEFAULT_VIEW_OPTIONS}
                      />

                      {/* Color picker */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-nd-text-secondary">Tag Color</label>
                        <div className="flex flex-wrap gap-2">
                          {COLORS.map((color) => (
                            <button
                              key={color}
                              onClick={() => update('color', color)}
                              className={cn(
                                'w-7 h-7 rounded-full transition-all',
                                form.color === color
                                  ? 'ring-2 ring-white ring-offset-2 ring-offset-nd-bg-secondary scale-110'
                                  : 'hover:scale-110'
                              )}
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ═══════ TERMINAL TAB ═══════ */}
                  {activeTab === 'terminal' && (
                    <div className="flex flex-col gap-3">
                      <Toggle
                        checked={form.useGlobalTerminal}
                        onChange={(v) => update('useGlobalTerminal', v)}
                        label="Use global settings"
                      />

                      <div className={cn(form.useGlobalTerminal && 'opacity-40 pointer-events-none')}>
                        <div className="flex flex-col gap-3 mt-2">
                          <FontPicker
                            label="Font Family"
                            value={form.overrides.terminal?.fontFamily ?? ''}
                            onChange={(font) => updateOverrides('terminal', 'fontFamily', font)}
                            fontSize={form.overrides.terminal?.fontSize ?? 14}
                          />
                          <div className="grid grid-cols-2 gap-3">
                            <Input
                              label="Font Size"
                              type="number"
                              value={form.overrides.terminal?.fontSize ?? 14}
                              onChange={(e) => updateOverrides('terminal', 'fontSize', parseInt(e.target.value) || 14)}
                            />
                            <Input
                              label="Line Height"
                              type="number"
                              value={form.overrides.terminal?.lineHeight ?? 1.4}
                              onChange={(e) => updateOverrides('terminal', 'lineHeight', parseFloat(e.target.value) || 1.4)}
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <Select
                              label="Cursor Style"
                              value={form.overrides.terminal?.cursorStyle ?? 'block'}
                              onChange={(e) => updateOverrides('terminal', 'cursorStyle', e.target.value)}
                              options={[
                                { value: 'block', label: 'Block' },
                                { value: 'underline', label: 'Underline' },
                                { value: 'bar', label: 'Bar' }
                              ]}
                            />
                            <Toggle
                              checked={form.overrides.terminal?.cursorBlink ?? true}
                              onChange={(v) => updateOverrides('terminal', 'cursorBlink', v)}
                              label="Cursor Blink"
                            />
                          </div>
                          <Input
                            label="Scrollback Lines"
                            type="number"
                            value={form.overrides.terminal?.scrollbackLines ?? 10000}
                            onChange={(e) => updateOverrides('terminal', 'scrollbackLines', parseInt(e.target.value) || 10000)}
                          />
                          <Select
                            label="Color Scheme"
                            value={form.overrides.terminal?.colorScheme ?? 'default'}
                            onChange={(e) => updateOverrides('terminal', 'colorScheme', e.target.value)}
                            options={THEME_NAMES}
                          />
                          <div className="grid grid-cols-2 gap-3">
                            <Toggle
                              checked={form.overrides.terminal?.copyOnSelect ?? true}
                              onChange={(v) => updateOverrides('terminal', 'copyOnSelect', v)}
                              label="Copy on Select"
                            />
                            <Toggle
                              checked={form.overrides.terminal?.rightClickPaste ?? true}
                              onChange={(v) => updateOverrides('terminal', 'rightClickPaste', v)}
                              label="Right-Click Paste"
                            />
                          </div>
                          <Select
                            label="Bell Behavior"
                            value={form.overrides.terminal?.bellBehavior ?? 'none'}
                            onChange={(e) => updateOverrides('terminal', 'bellBehavior', e.target.value)}
                            options={[
                              { value: 'none', label: 'None' },
                              { value: 'sound', label: 'Sound' },
                              { value: 'visual', label: 'Visual' }
                            ]}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ═══════ SFTP TAB ═══════ */}
                  {activeTab === 'sftp' && (
                    <div className="flex flex-col gap-3">
                      <Toggle
                        checked={form.useGlobalSFTP}
                        onChange={(v) => update('useGlobalSFTP', v)}
                        label="Use global settings"
                      />

                      <div className={cn(form.useGlobalSFTP && 'opacity-40 pointer-events-none')}>
                        <div className="flex flex-col gap-3 mt-2">
                          <Select
                            label="Default View Mode"
                            value={form.overrides.sftp?.defaultViewMode ?? 'list'}
                            onChange={(e) => updateOverrides('sftp', 'defaultViewMode', e.target.value)}
                            options={[
                              { value: 'list', label: 'List' },
                              { value: 'grid', label: 'Grid' }
                            ]}
                          />
                          <Toggle
                            checked={form.overrides.sftp?.showHiddenFiles ?? false}
                            onChange={(v) => updateOverrides('sftp', 'showHiddenFiles', v)}
                            label="Show Hidden Files"
                          />
                          <Select
                            label="Double-Click Action"
                            value={form.overrides.sftp?.doubleClickAction ?? 'open'}
                            onChange={(e) => updateOverrides('sftp', 'doubleClickAction', e.target.value)}
                            options={[
                              { value: 'open', label: 'Open' },
                              { value: 'transfer', label: 'Transfer' },
                              { value: 'edit', label: 'Edit' }
                            ]}
                          />
                          <Select
                            label="Default Conflict Resolution"
                            value={form.overrides.sftp?.defaultConflictResolution ?? 'ask'}
                            onChange={(e) => updateOverrides('sftp', 'defaultConflictResolution', e.target.value)}
                            options={[
                              { value: 'ask', label: 'Ask' },
                              { value: 'overwrite', label: 'Overwrite' },
                              { value: 'overwrite-newer', label: 'Overwrite if Newer' },
                              { value: 'skip', label: 'Skip' },
                              { value: 'rename', label: 'Rename' }
                            ]}
                          />
                          <Input
                            label="Concurrent Transfers (1-10)"
                            type="number"
                            value={form.overrides.sftp?.concurrentTransfers ?? 3}
                            onChange={(e) => updateOverrides('sftp', 'concurrentTransfers', Math.min(10, Math.max(1, parseInt(e.target.value) || 3)))}
                          />
                          <div className="grid grid-cols-2 gap-3">
                            <Input
                              label="Bandwidth Up (KB/s, 0=unlimited)"
                              type="number"
                              value={form.overrides.sftp?.bandwidthLimitUp ?? 0}
                              onChange={(e) => updateOverrides('sftp', 'bandwidthLimitUp', parseInt(e.target.value) || 0)}
                            />
                            <Input
                              label="Bandwidth Down (KB/s, 0=unlimited)"
                              type="number"
                              value={form.overrides.sftp?.bandwidthLimitDown ?? 0}
                              onChange={(e) => updateOverrides('sftp', 'bandwidthLimitDown', parseInt(e.target.value) || 0)}
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <Toggle
                              checked={form.overrides.sftp?.preserveTimestamps ?? true}
                              onChange={(v) => updateOverrides('sftp', 'preserveTimestamps', v)}
                              label="Preserve Timestamps"
                            />
                            <Toggle
                              checked={form.overrides.sftp?.followSymlinks ?? true}
                              onChange={(v) => updateOverrides('sftp', 'followSymlinks', v)}
                              label="Follow Symlinks"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ═══════ SSH TAB ═══════ */}
                  {activeTab === 'ssh' && (
                    <div className="flex flex-col gap-3">
                      <Toggle
                        checked={form.useGlobalSSH}
                        onChange={(v) => update('useGlobalSSH', v)}
                        label="Use global settings"
                      />

                      <div className={cn(form.useGlobalSSH && 'opacity-40 pointer-events-none')}>
                        <div className="flex flex-col gap-3 mt-2">
                          <div className="grid grid-cols-2 gap-3">
                            <Input
                              label="Keep-Alive Interval (s)"
                              type="number"
                              value={form.overrides.ssh?.keepAliveInterval ?? 30}
                              onChange={(e) => updateOverrides('ssh', 'keepAliveInterval', parseInt(e.target.value) || 0)}
                            />
                            <Input
                              label="Keep-Alive Count Max"
                              type="number"
                              value={form.overrides.ssh?.keepAliveCountMax ?? 3}
                              onChange={(e) => updateOverrides('ssh', 'keepAliveCountMax', parseInt(e.target.value) || 3)}
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <Input
                              label="Connection Timeout (s)"
                              type="number"
                              value={form.overrides.ssh?.connectionTimeout ?? 15}
                              onChange={(e) => updateOverrides('ssh', 'connectionTimeout', parseInt(e.target.value) || 15)}
                            />
                            <Input
                              label="Reconnect Attempts (0=off)"
                              type="number"
                              value={form.overrides.ssh?.reconnectAttempts ?? 3}
                              onChange={(e) => updateOverrides('ssh', 'reconnectAttempts', parseInt(e.target.value) || 0)}
                            />
                          </div>
                          <Input
                            label="Reconnect Delay (s)"
                            type="number"
                            value={form.overrides.ssh?.reconnectDelay ?? 5}
                            onChange={(e) => updateOverrides('ssh', 'reconnectDelay', parseInt(e.target.value) || 5)}
                          />
                          <Toggle
                            checked={form.sshCompression}
                            onChange={(v) => update('sshCompression', v)}
                            label="Enable compression"
                          />

                          {/* Algorithm preference lists */}
                          <SectionLabel>Key Exchange (KEX)</SectionLabel>
                          <AlgorithmList items={kexList} onChange={setKexList} defaults={DEFAULT_KEX} />

                          <SectionLabel>Ciphers</SectionLabel>
                          <AlgorithmList items={cipherList} onChange={setCipherList} defaults={DEFAULT_CIPHERS} />

                          <SectionLabel>HMAC (Message Auth)</SectionLabel>
                          <AlgorithmList items={hmacList} onChange={setHmacList} defaults={DEFAULT_HMAC} />

                          <SectionLabel>Host Key Algorithms</SectionLabel>
                          <AlgorithmList items={hostkeyList} onChange={setHostkeyList} defaults={DEFAULT_HOSTKEY} />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ═══════ PROXY TAB ═══════ */}
                  {activeTab === 'proxy' && (
                    <div className="flex flex-col gap-3">
                      <Select
                        label="Proxy Type"
                        value={form.proxy.type}
                        onChange={(e) => updateProxy('type', e.target.value as ProxyConfig['type'])}
                        options={[
                          { value: 'none', label: 'None' },
                          { value: 'socks4', label: 'SOCKS4' },
                          { value: 'socks5', label: 'SOCKS5' },
                          { value: 'http-connect', label: 'HTTP CONNECT' }
                        ]}
                      />

                      <AnimatePresence>
                        {form.proxy.type !== 'none' && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.2 }}
                            className="flex flex-col gap-3 overflow-hidden"
                          >
                            <div className="grid grid-cols-3 gap-3">
                              <div className="col-span-2">
                                <Input
                                  label="Proxy Host"
                                  placeholder="proxy.example.com"
                                  value={form.proxy.host}
                                  onChange={(e) => updateProxy('host', e.target.value)}
                                />
                              </div>
                              <Input
                                label="Port"
                                type="number"
                                value={form.proxy.port}
                                onChange={(e) => updateProxy('port', parseInt(e.target.value) || 1080)}
                              />
                            </div>
                            <Toggle
                              checked={form.proxy.requiresAuth}
                              onChange={(v) => updateProxy('requiresAuth', v)}
                              label="Requires authentication"
                            />
                            {form.proxy.requiresAuth && (
                              <div className="grid grid-cols-2 gap-3">
                                <Input
                                  label="Username"
                                  value={form.proxy.username || ''}
                                  onChange={(e) => updateProxy('username', e.target.value)}
                                />
                                <Input
                                  label="Password"
                                  type="password"
                                  value={form.proxy.password || ''}
                                  onChange={(e) => updateProxy('password', e.target.value)}
                                />
                              </div>
                            )}
                            {form.proxy.type === 'socks5' && (
                              <Toggle
                                checked={form.proxy.remoteDNS ?? true}
                                onChange={(v) => updateProxy('remoteDNS', v)}
                                label="Resolve DNS through proxy"
                              />
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}

                  {/* ═══════ NOTES TAB ═══════ */}
                  {activeTab === 'notes' && (
                    <div className="flex flex-col gap-4">
                      {/* Notes */}
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-nd-text-secondary">Notes</label>
                        <textarea
                          value={form.notes}
                          onChange={(e) => update('notes', e.target.value)}
                          placeholder="Any notes about this server..."
                          rows={5}
                          className="w-full rounded-md border bg-nd-surface px-3 py-2 text-sm text-nd-text-primary border-nd-border placeholder:text-nd-text-muted focus:outline-none focus:border-nd-accent resize-none"
                        />
                      </div>

                      {/* Startup commands */}
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-medium text-nd-text-secondary">Startup Commands</label>
                          <Button variant="ghost" size="sm" onClick={addStartupCommand}>
                            <Plus size={12} />
                            Add
                          </Button>
                        </div>

                        {form.startupCommands.length === 0 && (
                          <p className="text-2xs text-nd-text-muted py-2">
                            No startup commands. Commands run after connecting.
                          </p>
                        )}

                        {form.startupCommands.map((cmd, idx) => (
                          <div key={idx} className="flex items-center gap-1.5 p-2 rounded border border-nd-border bg-nd-surface">
                            <Toggle
                              checked={cmd.enabled}
                              onChange={(v) => updateStartupCommand(idx, { enabled: v })}
                              className="shrink-0"
                            />
                            <input
                              type="text"
                              value={cmd.command}
                              onChange={(e) => updateStartupCommand(idx, { command: e.target.value })}
                              placeholder="command..."
                              className="flex-1 h-6 px-2 rounded bg-nd-bg-secondary border-none text-xs text-nd-text-primary placeholder:text-nd-text-muted focus:outline-none"
                            />
                            <input
                              type="number"
                              value={cmd.delay ?? 0}
                              onChange={(e) => updateStartupCommand(idx, { delay: parseInt(e.target.value) || 0 })}
                              title="Delay (ms)"
                              className="w-14 h-6 px-1.5 rounded bg-nd-bg-secondary text-2xs text-nd-text-secondary text-center focus:outline-none"
                            />
                            <div className="flex flex-col">
                              <button
                                onClick={() => moveStartupCommand(idx, -1)}
                                className="p-0.5 text-nd-text-muted hover:text-nd-text-primary"
                                disabled={idx === 0}
                              >
                                <ChevronUp size={10} />
                              </button>
                              <button
                                onClick={() => moveStartupCommand(idx, 1)}
                                className="p-0.5 text-nd-text-muted hover:text-nd-text-primary"
                                disabled={idx === form.startupCommands.length - 1}
                              >
                                <ChevronDown size={10} />
                              </button>
                            </div>
                            <button
                              onClick={() => removeStartupCommand(idx)}
                              className="p-0.5 text-nd-text-muted hover:text-nd-error"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ═══════ ADVANCED TAB ═══════ */}
                  {activeTab === 'advanced' && (
                    <div className="flex flex-col gap-4">
                      {/* Environment Variables */}
                      <div className="flex flex-col gap-2">
                        <label className="text-xs font-medium text-nd-text-secondary">Environment Variables</label>
                        {Object.entries(form.environmentVariables).map(([key, val]) => (
                          <div key={key} className="flex items-center gap-2 text-xs">
                            <span className="font-mono text-nd-accent bg-nd-surface px-2 py-1 rounded">{key}</span>
                            <span className="text-nd-text-muted">=</span>
                            <span className="font-mono text-nd-text-primary flex-1 truncate">{val}</span>
                            <button
                              onClick={() => removeEnvVar(key)}
                              className="p-0.5 text-nd-text-muted hover:text-nd-error"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        ))}
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={newEnvKey}
                            onChange={(e) => setNewEnvKey(e.target.value)}
                            placeholder="KEY"
                            className="w-28 h-7 px-2 rounded bg-nd-surface border border-nd-border text-xs text-nd-text-primary placeholder:text-nd-text-muted focus:outline-none focus:border-nd-accent font-mono"
                          />
                          <input
                            type="text"
                            value={newEnvValue}
                            onChange={(e) => setNewEnvValue(e.target.value)}
                            placeholder="value"
                            className="flex-1 h-7 px-2 rounded bg-nd-surface border border-nd-border text-xs text-nd-text-primary placeholder:text-nd-text-muted focus:outline-none focus:border-nd-accent font-mono"
                          />
                          <Button variant="ghost" size="sm" onClick={addEnvVar} disabled={!newEnvKey.trim()}>
                            <Plus size={12} />
                          </Button>
                        </div>
                      </div>

                      {/* Shell Request */}
                      <Select
                        label="Shell Request"
                        value={form.shellCommand ? 'custom' : 'shell'}
                        onChange={(e) => {
                          if (e.target.value === 'shell') update('shellCommand', '')
                          else if (e.target.value === 'exec') update('shellCommand', '')
                        }}
                        options={[
                          { value: 'shell', label: 'Default Shell' },
                          { value: 'exec', label: 'Exec Command' },
                          { value: 'custom', label: 'Custom' }
                        ]}
                      />
                      {form.shellCommand !== '' && (
                        <Input
                          label="Custom Command"
                          placeholder="/bin/bash --login"
                          value={form.shellCommand}
                          onChange={(e) => update('shellCommand', e.target.value)}
                        />
                      )}

                      {/* PTY Settings */}
                      <div className="grid grid-cols-2 gap-3">
                        <Select
                          label="Terminal Type"
                          value={form.terminalType}
                          onChange={(e) => update('terminalType', e.target.value)}
                          options={[
                            { value: 'xterm-256color', label: 'xterm-256color' },
                            { value: 'xterm', label: 'xterm' },
                            { value: 'vt100', label: 'vt100' }
                          ]}
                        />
                        <Select
                          label="Encoding"
                          value={form.encoding}
                          onChange={(e) => update('encoding', e.target.value)}
                          options={[
                            { value: 'utf-8', label: 'UTF-8' },
                            { value: 'iso-8859-1', label: 'ISO-8859-1' },
                            { value: 'windows-1252', label: 'Windows-1252' }
                          ]}
                        />
                      </div>

                      {/* SSH Compression */}
                      <Toggle
                        checked={form.sshCompression}
                        onChange={(v) => update('sshCompression', v)}
                        label="SSH Compression"
                      />
                      {form.sshCompression && (
                        <Select
                          label="Compression Method"
                          value={form.compressionMethod}
                          onChange={(e) => update('compressionMethod', e.target.value)}
                          options={[
                            { value: 'zlib', label: 'zlib' },
                            { value: 'zlib@openssh.com', label: 'zlib@openssh.com' }
                          ]}
                        />
                      )}

                      {/* Default Remote Directory */}
                      <Input
                        label="Default Remote Directory"
                        placeholder="/home/user or /var/www"
                        value={form.defaultDirectory}
                        onChange={(e) => update('defaultDirectory', e.target.value)}
                      />
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-nd-border shrink-0">
              <Button
                variant="outline"
                onClick={handleTestConnection}
                disabled={!form.host || !form.username || testState === 'testing'}
              >
                {testState === 'testing' && <Loader2 size={14} className="animate-spin" />}
                {testState === 'success' && <CheckCircle size={14} className="text-nd-success" />}
                {testState === 'error' && <XCircle size={14} className="text-nd-error" />}
                {testState === 'idle' && <Plug size={14} />}
                {testState === 'testing' ? 'Testing...' : testState === 'success' ? 'Connected!' : testState === 'error' ? 'Failed' : 'Test Connection'}
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleSave}
                  disabled={!form.host || !form.username}
                >
                  <Save size={14} />
                  {session ? 'Update' : 'Create'}
                </Button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ── Sub-components ──

function PrivateKeyField({
  value,
  onChange,
  onBrowse
}: {
  value: string
  onChange: (v: string) => void
  onBrowse: () => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-nd-text-secondary">Private Key</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="/path/to/key"
          className="flex-1 h-8 rounded-md border bg-nd-surface px-3 text-sm text-nd-text-primary border-nd-border placeholder:text-nd-text-muted focus:outline-none focus:border-nd-accent"
        />
        <Button size="sm" onClick={onBrowse}>
          <Key size={13} />
          Browse
        </Button>
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mt-2">
      <span className="text-xs font-semibold text-nd-text-secondary">{children}</span>
      <div className="flex-1 h-px bg-nd-border" />
    </div>
  )
}

function AlgorithmList({
  items,
  onChange,
  defaults
}: {
  items: AlgoItem[]
  onChange: (items: AlgoItem[]) => void
  defaults: string[]
}) {
  const move = (idx: number, dir: -1 | 1) => {
    const list = [...items]
    const target = idx + dir
    if (target < 0 || target >= list.length) return
    ;[list[idx], list[target]] = [list[target], list[idx]]
    onChange(list)
  }

  const toggleEnabled = (idx: number) => {
    const list = [...items]
    list[idx] = { ...list[idx], enabled: !list[idx].enabled }
    onChange(list)
  }

  const resetToDefaults = () => {
    onChange(defaults.map((n) => ({ name: n, enabled: true })))
  }

  return (
    <div className="flex flex-col gap-0.5">
      {items.map((item, idx) => {
        const warning = ALGO_WARNINGS[item.name]
        return (
          <div
            key={item.name}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded text-xs',
              item.enabled ? 'bg-nd-surface' : 'bg-nd-surface/40 opacity-60'
            )}
          >
            <input
              type="checkbox"
              checked={item.enabled}
              onChange={() => toggleEnabled(idx)}
              className="w-3.5 h-3.5 rounded border-nd-border accent-nd-accent shrink-0"
            />
            <span className={cn('flex-1 font-mono text-2xs', item.enabled ? 'text-nd-text-primary' : 'text-nd-text-muted line-through')}>
              {item.name}
            </span>
            {warning && (
              <Tooltip content={warning}>
                <AlertTriangle size={10} className="text-nd-warning shrink-0" />
              </Tooltip>
            )}
            <button
              onClick={() => move(idx, -1)}
              disabled={idx === 0}
              className="p-0.5 text-nd-text-muted hover:text-nd-text-primary disabled:opacity-30"
            >
              <ChevronUp size={10} />
            </button>
            <button
              onClick={() => move(idx, 1)}
              disabled={idx === items.length - 1}
              className="p-0.5 text-nd-text-muted hover:text-nd-text-primary disabled:opacity-30"
            >
              <ChevronDown size={10} />
            </button>
          </div>
        )
      })}
      <Button variant="ghost" size="sm" className="self-end mt-1" onClick={resetToDefaults}>
        <RotateCcw size={11} />
        Reset to defaults
      </Button>
    </div>
  )
}
