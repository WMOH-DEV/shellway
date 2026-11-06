import { AlertTriangle } from 'lucide-react'
import type { IssueResult } from '@/types/ssl'
import { issueFailureView } from '@/utils/ssl/addHttps/issueView'
import { OutputPanel } from '../detail/OutputPanel'
import type { Issue } from './useIssue'

function outcomeOf(result: IssueResult | null, error: string | null) {
  if (result) return { success: result.ok, message: result.ok ? 'Certificate issued' : issueFailureView(result).title }
  return error ? { success: false, message: error } : null
}

function FailureNotes({ result }: { result: IssueResult }) {
  const view = issueFailureView(result)
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-[10px] border border-nd-error/30 bg-nd-error/10 px-3.5 py-3 text-[13px] text-nd-text-secondary">
      <AlertTriangle size={15} className="mt-px shrink-0 text-nd-error" aria-hidden />
      <div className="flex flex-col gap-1">
        <span className="font-medium text-nd-error">{view.title}</span>
        {view.notes.map((note) => <span key={note}>{note}</span>)}
        {view.hint && <span className="text-nd-text-primary">{view.hint}</span>}
      </div>
    </div>
  )
}

export function IssueResultPanel({ issue, command }: { issue: Issue; command: string }) {
  const { run, result, error } = issue
  if (!run.running && !result && !error) return null
  return (
    <div className="flex flex-col gap-3">
      <OutputPanel command={command} output={run.output || result?.output || ''} running={run.running} outcome={run.running ? null : outcomeOf(result, error)} />
      {result && !result.ok && <FailureNotes result={result} />}
    </div>
  )
}
