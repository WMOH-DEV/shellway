import { Toggle } from '@/components/ui/Toggle'
import { SECURITY_ITEMS, type SecurityInfo } from '@/utils/server/setup/catalog'
import type { SecurityChoices, SecurityId } from '@/utils/server/setup/types'
import { Label } from '../../kit'

interface SecurityCardProps {
  security: SecurityChoices
  swapGb: number | null
  keyLogin: boolean
  onChange(id: SecurityId, on: boolean): void
}

const KEY_NEEDED = 'Not available: this connection logs in with a password. Switch it to an SSH key first.'

const SWAP_ON = { title: 'Swap is already on', detail: 'This server has swap, so no swap file is needed.' }

const isLocked = (id: SecurityId, swapGb: number | null, keyLogin: boolean): boolean =>
  (id === 'passwordLoginOff' && !keyLogin) || (id === 'swap' && swapGb === null)

function itemText(item: SecurityInfo, swapGb: number | null, keyLogin: boolean): { title: string; detail: string } {
  if (item.id === 'swap') return swapGb === null ? SWAP_ON : { title: `${swapGb} GB swap file`, detail: item.detail }
  if (item.id === 'passwordLoginOff' && !keyLogin) return { title: item.title, detail: KEY_NEEDED }
  return item
}

export function SecurityCard({ security, swapGb, keyLogin, onChange }: SecurityCardProps) {
  return (
    <section aria-label="Security baseline" className="flex flex-col overflow-hidden rounded-xl border border-nd-border bg-nd-surface">
      <div className="flex items-center gap-2.5 border-b border-nd-border px-4 py-3">
        <Label>Security baseline</Label>
        <span className="text-xs text-nd-text-muted">recommended for every server</span>
      </div>
      {SECURITY_ITEMS.map((item) => {
        const { title, detail } = itemText(item, swapGb, keyLogin)
        const locked = isLocked(item.id, swapGb, keyLogin)
        return (
          <div key={item.id} className="flex items-start gap-3 px-4 py-[11px]">
            <Toggle checked={security[item.id] && !locked} disabled={locked} ariaLabel={title} onChange={(on) => onChange(item.id, on)} className="mt-px" />
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-[13px] font-medium text-nd-text-primary">{title}</span>
              <span className="text-xs text-nd-text-muted">{detail}</span>
            </div>
          </div>
        )
      })}
    </section>
  )
}
