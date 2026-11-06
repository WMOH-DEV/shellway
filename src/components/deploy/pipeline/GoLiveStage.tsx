import { useState } from 'react'
import { Input } from '@/components/ui/Input'
import type { SiteConfig } from '@/types/deploy'
import { releaseSwitchCommand } from '@/utils/deploy/pipelineDraft'

interface GoLiveStageProps {
  draft: SiteConfig
  patch: (changes: Partial<SiteConfig>) => void
}

const MAX_RELEASES = 50

function SharedPaths({ paths, onChange }: { paths: string[]; onChange: (paths: string[]) => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(paths.join(' '))

  const toggle = () => {
    if (!editing) setText(paths.join(' '))
    setEditing(!editing)
  }

  return (
    <>
      {editing ? (
        <div className="w-64">
          <Input
            aria-label="Kept between deploys"
            className="h-[30px] font-mono text-xs"
            placeholder=".env storage"
            autoFocus
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              onChange(e.target.value.split(/\s+/).filter(Boolean))
            }}
          />
        </div>
      ) : (
        paths.map((path) => (
          <span key={path} className="rounded-md bg-nd-bg-tertiary px-2 py-0.5 font-mono text-xs text-nd-text-secondary">{path}</span>
        ))
      )}
      {!editing && paths.length === 0 && <span className="text-xs italic text-nd-text-muted">Nothing</span>}
      <button type="button" className="text-xs text-nd-info hover:underline" onClick={toggle}>{editing ? 'Done' : 'Edit'}</button>
    </>
  )
}

export function GoLiveStage({ draft, patch }: GoLiveStageProps) {
  const releases = draft.layout === 'releases'
  const setKeep = (value: string) => {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) patch({ keepReleases: Math.min(MAX_RELEASES, Math.max(1, parsed)) })
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5 text-xs text-nd-text-muted">
      <span className="rounded-lg border border-dashed border-nd-border px-2.5 py-1.5 font-mono text-nd-text-secondary">
        {releaseSwitchCommand(draft.layout)}
      </span>
      <span>Kept between deploys</span>
      <SharedPaths paths={draft.sharedPaths} onChange={(sharedPaths) => patch({ sharedPaths })} />
      {releases && (
        <div className="ml-auto flex items-center gap-2">
          <span>Keep</span>
          <div className="w-16">
            <Input
              aria-label="Releases to keep"
              type="number"
              min={1}
              max={MAX_RELEASES}
              className="h-[30px] text-xs"
              value={draft.keepReleases}
              onChange={(e) => setKeep(e.target.value)}
            />
          </div>
          <span>releases</span>
        </div>
      )}
    </div>
  )
}
