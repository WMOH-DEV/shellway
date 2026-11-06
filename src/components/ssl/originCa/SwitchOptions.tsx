import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'
import type { OriginKeyType, OriginValidityYears } from '@/types/ssl'
import { KEY_LABELS, VALIDITY_CHOICES, validityLabel } from '@/utils/ssl/switchWizard/steps'
import { CardLabel } from '../Card'
import type { SwitchFlow } from './useSwitchFlow'

interface ChoiceProps {
  on: boolean
  onClick: () => void
  children: ReactNode
}

function Choice({ on, onClick, children }: ChoiceProps) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'flex min-w-[96px] flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nd-accent',
        on ? 'border-nd-accent/70 bg-nd-accent/[.07]' : 'border-nd-border bg-nd-bg-primary hover:bg-nd-bg-tertiary'
      )}
    >
      {children}
    </button>
  )
}

const KEY_NOTES: Record<OriginKeyType, string> = { ecc: 'Smaller and faster. Default.', rsa: 'For very old clients.' }

function Validity({ years, onChange }: { years: OriginValidityYears; onChange: (years: OriginValidityYears) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <CardLabel>Valid for</CardLabel>
      <div role="group" aria-label="Validity" className="flex flex-wrap gap-2">
        {VALIDITY_CHOICES.map((choice) => (
          <Choice key={choice} on={years === choice} onClick={() => onChange(choice)}>
            <span className="text-[13px] font-semibold text-nd-text-primary">{validityLabel(choice)}</span>
            {choice === 15 && <span className="text-xs text-nd-text-muted">Longest. Default.</span>}
          </Choice>
        ))}
      </div>
    </div>
  )
}

function KeyType({ keyType, onChange }: { keyType: OriginKeyType; onChange: (keyType: OriginKeyType) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <CardLabel>Key type</CardLabel>
      <div role="group" aria-label="Key type" className="flex flex-wrap gap-2">
        {(Object.keys(KEY_LABELS) as OriginKeyType[]).map((choice) => (
          <Choice key={choice} on={keyType === choice} onClick={() => onChange(choice)}>
            <span className="text-[13px] font-semibold text-nd-text-primary">{KEY_LABELS[choice]}</span>
            <span className="text-xs text-nd-text-muted">{KEY_NOTES[choice]}</span>
          </Choice>
        ))}
      </div>
    </div>
  )
}

export function SwitchOptions({ flow }: { flow: SwitchFlow }) {
  return (
    <section aria-label="Certificate options" className="flex flex-wrap items-start gap-x-10 gap-y-4 rounded-[10px] border border-nd-border bg-nd-bg-secondary p-4">
      <Validity years={flow.years} onChange={flow.setYears} />
      <KeyType keyType={flow.keyType} onChange={flow.setKeyType} />
    </section>
  )
}
