import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import type { Leftover, RunRecord } from '@/types/createSite'
import type { DeployResult } from '@/types/deploy'
import { deletePreview, leftoversOf } from '@/utils/createSite/deletion'
import { deleteSteps } from '@/utils/createSite/removal'
import { driverFor } from '@/utils/createSite/wizard'

interface DeleteConfirmProps {
  record: RunRecord
  loadLeftovers: () => Promise<DeployResult<Leftover[]>>
  onConfirm: (typedName: string) => void
  onClose: () => void
}

function plannedDelete(record: RunRecord): string[] | Error {
  try {
    return deleteSteps(record, driverFor(record.server)).map(deletePreview)
  } catch (err) {
    return err as Error
  }
}

function useLeftovers(record: RunRecord, load: DeleteConfirmProps['loadLeftovers']): { items: Leftover[]; measuring: boolean } {
  const [measured, setMeasured] = useState<Leftover[] | null>(null)
  const [measuring, setMeasuring] = useState(true)
  const loadOnce = useRef(load)
  useEffect(() => {
    let current = true
    void loadOnce.current().then((result) => {
      if (!current) return
      if (result.success && result.data) setMeasured(result.data)
      setMeasuring(false)
    })
    return () => {
      current = false
    }
  }, [])
  return { items: measured ?? leftoversOf(record), measuring }
}

function RemovedList({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-sm text-nd-text-secondary">Nothing that Create site made is left to remove.</p>
  return (
    <>
      <p className="text-sm text-nd-text-secondary">Removed, in this order:</p>
      <ol aria-label="Will be removed" className="flex list-decimal flex-col gap-1 pl-5 text-xs text-nd-text-primary">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ol>
    </>
  )
}

function LeftoverItem({ item, measuring }: { item: Leftover; measuring: boolean }) {
  const size = item.size ?? (measuring ? 'measuring…' : null)
  const showSize = item.id === 'folder' || item.id === 'database'
  return (
    <li className="flex flex-col gap-1">
      <span>
        {item.title}
        {showSize && size && <span className="ml-1.5 font-mono text-nd-text-muted">({size})</span>}
      </span>
      {item.command && <pre aria-label={`Delete by hand: ${item.title}`} className="select-text overflow-x-auto rounded-md bg-nd-bg-sunken px-2.5 py-1.5 font-mono text-[11px] text-nd-text-secondary">{item.command}</pre>}
    </li>
  )
}

export function KeptList({ items, measuring = false }: { items: Leftover[]; measuring?: boolean }) {
  return (
    <ul aria-label="Will be kept" className="flex list-disc flex-col gap-2 pl-5 text-xs text-nd-text-primary">
      {items.map((item) => <LeftoverItem key={item.id} item={item} measuring={measuring} />)}
    </ul>
  )
}

export function DeleteConfirm({ record, loadLeftovers, onConfirm, onClose }: DeleteConfirmProps) {
  const [typed, setTyped] = useState('')
  const removed = plannedDelete(record)
  const { items, measuring } = useLeftovers(record, loadLeftovers)
  const blocked = removed instanceof Error
  const name = record.input.siteName
  return (
    <Modal open onClose={onClose} title={`Delete ${record.domain}?`} maxWidth="max-w-2xl">
      <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto">
        {blocked ? <p role="alert" className="text-sm text-nd-error-fg">{removed.message}</p> : <RemovedList items={removed} />}
        <p className="text-sm text-nd-text-secondary">Kept. Shellway never deletes your files or data. Delete them by hand if you want them gone:</p>
        <KeptList items={items} measuring={measuring} />
        <p className="text-xs text-nd-text-muted">Anything you changed by hand since Create site made it is kept too, and listed when the delete finishes.</p>
        <Input label={`Type ${name} to confirm`} value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" spellCheck={false} className="font-mono" />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={blocked || typed !== name} onClick={() => onConfirm(typed)}>Delete site</Button>
      </div>
    </Modal>
  )
}
