import { useLayoutEffect, useRef } from 'react'

const STICK_DISTANCE = 24

export function StepOutput({ label, text, live }: { label: string; text: string; live: boolean }) {
  const ref = useRef<HTMLPreElement>(null)
  const stuck = useRef(true)

  useLayoutEffect(() => {
    const box = ref.current
    if (box && live && stuck.current) box.scrollTop = box.scrollHeight
  }, [text, live])

  const trackScroll = () => {
    const box = ref.current
    if (box) stuck.current = box.scrollHeight - box.scrollTop - box.clientHeight < STICK_DISTANCE
  }

  return (
    <section aria-label={label} className="flex min-h-0 flex-col gap-1.5">
      <span className="text-xs font-medium text-nd-text-secondary">{label}</span>
      <pre ref={ref} onScroll={trackScroll} className="max-h-[320px] min-h-[120px] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-nd-border bg-nd-bg-sunken px-3 py-2 font-mono text-xs leading-[1.6] text-nd-text-secondary">
        {text || (live ? 'Waiting for output…' : 'No output.')}
      </pre>
    </section>
  )
}
