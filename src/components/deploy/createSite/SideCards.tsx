import type { ReactNode } from 'react'
import { Cloud, Folder, Lock, Play, Server } from 'lucide-react'
import { CardLabel } from '@/components/ssl/Card'

function SideCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="mt-auto flex flex-col gap-2.5 rounded-[10px] border border-nd-border bg-nd-surface p-3.5">
      <CardLabel>{label}</CardLabel>
      {children}
    </section>
  )
}

export function SetsUpCard({ serverLabel }: { serverLabel: string }) {
  const items = [
    { icon: Folder, text: 'Folder and permissions' },
    { icon: Server, text: `${serverLabel} site` },
    { icon: Cloud, text: 'DNS record on Cloudflare' },
    { icon: Lock, text: 'HTTPS certificate' },
    { icon: Play, text: 'Auto deploys and first deploy' }
  ]
  return (
    <SideCard label="Shellway will set up">
      <ul className="flex flex-col gap-1.5 text-[12.5px] text-nd-text-secondary">
        {items.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-2"><Icon size={14} className="shrink-0 text-nd-text-muted" aria-hidden />{text}</li>
        ))}
      </ul>
      <span className="border-t border-nd-border pt-2 text-xs text-nd-text-muted">You see every command before anything runs.</span>
    </SideCard>
  )
}

export function IfStepFailsCard() {
  return (
    <SideCard label="If a step fails">
      <span className="text-[12.5px] text-nd-text-secondary">
        Shellway stops there. Finished steps stay, so you can fix the problem and continue, or remove everything this wizard created.
      </span>
    </SideCard>
  )
}
