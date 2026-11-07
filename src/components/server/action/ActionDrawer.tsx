import { useCallback, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useNowMs } from '@/components/deploy/useNowMs'
import { closeLaunch, reviewAgain, runAction, setDrawerOpen, stopAction, type ActionLaunch } from '@/stores/serverActionStore'
import type { RunStatus } from '@/types/server/core'
import { formatSeconds } from '@/utils/deploy/siteStatus'
import { Chip, Notice, type KitTone } from '../kit'
import { DrawerBody, DrawerFooter, Spacer } from './DrawerParts'
import { ResultView } from './ResultView'
import { ReviewView } from './ReviewView'
import { RunView } from './RunView'
import { elapsedSeconds } from './runText'
import { useDialogFocus } from './useDialogFocus'

const STATUS_CHIPS: Record<RunStatus, { tone: KitTone; label: string }> = {
  running: { tone: 'info', label: 'Running' },
  done: { tone: 'success', label: 'Done' },
  failed: { tone: 'error', label: 'Failed' },
  stopped: { tone: 'warning', label: 'Stopped' },
  lost: { tone: 'error', label: 'Lost' }
}

interface ActionDrawerProps {
  tabId: string
  sessionKey: string
  launch: ActionLaunch
}

function DrawerHeader({ launch, titleId, nowMs, onClose }: { launch: ActionLaunch; titleId: string; nowMs: number; onClose(): void }) {
  const title = launch.plan?.title ?? launch.run?.title ?? 'Preparing the plan'
  const chip = launch.run && STATUS_CHIPS[launch.run.status]
  const running = launch.phase === 'running'
  return (
    <header className="flex items-start gap-3 border-b border-nd-border px-6 py-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={titleId} className="text-[15px] font-semibold text-nd-text-primary">{title}</h2>
          {chip && <Chip tone={chip.tone} dense>{chip.label}</Chip>}
          {launch.run && <span className="font-mono text-xs text-nd-text-muted">{formatSeconds(elapsedSeconds(launch.run.startedAt, launch.run.finishedAt, nowMs))}</span>}
        </div>
        {launch.phase === 'review' && launch.plan?.summary && <p className="text-[13px] text-nd-text-muted">{launch.plan.summary}</p>}
      </div>
      <Button size="icon" variant="ghost" aria-label={running ? 'Hide panel, the action keeps running' : 'Close panel'} onClick={onClose}><X size={16} /></Button>
    </header>
  )
}

function PlanningView({ onCancel }: { onCancel(): void }) {
  return (
    <>
      <DrawerBody>
        <div role="status" className="flex items-center justify-center gap-2 py-6 text-[13px] text-nd-text-muted"><Spinner size="sm" />Preparing the plan…</div>
      </DrawerBody>
      <DrawerFooter><Spacer /><Button onClick={onCancel}>Cancel</Button></DrawerFooter>
    </>
  )
}

function ErrorView({ title, error, onClose, onRetry }: { title: string; error: string; onClose(): void; onRetry(): void }) {
  return (
    <>
      <DrawerBody><Notice tone="error" title={title}>{error}</Notice></DrawerBody>
      <DrawerFooter><Spacer /><Button onClick={onClose}>Close</Button><Button variant="primary" onClick={onRetry}>Try again</Button></DrawerFooter>
    </>
  )
}

export function ActionDrawer({ tabId, sessionKey, launch }: ActionDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const [stopAsked, setStopAsked] = useState(false)
  const confirmingStop = stopAsked && launch.phase === 'running'
  const nowMs = useNowMs(launch.phase === 'running')
  const close = useCallback(() => closeLaunch(tabId), [tabId])
  const onEscape = useCallback(() => (confirmingStop ? setStopAsked(false) : close()), [confirmingStop, close])
  useDialogFocus(panelRef, onEscape)

  const stop = () => {
    setStopAsked(false)
    void stopAction(tabId)
  }

  const body = () => {
    switch (launch.phase) {
      case 'planning':
        return <PlanningView onCancel={close} />
      case 'review':
        return launch.plan && <ReviewView plan={launch.plan} notice={launch.notice} onCancel={close} onRun={() => void runAction(tabId, sessionKey)} />
      case 'running':
        return <RunView launch={launch} nowMs={nowMs} confirmingStop={confirmingStop} onConfirmStop={setStopAsked} onStop={stop} onHide={() => setDrawerOpen(tabId, false)} />
      case 'finished':
        return launch.run && <ResultView launch={{ ...launch, run: launch.run }} nowMs={nowMs} onClose={close} onReviewAgain={() => reviewAgain(tabId)} />
      case 'error':
        return <ErrorView title={launch.plan ? 'Could not start this action' : 'Could not prepare this action'} error={launch.error ?? 'Unknown error'} onClose={close} onRetry={() => reviewAgain(tabId)} />
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" aria-hidden onClick={onEscape} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="relative flex h-full w-[720px] max-w-[92vw] flex-col border-l border-nd-border bg-nd-bg-secondary shadow-2xl outline-none">
        <DrawerHeader launch={launch} titleId={titleId} nowMs={nowMs} onClose={close} />
        {body()}
      </div>
    </div>
  )
}
