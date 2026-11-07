import { useState } from 'react'
import type { ServerFacts } from '@/types/server/core'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Toggle } from '@/components/ui/Toggle'
import { CodeBox, Label, Notice, Segmented } from '@/components/server/kit'
import { cleanupCommands, cleanupGroups, type CleanupGroup, type CleanupParams, type ImageMode } from '@/utils/server/docker/actions/cleanup'
import { dockerState } from '@/utils/server/docker/probes'
import { formatSize } from '@/utils/server/docker/size'

const IMAGE_OPTIONS: { value: ImageMode; label: string }[] = [
  { value: 'dangling', label: 'Untagged only' },
  { value: 'unused', label: 'All unused' },
  { value: 'none', label: 'Keep images' }
]

const DEFAULT_PARAMS: CleanupParams = { containers: true, images: 'dangling', volumes: false, buildCache: true }

const PREVIEW_NAMES = 6

function GroupLine({ group }: { group: CleanupGroup }) {
  const shown = group.names.slice(0, PREVIEW_NAMES).join(', ')
  const more = group.names.length > PREVIEW_NAMES ? ` and ${group.names.length - PREVIEW_NAMES} more` : ''
  const empty = group.key !== 'buildCache' && group.names.length === 0
  return (
    <li className="flex flex-col gap-0.5">
      <span className="text-[13px] text-nd-text-primary">
        {group.label} · {empty ? 'nothing to remove' : formatSize(group.bytes)}
      </span>
      {shown && <span className="break-all font-mono text-xs text-nd-text-muted">{shown}{more}</span>}
    </li>
  )
}

const hasChoice = (params: CleanupParams): boolean => params.containers || params.images !== 'none' || params.volumes || params.buildCache

export function CleanupModal({ open, facts, onClose, onReview }: { open: boolean; facts: ServerFacts; onClose(): void; onReview(params: CleanupParams): void }) {
  const [params, setParams] = useState<CleanupParams>(DEFAULT_PARAMS)
  const update = (patch: Partial<CleanupParams>) => setParams((previous) => ({ ...previous, ...patch }))
  const groups = cleanupGroups(facts, params)
  const commands = cleanupCommands(params, dockerState(facts)).map((entry) => entry.command).join('\n')

  return (
    <Modal open={open} onClose={onClose} title="Clean up unused Docker data" maxWidth="max-w-xl">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <Toggle checked={params.containers} onChange={(containers) => update({ containers })} label="Stopped containers" />
          <div className="flex flex-col gap-1.5">
            <Label>Images</Label>
            <Segmented ariaLabel="Images to remove" options={IMAGE_OPTIONS} value={params.images} onChange={(images) => update({ images })} />
          </div>
          <Toggle checked={params.buildCache} onChange={(buildCache) => update({ buildCache })} label="Build cache" />
        </div>
        <Notice tone="error" title="Unused volumes">
          <div className="flex flex-col gap-2">
            <span>Volumes hold data like databases and uploads. Deleting them cannot be undone.</span>
            <Toggle checked={params.volumes} onChange={(volumes) => update({ volumes })} label="Also delete unused volumes" />
          </div>
        </Notice>
        {groups.length > 0 && (
          <div className="flex flex-col gap-2">
            <Label>Will remove</Label>
            <ul className="flex flex-col gap-2">{groups.map((group) => <GroupLine key={group.key} group={group} />)}</ul>
            <CodeBox text={commands} label="commands" />
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={params.volumes ? 'danger' : 'primary'} disabled={!hasChoice(params)} onClick={() => onReview(params)}>Review clean up</Button>
        </div>
      </div>
    </Modal>
  )
}
