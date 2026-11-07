import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { toast } from '@/components/ui/Toast'
import { DEFAULT_SERVER_PREFS, deployUserError, OS_FAMILY_LABEL, OS_FAMILY_OVERRIDES, type OsFamilyOverride, type ServerPrefs } from '@/utils/server/settings/prefs'
import { Label, Notice, SectionCard, Segmented, type SegmentOption } from '../../kit'
import { serverApi } from '../../serverApi'

const OS_OPTIONS: SegmentOption<OsFamilyOverride>[] = OS_FAMILY_OVERRIDES.map((family) => ({ value: family, label: OS_FAMILY_LABEL[family] }))

export function ServerPrefsCard({ sessionId, sessionName }: { sessionId: string; sessionName: string }) {
  const [saved, setSaved] = useState<ServerPrefs | null>(null)
  const [draft, setDraft] = useState<ServerPrefs>(DEFAULT_SERVER_PREFS)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    void serverApi().settings.prefs(sessionId).then((result) => {
      if (!result.success) return setLoadError(result.error)
      setSaved(result.data)
      setDraft(result.data)
    })
  }, [sessionId])

  const userError = deployUserError(draft.deployUser)
  const changed = saved !== null && (saved.deployUser !== draft.deployUser || saved.osFamily !== draft.osFamily)

  const save = async () => {
    const result = await serverApi().settings.savePrefs(sessionId, draft)
    if (!result.success) return toast.error('Could not save', result.error)
    setSaved(result.data)
    toast.success('Server settings saved')
  }

  return (
    <SectionCard title="This server" aside={<span className="truncate text-xs text-nd-text-muted">{sessionName}</span>}>
      {loadError && <Notice tone="error" title="Could not read the saved settings">{loadError}</Notice>}
      <div className="flex flex-col gap-1">
        <Input
          label="Default deploy user"
          className="font-mono"
          placeholder="deploy"
          value={draft.deployUser}
          error={userError ?? undefined}
          onChange={(event) => setDraft({ ...draft, deployUser: event.target.value.trim() })}
        />
        <span className="text-xs text-nd-text-muted">New sites are set up to run as this user. Leave it empty to use the user you log in with.</span>
      </div>
      <div className="flex flex-col gap-2">
        <Label>Operating system</Label>
        <Segmented ariaLabel="Operating system" options={OS_OPTIONS} value={draft.osFamily} onChange={(osFamily) => setDraft({ ...draft, osFamily })} />
        <span className="text-xs text-nd-text-muted">Shellway detects this on connect. Pick one only if detection gets it wrong, for example on a distribution based on Ubuntu or Debian.</span>
      </div>
      <div>
        <Button variant="primary" disabled={!changed || userError !== null} onClick={() => void save()}>Save</Button>
      </div>
    </SectionCard>
  )
}
