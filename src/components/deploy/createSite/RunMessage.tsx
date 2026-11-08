import { Loader2 } from 'lucide-react'
import type { RunRecord } from '@/types/createSite'
import { leftoversOf } from '@/utils/createSite/deletion'
import { Callout } from './Callout'
import { KeptList } from './DeleteConfirm'

const RESUME_HINT = 'Retry this step runs it again. Continue from here marks it as done by hand, for when you fixed it yourself, and goes on with the next step.'

function doneMessage(record: RunRecord): string {
  const skipped = record.steps.filter((step) => step.status === 'skipped').length
  if (skipped === 0) return `${record.domain} is live over HTTPS and deploys are set up.`
  return `${record.domain} is set up. ${skipped === 1 ? '1 step was' : `${skipped} steps were`} marked as done by hand, so check ${skipped === 1 ? 'it' : 'them'} before relying on the site.`
}

function DeletedMessage({ record }: { record: RunRecord }) {
  const kept = record.kept ?? []
  return (
    <>
      <Callout tone="success">{record.domain} is deleted. Its files and data stay on the server until you delete them.</Callout>
      {kept.length > 0 && (
        <Callout tone="warning">
          <span>Left in place because they changed after Create site made them:</span>
          <ul aria-label="Left in place" className="flex list-disc flex-col gap-1 pl-5 text-xs">
            {kept.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </Callout>
      )}
      <KeptList items={leftoversOf(record)} />
    </>
  )
}

function DeleteMessage({ record }: { record: RunRecord }) {
  switch (record.phase) {
    case 'removing':
      return <Callout tone="neutral" icon={<Loader2 size={15} className="animate-spin" aria-hidden />}>Deleting {record.domain}…</Callout>
    case 'removed':
      return <DeletedMessage record={record} />
    default:
      return (
        <Callout tone="error">
          <span>{record.error ?? 'The delete stopped before it finished.'}</span>
          <span className="text-xs text-nd-text-muted">Parts of the site may still run. Try deleting again: what is already removed is skipped.</span>
        </Callout>
      )
  }
}

export function RunMessage({ record }: { record: RunRecord }) {
  if (record.deleting) return <DeleteMessage record={record} />
  switch (record.phase) {
    case 'failed':
      return (
        <Callout tone="error">
          <span>{record.error ?? 'A step failed.'}</span>
          <span className="text-xs text-nd-text-muted">{RESUME_HINT}</span>
        </Callout>
      )
    case 'stopped':
      return (
        <Callout tone="warning">
          <span>{record.error ?? 'Stopped. The finished steps stay as they are.'}</span>
          <span className="text-xs text-nd-text-muted">{RESUME_HINT}</span>
        </Callout>
      )
    case 'done':
      return <Callout tone="success">{doneMessage(record)}</Callout>
    case 'removing':
      return <Callout tone="neutral" icon={<Loader2 size={15} className="animate-spin" aria-hidden />}>Removing what this wizard created…</Callout>
    case 'removed':
      return <Callout tone="success">Everything this wizard created is removed. Nothing else on the server was touched.</Callout>
    case 'remove-failed':
      return (
        <Callout tone="error">
          <span>{record.error ?? 'Removal stopped before it finished.'}</span>
          <span className="text-xs text-nd-text-muted">Some of what this wizard created may still be on the server. Try again, or remove it by hand.</span>
        </Callout>
      )
    case 'running':
      return null
  }
}
