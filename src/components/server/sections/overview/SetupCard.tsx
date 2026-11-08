import { Wrench } from 'lucide-react'
import { Button } from '@/components/ui/Button'

export function SetupCard({ onStart }: { onStart(): void }) {
  return (
    <section aria-label="Set up this server" className="flex items-center gap-4 rounded-xl border border-nd-accent/30 bg-nd-accent/[0.07] px-4 py-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-nd-accent/15 text-nd-accent">
        <Wrench size={18} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 className="text-[15px] font-semibold text-nd-text-primary">Set up this server</h2>
        <p className="text-[13px] text-nd-text-secondary">This looks like a new server with no web server and no sites. Pick what it should run and Shellway installs it for you, showing every command first.</p>
      </div>
      <Button variant="primary" onClick={onStart}>Start setup</Button>
    </section>
  )
}
