import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Settings,
  Monitor,
  Terminal,
  FolderTree,
  Keyboard,
  Wifi,
  Palette,
  Info,
  ExternalLink,
  Heart,
  Github,
  Shield,
  Cpu,
  Bell
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { applyAccentColor, applyDensity } from '@/utils/appearance'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Toggle } from '@/components/ui/Toggle'
import { Button } from '@/components/ui/Button'
import { Tabs, type TabItem } from '@/components/ui/Tabs'
import { toast } from '@/components/ui/Toast'
import { FontPicker } from '@/components/settings/FontPicker'
import { useUIStore } from '@/stores/uiStore'
import type { AppSettings, Theme, CursorStyle, BellBehavior, InterfaceDensity, SFTPViewMode, SFTPAutocompleteMode, SFTPDoubleClickAction, SFTPConflictResolution } from '@/types/settings'
import { DEFAULT_SETTINGS } from '@/types/settings'
import { THEME_NAMES, TERMINAL_THEMES } from '@/data/terminalThemes'

const ACCENT_PRESETS = [
  '#3b82f6', // Blue (default)
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#f43f5e', // Rose
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#14b8a6', // Teal
  '#06b6d4', // Cyan
]

const SECTIONS: TabItem[] = [
  { id: 'general', label: 'General', icon: <Settings size={13} /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={13} /> },
  { id: 'terminal', label: 'Terminal', icon: <Terminal size={13} /> },
  { id: 'sftp', label: 'SFTP', icon: <FolderTree size={13} /> },
  { id: 'connection', label: 'Connection', icon: <Wifi size={13} /> },
  { id: 'about', label: 'About', icon: <Info size={13} /> }
]

interface SettingsViewProps {
  open: boolean
  onClose: () => void
}

