import type { ServerRoute } from '@/types/server/core'
import type { SoftwareChip } from '@/utils/server/overview/software'
import { Chip, SectionCard } from '../../kit'

const SOFTWARE: ServerRoute = { section: 'software' }

export function SoftwareCard({ chips, onOpen }: { chips: SoftwareChip[]; onOpen(route: ServerRoute): void }) {
  const manage = (
    <button type="button" onClick={() => onOpen(SOFTWARE)} className="text-xs text-nd-accent hover:text-nd-accent-hover">
      Manage
    </button>
  )
  return (
    <SectionCard title="Software" aside={manage}>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip) => <Chip key={chip.label} tone={chip.update ? 'info' : 'neutral'} mono>{chip.label}</Chip>)}
      </div>
    </SectionCard>
  )
}
