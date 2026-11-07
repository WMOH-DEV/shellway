import type { ReactNode } from 'react'
import { Label } from '../../kit'

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-[5px]">
      <Label>{label}</Label>
      {children}
      {hint && <span className="text-xs text-nd-text-muted">{hint}</span>}
    </label>
  )
}

export const FIELD_INPUT = 'h-[34px] w-full rounded-[7px] border border-nd-border bg-nd-bg-sunken px-2.5 text-[13px] text-nd-text-primary outline-none focus:border-nd-accent'