export function SettingsView({ open, onClose }: SettingsViewProps) {
  const [activeSection, setActiveSection] = useState('general')
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(false)
  const { setTheme } = useUIStore()

  useEffect(() => {
    if (open) {
      window.novadeck.settings.getAll().then((s: unknown) => {
        setSettings(s as AppSettings)
      })
    }
  }, [open])

  const update = useCallback(
    async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      const updated = { ...settings, [key]: value }
      setSettings(updated)
      await window.novadeck.settings.update({ [key]: value })

      // Apply theme change immediately
      if (key === 'theme') {
        setTheme(value as Theme)
      }

      // Apply accent color immediately
      if (key === 'accentColor') {
        applyAccentColor(value as string)
      }

      // Apply density immediately
      if (key === 'density') {
        applyDensity(value as InterfaceDensity)
      }
    },
    [settings, setTheme]
  )

  const handleReset = useCallback(async () => {
    await window.novadeck.settings.reset()
    setSettings(DEFAULT_SETTINGS)
    setTheme(DEFAULT_SETTINGS.theme)
    applyAccentColor(DEFAULT_SETTINGS.accentColor)
    applyDensity(DEFAULT_SETTINGS.density)
    toast.info('Settings reset to defaults')
  }, [setTheme])

  return (
    <Modal open={open} onClose={onClose} title="Settings" maxWidth="max-w-2xl" className="!overflow-hidden">
      <div className="flex gap-4 h-[min(520px,calc(85vh-80px))] -mx-5 -mb-4">
        {/* Section nav */}
        <div className="w-44 border-r border-nd-border py-2 shrink-0 overflow-y-auto">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={cn(
                'w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors',
                activeSection === section.id
                  ? 'bg-nd-surface text-nd-accent border-r-2 border-nd-accent'
                  : 'text-nd-text-secondary hover:text-nd-text-primary hover:bg-nd-surface/50'
              )}
            >
              {section.icon}
              {section.label}
            </button>
          ))}
        </div>

        {/* Section content */}
        <div className="flex-1 py-2 px-5 overflow-y-auto">
          {activeSection === 'general' && (
            <>
              <SettingsSection title="General">
                <Toggle
                  checked={settings.minimizeToTray}
                  onChange={(v) => update('minimizeToTray', v)}
                  label="Minimize to system tray"
                />
                <Toggle
                  checked={settings.startOnBoot}
                  onChange={(v) => update('startOnBoot', v)}
                  label="Start on system boot"
                />
                <Toggle
                  checked={settings.checkForUpdates}
                  onChange={(v) => update('checkForUpdates', v)}
                  label="Check for updates automatically"
                />
              </SettingsSection>

              <div className="mt-6">
                <SettingsSection title="Notifications">
                  <Toggle
                    checked={settings.notificationsEnabled}
                    onChange={(v) => update('notificationsEnabled', v)}
                    label="Enable desktop notifications"
                  />
                  <div className={cn(!settings.notificationsEnabled && 'opacity-40 pointer-events-none')}>
                    <div className="flex flex-col gap-3 ml-1">
                      <Toggle
                        checked={settings.notifyOnDisconnect}
                        onChange={(v) => update('notifyOnDisconnect', v)}
                        label="Notify on connection lost"
                      />
                      <Toggle
                        checked={settings.notifyOnTransferComplete}
                        onChange={(v) => update('notifyOnTransferComplete', v)}
                        label="Notify on transfer complete"
                      />
                    </div>
                  </div>
                </SettingsSection>
              </div>

              <div className="mt-6">
                <SettingsSection title="Logging">
                  <Input
                    label="Max Log Entries (per session)"
                    type="number"
                    value={settings.logMaxEntries}
                    onChange={(e) => update('logMaxEntries', parseInt(e.target.value) || 5000)}
                  />
                  <Toggle
                    checked={settings.logDebugMode}
                    onChange={(v) => update('logDebugMode', v)}
                    label="Show debug-level SSH events"
                  />
                </SettingsSection>
              </div>
            </>
          )}

          {activeSection === 'appearance' && (
            <SettingsSection title="Appearance">
              <Select
                label="Theme"
                value={settings.theme}
                onChange={(e) => update('theme', e.target.value as Theme)}
                options={[
                  { value: 'dark', label: 'Dark' },
                  { value: 'light', label: 'Light' },
                  { value: 'system', label: 'System' }
                ]}
              />

              {/* Accent Color */}
              <div>
                <label className="block text-sm font-medium text-nd-text-secondary mb-2">
                  Accent Color
                </label>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {ACCENT_PRESETS.map((color) => (
                      <button
                        key={color}
                        onClick={() => update('accentColor', color)}
                        className={cn(
                          'w-6 h-6 rounded-full border-2 transition-all shrink-0',
                          settings.accentColor === color
                            ? 'border-nd-text-primary scale-110'
                            : 'border-transparent hover:border-nd-border-hover'
                        )}
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ))}
                  </div>
                  <input
                    type="color"
                    value={settings.accentColor}
                    onChange={(e) => update('accentColor', e.target.value)}
                    className="w-8 h-8 rounded cursor-pointer border border-nd-border bg-transparent shrink-0"
                    title="Custom color"
                  />
                </div>
              </div>

              <Select
                label="Interface Density"
                value={settings.density}
                onChange={(e) => update('density', e.target.value as InterfaceDensity)}
                options={[
                  { value: 'comfortable', label: 'Comfortable' },
                  { value: 'compact', label: 'Compact' }
                ]}
              />
            </SettingsSection>
          )}

          {activeSection === 'terminal' && (
            <>
              <TerminalPreview
                fontFamily={settings.terminalFontFamily}
                fontSize={settings.terminalFontSize}
                lineHeight={settings.terminalLineHeight}
                colorScheme={settings.terminalColorScheme}
                cursorStyle={settings.terminalCursorStyle}
                cursorBlink={settings.terminalCursorBlink}
              />

              <div className="mt-3 flex flex-col gap-3">
                <FontPicker
                  label="Font Family"
                  value={settings.terminalFontFamily}
                  onChange={(font) => update('terminalFontFamily', font)}
                />
                <div className="grid grid-cols-3 gap-3">
                  <Input
                    label="Font Size"
                    type="number"
                    value={settings.terminalFontSize}
                    onChange={(e) => update('terminalFontSize', parseInt(e.target.value) || 14)}
                  />
                  <Input
                    label="Line Height"
                    type="number"
                    value={settings.terminalLineHeight}
                    onChange={(e) => update('terminalLineHeight', parseFloat(e.target.value) || 1.4)}
                  />
                  <Input
                    label="Scrollback"
                    type="number"
                    value={settings.terminalScrollback}
                    onChange={(e) => update('terminalScrollback', parseInt(e.target.value) || 10000)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Select
                    label="Color Scheme"
                    value={settings.terminalColorScheme}
                    onChange={(e) => update('terminalColorScheme', e.target.value)}
                    options={THEME_NAMES}
                  />
                  <Select
                    label="Cursor Style"
                    value={settings.terminalCursorStyle}
                    onChange={(e) => update('terminalCursorStyle', e.target.value as CursorStyle)}
                    options={[
                      { value: 'block', label: 'Block' },
                      { value: 'underline', label: 'Underline' },
                      { value: 'bar', label: 'Bar' }
                    ]}
                  />
                </div>
                <Select
                  label="Bell"
                  value={settings.terminalBell}
                  onChange={(e) => update('terminalBell', e.target.value as BellBehavior)}
                  options={[
                    { value: 'none', label: 'Disabled' },
                    { value: 'sound', label: 'Sound' },
                    { value: 'visual', label: 'Visual Flash' }
                  ]}
                />
                <div className="flex flex-col gap-2 pt-1">
                  <Toggle
                    checked={settings.terminalCursorBlink}
                    onChange={(v) => update('terminalCursorBlink', v)}
                    label="Cursor blink"
                  />
                  <Toggle
                    checked={settings.terminalCopyOnSelect}
                    onChange={(v) => update('terminalCopyOnSelect', v)}
                    label="Copy on select"
                  />
                  <Toggle
                    checked={settings.terminalRightClickPaste}
                    onChange={(v) => update('terminalRightClickPaste', v)}
                    label="Right-click paste"
                  />
                </div>
              </div>
            </>
          )}

          {activeSection === 'sftp' && (
            <>
              <SettingsSection title="File Browser">
                <div className="grid grid-cols-2 gap-3">
                  <Select
                    label="Default View Mode"
                    value={settings.sftpDefaultViewMode}
                    onChange={(e) => update('sftpDefaultViewMode', e.target.value as SFTPViewMode)}
                    options={[
                      { value: 'list', label: 'List / Detail View' },
                      { value: 'grid', label: 'Grid / Icon View' }
                    ]}
                  />
                  <Select
                    label="Double-Click Action"
                    value={settings.sftpDoubleClickAction}
                    onChange={(e) => update('sftpDoubleClickAction', e.target.value as SFTPDoubleClickAction)}
                    options={[
                      { value: 'open', label: 'Open / Navigate' },
                      { value: 'transfer', label: 'Transfer' },
                      { value: 'edit', label: 'Open in Editor' }
                    ]}
                  />
                </div>
                <Select
                  label="Address Bar Autocomplete"
                  value={settings.sftpAutocompleteMode}
                  onChange={(e) => update('sftpAutocompleteMode', e.target.value as SFTPAutocompleteMode)}
                  options={[
                    { value: 'content', label: 'Content-Based (fetch folder contents)' },
                    { value: 'history', label: 'History-Based (visited paths only)' }
                  ]}
                />
                <Input
                  label="Default Local Directory"
                  value={settings.sftpDefaultLocalDirectory}
                  onChange={(e) => update('sftpDefaultLocalDirectory', e.target.value)}
                  placeholder="Leave empty for home directory"
                />
                <Toggle
                  checked={settings.sftpShowHiddenFiles}
                  onChange={(v) => update('sftpShowHiddenFiles', v)}
                  label="Show hidden files by default"
                />
                <Toggle
                  checked={settings.sftpFollowSymlinks}
                  onChange={(v) => update('sftpFollowSymlinks', v)}
                  label="Follow symbolic links"
                />
              </SettingsSection>

              <div className="mt-4">
                <SettingsSection title="Transfers">
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      label="Concurrent Transfers"
                      type="number"
                      value={settings.sftpConcurrentTransfers}
                      onChange={(e) => update('sftpConcurrentTransfers', parseInt(e.target.value) || 3)}
                    />
                    <Input
                      label="Bandwidth (KB/s, 0 = no limit)"
                      type="number"
                      value={settings.sftpBandwidthLimit}
                      onChange={(e) => update('sftpBandwidthLimit', parseInt(e.target.value) || 0)}
                    />
                  </div>
                  <Select
                    label="Conflict Resolution"
                    value={settings.sftpDefaultConflictResolution}
                    onChange={(e) => update('sftpDefaultConflictResolution', e.target.value as SFTPConflictResolution)}
                    options={[
                      { value: 'ask', label: 'Ask Every Time' },
                      { value: 'overwrite', label: 'Overwrite' },
                      { value: 'overwrite-newer', label: 'Overwrite if Newer' },
                      { value: 'skip', label: 'Skip' },
                      { value: 'rename', label: 'Rename' }
                    ]}
                  />
                  <Toggle
                    checked={settings.sftpPreserveTimestamps}
                    onChange={(v) => update('sftpPreserveTimestamps', v)}
                    label="Preserve file timestamps"
                  />
                </SettingsSection>
              </div>
            </>
          )}

          {activeSection === 'connection' && (
            <SettingsSection title="Connection">
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Keep-Alive Interval (sec)"
                  type="number"
                  value={settings.connectionKeepAliveInterval}
                  onChange={(e) =>
                    update('connectionKeepAliveInterval', parseInt(e.target.value) || 30)
                  }
                />
                <Input
                  label="Connection Timeout (sec)"
                  type="number"
                  value={settings.connectionTimeout}
                  onChange={(e) => update('connectionTimeout', parseInt(e.target.value) || 15)}
                />
                <Input
                  label="Reconnect Attempts"
                  type="number"
                  value={settings.connectionReconnectAttempts}
                  onChange={(e) => {
                    const v = parseInt(e.target.value)
                    update('connectionReconnectAttempts', isNaN(v) ? 3 : v)
                  }}
                />
                <Input
                  label="Reconnect Delay (sec)"
                  type="number"
                  value={settings.connectionReconnectDelay}
                  onChange={(e) => update('connectionReconnectDelay', parseInt(e.target.value) || 5)}
                />
              </div>
            </SettingsSection>
          )}

          {activeSection === 'about' && (
            <div>
              <div className="flex flex-col items-center text-center mb-6">
                {/* Logo */}
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mb-4 shadow-lg shadow-blue-500/20">
                  <Wifi size={28} className="text-white" />
                </div>
                <h3 className="text-lg font-bold text-nd-text-primary">Shellway</h3>
                <p className="text-sm text-nd-text-secondary mt-0.5">v{__APP_VERSION__}</p>
                <p className="text-xs text-nd-text-muted mt-1">Premium SSH & SFTP Desktop Client</p>
              </div>

              {/* Info cards */}
              <div className="space-y-3">
                <AboutCard
                  icon={<Shield size={14} className="text-nd-accent" />}
                  title="Security First"
                  description="AES-256-GCM encrypted credential storage, host key verification, context-isolated renderer process."
                />
                <AboutCard
                  icon={<Cpu size={14} className="text-nd-accent" />}
                  title="Built With"
                  description="Electron 33 + React 18 + TypeScript + Tailwind CSS + xterm.js. Powered by ssh2 for native SSH/SFTP."
                />
                <AboutCard
                  icon={<Heart size={14} className="text-nd-error" />}
                  title="Made With Love"
                  description="Crafted with care for developers, sysadmins, and DevOps engineers who demand a premium experience."
                />
              </div>

              {/* Links */}
              <div className="mt-5 pt-4 border-t border-nd-border space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-nd-text-muted">Electron</span>
                  <span className="text-nd-text-secondary font-mono">v33.4.x</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-nd-text-muted">Chromium</span>
                  <span className="text-nd-text-secondary font-mono">{(navigator as any).userAgentData?.brands?.find((b: any) => b.brand === 'Chromium')?.version || 'N/A'}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-nd-text-muted">Node.js</span>
                  <span className="text-nd-text-secondary font-mono">{typeof process !== 'undefined' ? process.versions?.node || 'N/A' : 'N/A'}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-nd-text-muted">Platform</span>
                  <span className="text-nd-text-secondary font-mono">{navigator.platform}</span>
                </div>
              </div>

              {/* Copyright */}
              <div className="mt-5 pt-4 border-t border-nd-border text-center">
                <p className="text-2xs text-nd-text-muted">
                  &copy; {new Date().getFullYear()} Wael Mohamed Essaid. All rights reserved.
                </p>
                <p className="text-2xs text-nd-text-muted mt-1">
                  Licensed under MIT License
                </p>
              </div>
            </div>
          )}

          {/* Reset button — show on all sections except About */}
          {activeSection !== 'about' && (
            <div className="mt-6 pt-4 border-t border-nd-border">
              <Button variant="outline" size="sm" onClick={handleReset}>
                Reset All to Defaults
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

function SettingsSection({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-nd-text-primary mb-4">{title}</h3>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  )
}

function AboutCard({
  icon,
  title,
  description
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-nd-surface/50 border border-nd-border/50">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div>
        <h4 className="text-sm font-medium text-nd-text-primary">{title}</h4>
        <p className="text-2xs text-nd-text-muted mt-0.5 leading-relaxed">{description}</p>
      </div>
    </div>
  )
}

const PREVIEW_LINES = [
  { prompt: true, text: '~$', cmd: ' ssh root@192.168.1.10' },
  { prompt: false, text: '  Welcome to Ubuntu 24.04 LTS' },
  { prompt: true, text: '~$', cmd: ' ls -la /etc/nginx' },
  { prompt: true, text: '~$', cmd: '' },
]

function TerminalPreview({
  fontFamily,
  fontSize,
  lineHeight,
  colorScheme,
  cursorStyle,
  cursorBlink,
}: {
  fontFamily: string
  fontSize: number
  lineHeight: number
  colorScheme: string
  cursorStyle: string
  cursorBlink: boolean
}) {
  const theme = TERMINAL_THEMES[colorScheme] || TERMINAL_THEMES['default']
  const primaryFont = fontFamily.split(',')[0].trim().replace(/['"]/g, '')

  // Cursor element styles
  const cursorWidth = cursorStyle === 'bar' ? 2 : fontSize * 0.6
  const cursorHeight = cursorStyle === 'underline' ? 2 : fontSize * lineHeight
  const cursorTop = cursorStyle === 'underline' ? fontSize * lineHeight - 2 : 0

  return (
    <div className="rounded-lg overflow-hidden border border-nd-border shadow-sm">
      {/* Title bar */}
      <div
        className="flex items-center gap-2 px-3 py-1.5"
        style={{ backgroundColor: theme.background, borderBottom: `1px solid ${theme.selectionBackground}` }}
      >
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
        </div>
        <span
          className="flex-1 text-center text-2xs opacity-50"
          style={{ color: theme.foreground, fontFamily: `"${primaryFont}", monospace` }}
        >
          root@server — zsh
        </span>
      </div>

      {/* Terminal body */}
      <div
        className="px-3 py-1.5 overflow-hidden"
        style={{
          backgroundColor: theme.background,
          fontFamily: `"${primaryFont}", monospace`,
          fontSize: `${fontSize}px`,
          lineHeight: lineHeight,
        }}
      >
        {PREVIEW_LINES.map((line, i) => (
          <div key={i} className="whitespace-pre flex items-center" style={{ minHeight: `${fontSize * lineHeight}px` }}>
            {line.prompt ? (
              <>
                <span style={{ color: theme.green }}>{line.text}</span>
                <span style={{ color: theme.foreground }}>{line.cmd}</span>
                {/* Show cursor on the last prompt line */}
                {i === PREVIEW_LINES.length - 1 && (
                  <span
                    className={cn(cursorBlink && 'animate-pulse')}
                    style={{
                      display: 'inline-block',
                      width: `${cursorWidth}px`,
                      height: `${cursorHeight}px`,
                      backgroundColor: theme.cursor,
                      position: 'relative',
                      top: `${cursorTop}px`,
                      marginLeft: '1px',
                      opacity: 0.8,
                      borderRadius: cursorStyle === 'bar' ? '1px' : 0,
                    }}
                  />
                )}
              </>
            ) : (
              <span style={{ color: theme.foreground }}>{line.text}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
