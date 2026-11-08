import { useState, type ReactNode } from 'react'
import { Copy, Eye, EyeOff } from 'lucide-react'
import { toast } from '@/components/ui/Toast'
import { cn } from '@/utils/cn'

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-medium text-nd-text-secondary">{label}</span>
      {children}
      {error ? <span className="text-xs text-nd-error-fg">{error}</span> : hint && <span className="text-xs text-nd-text-muted">{hint}</span>}
    </label>
  )
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="mt-5 flex items-center justify-end gap-2">{children}</div>
}

export const inputClass = 'h-[34px] w-full rounded-[7px] border border-nd-border-hover bg-nd-bg-sunken px-3 text-[13px] text-nd-text-primary focus:border-nd-accent focus:outline-none focus:ring-1 focus:ring-nd-accent'

export function TextInput({ value, onChange, mono, ...rest }: { value: string; onChange(value: string): void; mono?: boolean; placeholder?: string; autoFocus?: boolean; 'aria-label'?: string }) {
  return <input {...rest} value={value} spellCheck={false} onChange={(event) => onChange(event.target.value)} className={cn(inputClass, mono && 'font-mono')} />
}

export function SecretField({ value }: { value: string }) {
  const [visible, setVisible] = useState(false)
  const copy = () => void navigator.clipboard.writeText(value).then(() => toast.success('Password copied'))
  return (
    <div className="flex items-center gap-1.5">
      <input readOnly value={visible ? value : '•'.repeat(value.length)} aria-label="Password" className={cn(inputClass, 'font-mono')} />
      <button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? 'Hide password' : 'Show password'} className="rounded-md p-2 text-nd-text-muted hover:bg-nd-surface-hover hover:text-nd-text-primary">
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
      <button type="button" onClick={copy} aria-label="Copy password" className="rounded-md p-2 text-nd-text-muted hover:bg-nd-surface-hover hover:text-nd-text-primary">
        <Copy size={14} />
      </button>
    </div>
  )
}

export function WillRun({ lines, note }: { lines: string[]; note?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-nd-text-secondary">Will run</span>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-nd-border bg-nd-bg-sunken px-3 py-2 font-mono text-xs leading-[1.7] text-nd-text-secondary">{lines.join('\n')}</pre>
      {note && <span className="text-xs text-nd-text-muted">{note}</span>}
    </div>
  )
}

export const fieldError = (value: string, pattern: RegExp, message: string): string | null => (value === '' || pattern.test(value) ? null : message)
