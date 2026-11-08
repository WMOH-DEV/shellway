import { Input } from '@/components/ui/Input'
import { Toggle } from '@/components/ui/Toggle'
import type { SiteConfig } from '@/types/deploy'

interface HealthStageProps {
  draft: SiteConfig
  patch: (changes: Partial<SiteConfig>) => void
}

export function HealthStage({ draft, patch }: HealthStageProps) {
  const hasUrl = draft.healthUrl !== ''
  const setStatus = (value: string) => {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) patch({ healthStatus: parsed })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5 text-xs text-nd-text-muted">
        <div className="min-w-[240px] flex-1">
          <Input
            aria-label="Health check URL"
            className="h-[30px] font-mono text-xs"
            placeholder="https://example.com/up"
            value={draft.healthUrl}
            onChange={(e) => patch({ healthUrl: e.target.value.trim() })}
          />
        </div>
        <span>expect</span>
        <div className="w-20">
          <Input
            aria-label="Expected status"
            type="number"
            className="h-[30px] font-mono text-xs"
            disabled={!hasUrl}
            value={draft.healthStatus}
            onChange={(e) => setStatus(e.target.value)}
          />
        </div>
        <span>5 tries, 3 s apart</span>
      </div>
      {draft.layout === 'releases' ? (
        <div className="flex flex-col gap-1">
          <Toggle checked={draft.autoRevert} onChange={(autoRevert) => patch({ autoRevert })} label="Switch back on failure" />
          <span className="text-xs text-nd-text-muted">Applies when a command after going live or the health check fails.</span>
        </div>
      ) : (
        <span className="text-xs text-nd-text-muted">In-place sites cannot switch back. A failed check marks the deploy as failed.</span>
      )}
    </div>
  )
}
