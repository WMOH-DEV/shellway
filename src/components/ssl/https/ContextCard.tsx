import type { ReactNode } from 'react'
import type { InstallRoute } from '@/types/ssl'
import type { HttpsStep } from '@/utils/ssl/addHttps/steps'
import { CardLabel } from '../Card'

interface ContextCardProps {
  step: HttpsStep
  certbotDocsUrl: string | null
  route: InstallRoute | null
}

const OUTCOMES = ['HTTPS on every name you pick', 'HTTP redirected to HTTPS', 'Renewal set up and tested', 'The site watched in this tab']

function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="mt-auto flex flex-col gap-2.5 rounded-[10px] border border-nd-border bg-nd-surface p-3.5">
      <CardLabel>{label}</CardLabel>
      {children}
    </section>
  )
}

export function ContextCard({ step, certbotDocsUrl, route }: ContextCardProps) {
  if (step === 'prepare' && route === 'distro') {
    return (
      <Frame label="Using your distribution's packages">
        <span className="text-[12.5px] text-nd-text-secondary">certbot's own instructions recommend the snap. These packages come from your distribution instead: they include a renewal timer but can be older. Nothing runs until you click Install.</span>
        {certbotDocsUrl && <a className="text-xs text-nd-accent hover:underline" href={certbotDocsUrl} target="_blank" rel="noreferrer">Open certbot's instructions</a>}
      </Frame>
    )
  }
  if (step === 'prepare') {
    return (
      <Frame label="Following certbot's guide">
        <span className="text-[12.5px] text-nd-text-secondary">These are the steps certbot's own instructions list for this system. Nothing runs until you click Install.</span>
        {certbotDocsUrl && <a className="text-xs text-nd-accent hover:underline" href={certbotDocsUrl} target="_blank" rel="noreferrer">Open certbot's instructions</a>}
      </Frame>
    )
  }
  if (step === 'issue') {
    return (
      <Frame label="Why test first">
        <span className="text-[12.5px] text-nd-text-secondary">Let's Encrypt limits failed and repeated requests. The staging test catches DNS, port 80 and nginx problems without using up those limits.</span>
      </Frame>
    )
  }
  return (
    <Frame label="You'll end up with">
      <ul className="flex list-disc flex-col gap-1.5 pl-[18px] text-[12.5px] text-nd-text-secondary">
        {OUTCOMES.map((line) => <li key={line}>{line}</li>)}
      </ul>
    </Frame>
  )
}
