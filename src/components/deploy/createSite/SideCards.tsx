import type { ReactNode } from 'react'
import { Cloud, Folder, Lock, Play, Server } from 'lucide-react'
import { CardLabel } from '@/components/ssl/Card'
import type { CodeSource } from '@/types/createSite'

function SideCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="mt-auto flex flex-col gap-2.5 rounded-[10px] border border-nd-border bg-nd-surface p-3.5">
      <CardLabel>{label}</CardLabel>
      {children}
    </section>
  )
}

interface SetsUpProps {
  serverLabel: string
  codeSource: CodeSource
  dnsByHand: boolean
}

const CODE_ITEMS: Record<CodeSource, string | null> = {
  git: 'Auto deploys and first deploy',
  new: 'New project, its repository and first deploy',
  none: null
}

export function SetsUpCard({ serverLabel, codeSource, dnsByHand }: SetsUpProps) {
  const code = CODE_ITEMS[codeSource]
  const items = [
    { icon: Folder, text: codeSource === 'none' ? 'Folder with a placeholder page' : 'Folder and permissions' },
    { icon: Server, text: `${serverLabel} site` },
    { icon: Cloud, text: dnsByHand ? 'DNS record you add by hand' : 'DNS record on Cloudflare' },
    { icon: Lock, text: 'HTTPS certificate' },
    ...(code === null ? [] : [{ icon: Play, text: code }])
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
