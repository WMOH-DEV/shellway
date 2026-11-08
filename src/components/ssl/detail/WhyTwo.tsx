import { useEffect, useRef, useState } from 'react'

export function WhyTwo() {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="rounded text-xs text-nd-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nd-accent"
      >
        Why two?
      </button>
      {open && (
        <div role="dialog" aria-label="Why two certificates" className="absolute right-0 top-full z-20 mt-2 w-80 rounded-lg border border-nd-border bg-nd-surface p-3.5 text-xs leading-relaxed text-nd-text-secondary shadow-2xl">
          <p>
            With Cloudflare in front, a visitor&apos;s browser only checks the certificate Cloudflare shows. Cloudflare then opens a second connection to your server and checks the certificate it finds there.
          </p>
          <p className="mt-2">
            The two certificates are separate and expire separately. Cloudflare renews its own. The one on your server is yours to renew, and when it fails, visitors see an error even though the first connection looks fine.
          </p>
        </div>
      )}
    </div>
  )
}
