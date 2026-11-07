import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { SearchSelect, type SearchSelectOption } from '@/components/ui/SearchSelect'
import { cn } from '@/utils/cn'
import { changedValues } from '@/utils/server/software/phpView'
import { SectionCard } from '../../kit'

interface SettingsCardProps<K extends string> {
  title: string
  keys: readonly K[]
  values: Partial<Record<K, string>>
  choices?: Partial<Record<K, string[]>>
  isValid(key: K, value: string): boolean
  footnote: ReactNode
  aside?: ReactNode
  onApply(changed: Partial<Record<K, string>>): void
}

const fieldClass = 'h-8 w-full rounded-[7px] border bg-nd-bg-sunken px-2 font-mono text-xs text-nd-text-primary outline-none focus:border-nd-accent'

function choiceOptions(options: string[], current: string): SearchSelectOption[] {
  const known = options.map((option) => ({ value: option, label: option }))
  return options.includes(current) ? known : [{ value: current, label: current || 'not set' }, ...known]
}

export function SettingsCard<K extends string>({ title, keys, values, choices, isValid, footnote, aside, onApply }: SettingsCardProps<K>) {
  const [edited, setEdited] = useState<Partial<Record<K, string>>>(values)
  const changed = changedValues(values, edited)
  const invalid = (Object.entries(changed) as [K, string][]).some(([key, value]) => !isValid(key, value))
  const set = (key: K, value: string) => setEdited((previous) => ({ ...previous, [key]: value.trim() }))
  return (
    <SectionCard title={title} aside={aside}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        {keys.map((key) => {
          const value = edited[key] ?? ''
          const bad = value !== '' && value !== values[key] && !isValid(key, value)
          const options = choices?.[key]
          return (
            <label key={key} className="flex min-w-0 flex-col gap-1">
              <span className="truncate font-mono text-xs text-nd-text-muted">{key}</span>
              {options ? (
                <SearchSelect value={value} onChange={(next) => set(key, next)} options={choiceOptions(options, value)} mono className="h-8 rounded-[7px] border-nd-border px-2 text-xs" />
              ) : (
                <input value={value} placeholder="not set" onChange={(event) => set(key, event.target.value)} aria-invalid={bad} className={cn(fieldClass, bad ? 'border-nd-error' : 'border-nd-border')} />
              )}
            </label>
          )
        })}
      </div>
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 text-xs text-nd-text-muted">{footnote}</span>
        <Button size="sm" variant="primary" disabled={invalid || Object.keys(changed).length === 0} onClick={() => onApply(changed)}>Apply</Button>
      </div>
    </SectionCard>
  )
}
