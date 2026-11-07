import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { toast } from '@/components/ui/Toast'
import { Toggle } from '@/components/ui/Toggle'
import type { ServerNotifications, ServerNotifyEvent, ServerNotifyKind } from '@/types/server/notifications'
import { DEFAULT_SETTINGS, type AppSettings } from '@/types/settings'
import { NOTIFY_EVENT_LABEL, NOTIFY_EVENTS, NOTIFY_KIND_LABEL, NOTIFY_KINDS, notifyUrlError } from '@/utils/server/settings/notifications'
import { Label, SectionCard, Segmented, type SegmentOption } from '../../kit'
import { serverApi } from '../../serverApi'

const KIND_OPTIONS: SegmentOption<ServerNotifyKind>[] = NOTIFY_KINDS.map((kind) => ({ value: kind, label: NOTIFY_KIND_LABEL[kind] }))

const URL_HINT: Record<Exclude<ServerNotifyKind, 'off'>, string> = {
  webhook: 'Shellway posts JSON with source, event and text fields.',
  slack: 'A Slack incoming webhook address, from your Slack app settings.',
  discord: 'A Discord webhook address, from the channel settings under Integrations.'
}

export function NotificationsCard() {
  const [saved, setSaved] = useState<ServerNotifications | null>(null)
  const [draft, setDraft] = useState<ServerNotifications>(DEFAULT_SETTINGS.serverNotifications)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.novadeck.settings.getAll().then((settings: AppSettings) => {
      setSaved(settings.serverNotifications)
      setDraft(settings.serverNotifications)
    })
  }, [])

  const urlError = draft.kind === 'off' ? null : notifyUrlError(draft.url)
  const changed = saved !== null && JSON.stringify(saved) !== JSON.stringify(draft)
  const toggleEvent = (event: ServerNotifyEvent, on: boolean) =>
    setDraft({ ...draft, events: on ? [...draft.events, event] : draft.events.filter((item) => item !== event) })

  const save = async () => {
    await window.novadeck.settings.update({ serverNotifications: draft })
    setSaved(draft)
    toast.success('Notification settings saved')
  }

  const sendTest = async () => {
    setBusy(true)
    const result = await serverApi().settings.notifyTest(draft)
    setBusy(false)
    if (result.success) toast.success('Test notification sent')
    else toast.error('The test notification was not delivered', result.error)
  }

  return (
    <SectionCard title="Notifications" aside={<span className="text-xs text-nd-text-muted">All servers</span>}>
      <p className="text-[13px] text-nd-text-muted">
        Get a message when something needs you. Notifications are sent by this PC while Shellway is open. Nothing is installed on the server, and nothing is sent while Shellway is closed.
      </p>
      <Segmented ariaLabel="Send notifications to" options={KIND_OPTIONS} value={draft.kind} onChange={(kind) => setDraft({ ...draft, kind })} />
      {draft.kind !== 'off' && (
        <>
          <div className="flex flex-col gap-1">
            <Input
              label={`${NOTIFY_KIND_LABEL[draft.kind]} address`}
              className="font-mono"
              placeholder="https://"
              value={draft.url}
              error={draft.url ? urlError ?? undefined : undefined}
              onChange={(event) => setDraft({ ...draft, url: event.target.value.trim() })}
            />
            <span className="text-xs text-nd-text-muted">{URL_HINT[draft.kind]}</span>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Send when</Label>
            {NOTIFY_EVENTS.map((event) => (
              <Toggle key={event} checked={draft.events.includes(event)} onChange={(on) => toggleEvent(event, on)} label={NOTIFY_EVENT_LABEL[event]} />
            ))}
          </div>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={!changed || urlError !== null} onClick={() => void save()}>Save</Button>
        {draft.kind !== 'off' && <Button disabled={busy || urlError !== null} onClick={() => void sendTest()}>{busy ? 'Sending…' : 'Send test'}</Button>}
      </div>
    </SectionCard>
  )
}
