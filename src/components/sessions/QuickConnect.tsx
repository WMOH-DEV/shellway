import { useState, useCallback, useRef, useEffect } from 'react'
import { Zap } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'

interface QuickConnectProps {
  onConnect: (host: string, port: number, username: string) => void
}

/**
 * Quick connect input — parse `user@host:port` format.
 */
export function QuickConnect({ onConnect }: QuickConnectProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const focusKey = useUIStore((s) => s.quickConnectFocusKey)

  // Focus the input when requested from WelcomeScreen
  useEffect(() => {
    if (focusKey > 0 && inputRef.current) {
      inputRef.current.focus()
    }
  }, [focusKey])

  const handleConnect = useCallback(() => {
    const input = value.trim()
    if (!input) return

    let username = 'root'
    let host = input
    let port = 22

    // Parse user@host:port
    if (input.includes('@')) {
      const [user, rest] = input.split('@', 2)
      username = user
      host = rest
    }

    if (host.includes(':')) {
      const [h, p] = host.split(':', 2)
      host = h
      const parsed = parseInt(p, 10)
      if (!isNaN(parsed)) port = parsed
    }

    if (host) {
      onConnect(host, port, username)
      setValue('')
    }
  }, [value, onConnect])

  return (
    <div className="relative">
      <Zap size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-nd-text-muted" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleConnect()
        }}
        placeholder="user@host:port"
        className="w-full h-7 pl-8 pr-3 rounded bg-nd-surface border border-nd-border text-xs text-nd-text-primary placeholder:text-nd-text-muted focus:outline-none focus:border-nd-accent transition-colors"
      />
    </div>
  )
}
