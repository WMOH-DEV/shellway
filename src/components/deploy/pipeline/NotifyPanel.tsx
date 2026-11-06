import { Input } from '@/components/ui/Input'
import type { SiteConfig } from '@/types/deploy'
import { notifyTarget, type NotifyTarget } from '@/utils/deploy/pipelineDraft'
import { SidePanel } from './SidePanel'

interface NotifyPanelProps {
  notifyUrl: string
  patch: (changes: Partial<SiteConfig>) => void
}

const TARGET_HINTS: Record<NotifyTarget, string> = {
  Slack: 'Sends a Slack message.',
  Discord: 'Sends a Discord message.',
  Webhook: 'Sends JSON with site, status, commit and note.'
}

export function NotifyPanel({ notifyUrl, patch }: NotifyPanelProps) {
  const target = notifyTarget(notifyUrl)
  return (
    <SidePanel title="Notify on failure">
      <span className="text-xs text-nd-text-muted">
        Deploys on the server run while your PC is off. When one fails or is switched back, the server posts once to this address.
      </span>
      <Input
        aria-label="Notification URL"
        className="h-[30px] font-mono text-xs"
        placeholder="Slack, Discord or webhook URL"
        value={notifyUrl}
        spellCheck={false}
        onChange={(e) => patch({ notifyUrl: e.target.value.trim() })}
      />
      {target && <span className="text-xs text-nd-text-muted">{TARGET_HINTS[target]}</span>}
    </SidePanel>
  )
}
