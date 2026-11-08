import { PROFILES } from '@/utils/server/setup/catalog'
import type { ProfileId } from '@/utils/server/setup/types'
import { cn } from '@/utils/cn'
import { Label } from '../../kit'

export function ProfilePicker({ value, onChange }: { value: ProfileId; onChange(profile: ProfileId): void }) {
  return (
    <section aria-label="Profile" className="flex flex-col gap-2">
      <Label>What will this server run?</Label>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2">
        {PROFILES.map((profile) => (
          <button
            key={profile.id}
            type="button"
            aria-pressed={profile.id === value}
            onClick={() => onChange(profile.id)}
            className={cn(
              'flex flex-col gap-1.5 rounded-[10px] border p-3.5 text-left transition-colors',
              profile.id === value ? 'border-nd-accent/70 bg-nd-accent/[0.07]' : 'border-nd-border bg-nd-surface hover:border-nd-border-hover'
            )}
          >
            <span className="text-[13px] font-semibold text-nd-text-primary">{profile.title}</span>
            <span className="text-xs text-nd-text-muted">{profile.detail}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
