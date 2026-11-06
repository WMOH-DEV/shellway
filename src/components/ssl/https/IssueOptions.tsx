import { Input } from '@/components/ui/Input'
import { Toggle } from '@/components/ui/Toggle'
import { isValidEmail } from '@/utils/ssl/https/issueCommands'
import type { Issue } from './useIssue'

function Option({ checked, label, note, disabled, onChange }: { checked: boolean; label: string; note: string; disabled: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Toggle checked={checked} onChange={onChange} label={label} disabled={disabled} />
      <span className="pl-[46px] text-xs text-nd-text-muted">{note}</span>
    </div>
  )
}

export function IssueOptions({ issue }: { issue: Issue }) {
  const locked = issue.run.running
  const invalid = issue.email.trim() !== '' && !isValidEmail(issue.email.trim())
  return (
    <section aria-label="Options" className="flex flex-wrap items-start gap-x-7 gap-y-4 rounded-[10px] border border-nd-border bg-nd-bg-secondary p-4">
      <div className="min-w-[260px] flex-1">
        <Input
          label="Email for Let's Encrypt"
          type="email"
          autoComplete="email"
          spellCheck={false}
          className="bg-nd-bg-primary"
          placeholder="admin@example.com"
          value={issue.email}
          disabled={locked}
          error={invalid ? 'Enter a valid email address' : undefined}
          onChange={(e) => issue.setEmail(e.target.value)}
        />
        <span className="mt-1 block text-xs text-nd-text-muted">Needed for the account. Remembered for next time.</span>
      </div>
      <div className="flex min-w-[260px] flex-1 flex-col gap-3">
        <Option checked={issue.redirect} onChange={issue.setRedirect} disabled={locked} label="Redirect HTTP to HTTPS" note="Visitors on http:// are sent to https://" />
        <Option checked={issue.staging} onChange={issue.setStaging} disabled={locked} label="Test with staging first" note="If the test fails, nothing real is requested" />
      </div>
    </section>
  )
}
