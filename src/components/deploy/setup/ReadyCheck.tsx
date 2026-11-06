import { Button } from '@/components/ui/Button'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Spinner } from '@/components/ui/Spinner'
import type { ReadyCheckModel } from './useReadyCheck'
import { ReadyItemRow } from './ReadyItemRow'

function Progress({ model }: { model: ReadyCheckModel }) {
  const { summary } = model
  if (!summary) return null
  return (
    <div className="flex items-center gap-2.5 text-xs text-nd-text-muted">
      <span><b className="font-semibold text-nd-text-primary">{summary.passed} of {summary.total}</b> ready</span>
      <ProgressBar value={(summary.passed / summary.total) * 100} size="sm" variant="success" className="w-[120px]" />
    </div>
  )
}

function Checklist({ model }: { model: ReadyCheckModel }) {
  const { items, error, deployKey } = model
  if (error) {
    return (
      <div className="flex items-center gap-3 px-4 py-3.5 text-xs text-nd-error">
        {error}
        <Button size="sm" variant="ghost" onClick={() => void model.run()}>Try again</Button>
      </div>
    )
  }
  if (!items) {
    return (
      <div className="flex items-center gap-2.5 px-4 py-3.5 text-xs text-nd-text-muted">
        <Spinner size="sm" /> Checking the server…
      </div>
    )
  }
  return <>{items.map((item) => <ReadyItemRow key={item.id} item={item} deployKey={deployKey} />)}</>
}

export function ReadyCheck({ model }: { model: ReadyCheckModel }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-[17px] font-semibold text-nd-text-primary">Ready check</h2>
          <p className="text-[13px] text-nd-text-muted">Everything the first deploy needs, in one place. Fix an item, then check again.</p>
        </div>
        <div className="flex-1" />
        <Progress model={model} />
      </div>
      <div className="flex flex-col divide-y divide-nd-border overflow-hidden rounded-xl border border-nd-border bg-nd-surface">
        <Checklist model={model} />
      </div>
    </div>
  )
}
