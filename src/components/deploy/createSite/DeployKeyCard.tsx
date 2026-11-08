import { ExternalLink, KeyRound } from 'lucide-react'
import { Card } from '@/components/ssl/Card'
import { githubDeployKeysUrl, parseGitHubRepo } from '@/utils/deploy/githubRepo'
import { repoLabel } from '@/utils/deploy/siteDetail'
import { CodeBox } from '../setup/CodeBox'

export function DeployKeyCard({ deployKey, repoUrl, added }: { deployKey: string; repoUrl: string; added: boolean }) {
  const github = parseGitHubRepo(repoUrl)
  return (
    <Card label="Deploy key" ariaLabel="Deploy key" aside={<KeyRound size={15} className="text-nd-text-muted" aria-hidden />}>
      <span className="text-[13px] text-nd-text-secondary">
        {added
          ? `Shellway added this key to ${repoLabel(repoUrl)} as a read-only deploy key, so the server can fetch the code.`
          : `Add this key to ${repoLabel(repoUrl)} as a read-only deploy key, so the server can fetch the code.`}
      </span>
      <CodeBox code={deployKey} copyable />
      {github && (
        <a className="inline-flex items-center gap-1 text-xs text-nd-accent hover:underline" href={githubDeployKeysUrl(github)} target="_blank" rel="noreferrer">
          Open the repository deploy keys page <ExternalLink size={11} />
        </a>
      )}
    </Card>
  )
}
