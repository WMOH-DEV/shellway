import { useState, useEffect } from 'react'
import { Minus, Square, X, Copy } from 'lucide-react'
import { cn } from '@/utils/cn'

/**
 * Custom frameless title bar component.
 * - macOS: traffic lights on the left (handled by OS), app title centered
 * - Windows: custom minimize/maximize/close buttons on the right
 */
export function TitleBar() {
  const [platform, setPlatform] = useState<NodeJS.Platform>('win32')
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    window.novadeck.platform.get().then(setPlatform)
    window.novadeck.window.isMaximized().then(setMaximized)

    const unsub = window.novadeck.window.onMaximizedChange(setMaximized)
    return () => { unsub() }
  }, [])

  const isMac = platform === 'darwin'

  return (
    <div
      className={cn(
        'drag-region flex items-center h-9 bg-nd-bg-primary border-b border-nd-border shrink-0 select-none',
        isMac ? 'pl-[78px] pr-3' : 'pl-3 pr-0'
      )}
    >
      {/* App branding */}
      <div className="no-drag flex items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 1024 1024" className="shrink-0">
          <defs>
            <linearGradient id="tb-bg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1e293b" />
              <stop offset="100%" stopColor="#0f172a" />
            </linearGradient>
            <linearGradient id="tb-accent" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#0284c7" />
            </linearGradient>
          </defs>
          <rect width="1024" height="1024" rx="224" fill="url(#tb-bg)" />
          <path d="M 280 320 L 520 512 L 280 704" fill="none" stroke="url(#tb-accent)" strokeWidth="80" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="580" y="664" width="180" height="80" rx="20" fill="url(#tb-accent)" />
          <circle cx="760" cy="360" r="40" fill="#38bdf8" />
          <circle cx="860" cy="460" r="40" fill="#0284c7" />
          <path d="M 760 360 L 860 460" fill="none" stroke="#38bdf8" strokeWidth="24" strokeLinecap="round" />
        </svg>
        <span className="text-xs font-semibold text-nd-text-secondary tracking-wide">
          Shellway
        </span>
      </div>

      {/* Center — current tab name (placeholder) */}
      <div className="flex-1" />

      {/* Windows controls */}
      {!isMac && (
        <div className="no-drag flex items-center h-full">
          <WindowButton onClick={() => window.novadeck.window.minimize()} aria-label="Minimize">
            <Minus size={14} />
          </WindowButton>
          <WindowButton onClick={() => window.novadeck.window.maximize()} aria-label="Maximize">
            {maximized ? <Copy size={12} className="rotate-180" /> : <Square size={11} />}
          </WindowButton>
          <WindowButton
            onClick={() => window.novadeck.window.close()}
            aria-label="Close"
            isClose
          >
            <X size={15} />
          </WindowButton>
        </div>
      )}
    </div>
  )
}

/** Windows-style window control button */
function WindowButton({
  children,
  isClose,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { isClose?: boolean }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center w-11 h-full transition-colors',
        isClose
          ? 'hover:bg-red-600 hover:text-white text-nd-text-secondary'
          : 'hover:bg-nd-surface text-nd-text-secondary hover:text-nd-text-primary'
      )}
      {...props}
    >
      {children}
    </button>
  )
}
