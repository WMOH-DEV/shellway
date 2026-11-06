import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { SwitchLeftover } from '@/types/ssl'
import { removeOutcome, undoOutcome } from '@/utils/ssl/switchWizard/switchView'
import { Card } from '../Card'
import { ActionRow } from '../detail/ActionsCard'
import { OutputPanel } from '../detail/OutputPanel'
import { useLeftover, type Leftover } from './useLeftover'

interface LeftoverCardProps {
  connectionId: string
  sessionId: string
  name: string
  enabled: boolean
  onChanged: () => void
}

const SHARED_REASON = 'Another hostname still uses this certificate.'

function RemoveRow({ item, state }: { item: SwitchLeftover; state: Leftover }) {
  return (
    <ActionRow
      title="Remove certbot certificate"
      command={`sudo -n certbot delete --cert-name ${item.lineage}`}
      note={item.lineageShared ? SHARED_REASON : 'Stops the renewals of a certificate nothing uses.'}
    >
      <Button disabled={state.busy || item.lineageShared} onClick={() => void state.removeLineage()}>
        {state.remove.running && <Loader2 size={14} className="animate-spin" />}
        Remove
      </Button>
    </ActionRow>
  )
}

function UndoRow({ item, state }: { item: SwitchLeftover; state: Leftover }) {
  return (
    <ActionRow
      title="Undo switch"
      command={item.backupPath ?? undefined}
      note="Puts the old site file back, tests nginx, reloads and verifies."
    >
      <Button disabled={state.busy} onClick={() => void state.undo.undo()}>
        {state.undo.run.running && <Loader2 size={14} className="animate-spin" />}
        Undo
      </Button>
    </ActionRow>
  )
}

function LastRun({ state }: { state: Leftover }) {
  if (state.last === 'remove') {
    return <OutputPanel command="Removing the certbot certificate" output={state.remove.output} running={state.remove.running} outcome={state.remove.running ? null : removeOutcome(state.removeResult, state.removeError)} />
  }
  if (state.last === 'undo') {
    const { undo } = state
    return <OutputPanel command="Undoing the switch" output={undo.run.output || undo.result?.output || ''} running={undo.run.running} outcome={undo.run.running ? null : undoOutcome(undo.result, undo.error)} />
  }
  return null
}

export function LeftoverCard({ connectionId, sessionId, name, enabled, onChanged }: LeftoverCardProps) {
  const state = useLeftover(connectionId, sessionId, name, enabled, onChanged)
  const { leftover } = state
  if (!leftover && state.last === null) return null
  return (
    <Card label="After the switch" ariaLabel="After the switch">
      {leftover && (
        <div className="flex flex-col">
          <p className="pb-2 text-[13px] text-nd-text-secondary">
            certbot still renews a certificate this hostname no longer uses: <span className="font-mono text-nd-text-primary">{leftover.lineage}</span>
          </p>
          <RemoveRow item={leftover} state={state} />
          {leftover.undoable && <UndoRow item={leftover} state={state} />}
        </div>
      )}
      <LastRun state={state} />
    </Card>
  )
}
