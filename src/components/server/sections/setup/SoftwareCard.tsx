import { SearchSelect } from '@/components/ui/SearchSelect'
import { ROWS, type Choice } from '@/utils/server/setup/catalog'
import type { RowChoice, RowChoices, RowId } from '@/utils/server/setup/types'
import { cn } from '@/utils/cn'
import { Chip, Label } from '../../kit'

interface SoftwareCardProps {
  profileTitle: string
  rows: RowChoices
  choices: Record<RowId, Choice[]>
  installed: RowId[]
  onChange(id: RowId, choice: RowChoice): void
}

function VersionField({ title, row, choices, onPick }: { title: string; row: RowChoice; choices: Choice[]; onPick(value: string): void }) {
  if (choices.length > 1) {
    return <SearchSelect aria-label={`${title} version`} value={row.value} options={choices} disabled={!row.on} onChange={onPick} className="font-mono text-[12.5px]" />
  }
  return (
    <span className={cn('flex h-8 items-center rounded-md border border-nd-border bg-nd-bg-sunken px-3 font-mono text-[12.5px] text-nd-text-secondary', !row.on && 'opacity-45')}>
      {choices[0]?.label ?? row.value}
    </span>
  )
}

export function SoftwareCard({ profileTitle, rows, choices, installed, onChange }: SoftwareCardProps) {
  return (
    <section aria-label="Software" className="flex flex-col overflow-hidden rounded-xl border border-nd-border bg-nd-surface">
      <div className="flex items-center gap-2.5 border-b border-nd-border px-4 py-3">
        <Label>Software</Label>
        <span className="text-xs text-nd-text-muted">preset for {profileTitle} · change anything</span>
      </div>
      {ROWS.map(({ id, title, detail }) => {
        const row = rows[id]
        return (
          <div key={id} className="grid grid-cols-[20px_150px_minmax(0,1fr)_150px] items-center gap-3.5 px-4 py-2.5">
            <input
              type="checkbox"
              checked={row.on}
              aria-label={title}
              onChange={(event) => onChange(id, { ...row, on: event.target.checked })}
              className="h-[15px] w-[15px] accent-nd-accent"
            />
            <span className={cn('flex items-center gap-2 text-[13px] font-medium', row.on ? 'text-nd-text-primary' : 'text-nd-text-muted')}>
              {title}
              {row.on && installed.includes(id) && <Chip dense tone="success">installed</Chip>}
            </span>
            <span className="truncate text-xs text-nd-text-muted">{detail}</span>
            <VersionField title={title} row={row} choices={choices[id]} onPick={(value) => onChange(id, { ...row, value })} />
          </div>
        )
      })}
    </section>
  )
}
