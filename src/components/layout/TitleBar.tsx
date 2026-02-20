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
        <div className="w-4 h-4 rounded bg-gradient-to-br from-blue-500 to-indigo-600" />
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
