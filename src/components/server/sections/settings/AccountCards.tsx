import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { deployApi } from '@/components/deploy/useDeploySites'
import { Button } from '@/components/ui/Button'
import { Chip, SectionCard } from '../../kit'

export function CloudflareTokenCard({ onOpen }: { onOpen(): void }) {
  return (
    <SectionCard title="Cloudflare token">
      <p className="text-[13px] text-nd-text-muted">
        Used to check how Cloudflare serves your sites, switch them to an Origin certificate, and add DNS records when you create a site. To let Create site add DNS records, give the token the <span className="font-medium text-nd-text-secondary">Create DNS records</span> permission group (<span className="font-mono text-xs">Zone › DNS › Edit</span>).
      </p>
      <div>
        <Button onClick={onOpen}>Manage Cloudflare token<ChevronRight size={14} /></Button>
      </div>
    </SectionCard>
  )
}

export function GithubCard() {
  const [saved, setSaved] = useState<boolean | null>(null)

  useEffect(() => {
    void deployApi().githubTokenSaved().then((result) => setSaved(result.success && result.data === true))
  }, [])

  const forget = () => void deployApi().clearGithubToken().then(() => setSaved(false))

  return (
    <SectionCard title="GitHub login" aside={saved !== null && <Chip dense tone={saved ? 'success' : 'neutral'}>{saved ? 'Token saved' : 'No token'}</Chip>}>
      <p className="text-[13px] text-nd-text-muted">
        {saved
          ? 'Shellway uses your saved GitHub token to add read-only deploy keys to your repositories. It is stored on this PC and never sent to your servers.'
          : 'No GitHub token is saved. You can add one when you set up a deploy key for a site.'}
      </p>
      {saved && (
        <div>
          <Button variant="ghost" className="text-nd-error-fg hover:text-nd-error-fg" onClick={forget}>Forget the token</Button>
        </div>
      )}
    </SectionCard>
  )
}
