import { useHttpsIntentStore } from '@/stores/httpsIntentStore'
import { useUnencryptedBlock } from './useUnencryptedBlock'

interface NoHttpsChipProps {
  connectionId: string
  path: string
  healthUrl: string
}

export function NoHttpsChip({ connectionId, path, healthUrl }: NoHttpsChipProps) {
  const block = useUnencryptedBlock(connectionId, path, healthUrl)
  const request = useHttpsIntentStore((s) => s.request)
  if (!block) return null
  return (
    <button
      type="button"
      title="This site's nginx block has no certificate. Open the SSL tab to add HTTPS."
      onClick={() => request(connectionId, block.id)}
      className="shrink-0 rounded bg-nd-warning/[.12] px-1.5 py-px text-xs text-nd-warning transition-colors hover:bg-nd-warning/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nd-accent"
    >
      No HTTPS · Add
    </button>
  )
}
