import { Cloud, Lock } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import type { CloudflareStatus, HostnameStatus } from '@/types/ssl'
import { placeholderGroups, tokenChip } from '@/utils/ssl/settingsPermissions'
import { CLOUDFLARE_TOKEN_DOCS_URL, cloudflareTokenUrl } from '@/utils/ssl/settingsToken'
import { CLOUDFLARE_ORANGE } from './cloudflareColor'
import { PermissionGroups } from './PermissionGroups'
import { CardHeading, ErrorLine, LoadingLine, SettingsCard, StatusChip } from './SettingsCard'
import { TokenForm } from './TokenForm'
import { useCloudflareToken, type CloudflareToken } from './useCloudflareToken'
import { ZoneList } from './ZoneList'

function StoredNote() {
  return (
    <span className="flex items-center gap-1.5 text-xs text-nd-text-muted">
      <Lock size={13} />
      Stored encrypted on this PC. Never sent to your servers.
    </span>
  )
}

function TokenChip({ status }: { status: CloudflareStatus }) {
  const { tone, text } = tokenChip(status)
  return <StatusChip tone={tone}>{text}</StatusChip>
}

function SavedToken({ status, token }: { status: CloudflareStatus; token: CloudflareToken }) {
  const [replacing, setReplacing] = useState(false)
  const replace = async (value: string) => {
    const saved = await token.save(value)
    if (saved) setReplacing(false)
    return saved
  }

  if (replacing) return <TokenForm busy={token.busy} submitLabel="Replace" onSubmit={replace} onCancel={() => setReplacing(false)} />
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="flex h-8 min-w-0 flex-1 items-center rounded-md border border-nd-border bg-nd-bg-primary px-3 font-mono text-xs text-nd-text-secondary">
          ••••••••••••••••{status.tokenHint.replace('…', '')}
        </div>
        <Button disabled={token.busy} onClick={() => setReplacing(true)}>Replace</Button>
        <Button variant="ghost" className="text-nd-error hover:text-nd-error" disabled={token.busy} onClick={() => void token.remove()}>Remove</Button>
      </div>
      {status.error && <span className="text-xs text-nd-error">{status.error}</span>}
    </div>
  )
}

interface CardBodyProps {
  status: CloudflareStatus
  token: CloudflareToken
  hostnames: HostnameStatus[]
  onSetZoneStrict: (zone: string) => void
}

function CardBody({ status, token, hostnames, onSetZoneStrict }: CardBodyProps) {
  const connected = status.saved && !status.error
  return (
    <>
      {status.saved ? (
        <SavedToken status={status} token={token} />
      ) : (
        <>
          <span className="text-xs text-nd-text-secondary">
            Create a token with the permissions below, then paste it here. Shellway only reads your zones, DNS records and SSL mode.{' '}
            <a className="text-nd-accent hover:underline" href={CLOUDFLARE_TOKEN_DOCS_URL} target="_blank" rel="noreferrer">How Cloudflare tokens work</a>
          </span>
          <TokenForm busy={token.busy} submitLabel="Save" onSubmit={token.save} />
        </>
      )}
      <StoredNote />
      <PermissionGroups groups={connected ? status.permissions : placeholderGroups()} showState={connected} />
      {connected && <ZoneList zones={status.zones} hostnames={hostnames} onSetStrict={onSetZoneStrict} />}
    </>
  )
}

interface CloudflareCardProps {
  hostnames: HostnameStatus[]
  onChanged: () => void
  onSetZoneStrict: (zone: string) => void
}

export function CloudflareCard({ hostnames, onChanged, onSetZoneStrict }: CloudflareCardProps) {
  const token = useCloudflareToken(onChanged)
  const { data, error, loading, reload } = token.status
  return (
    <SettingsCard label="Cloudflare token">
      <CardHeading title="Cloudflare API token" icon={<Cloud size={18} style={{ color: CLOUDFLARE_ORANGE }} aria-hidden />}>
        {data && <TokenChip status={data} />}
        <a className="ml-auto text-xs text-nd-accent hover:underline" href={cloudflareTokenUrl()} target="_blank" rel="noreferrer">Create a token</a>
      </CardHeading>
      {data && <CardBody status={data} token={token} hostnames={hostnames} onSetZoneStrict={onSetZoneStrict} />}
      {!data && loading && <LoadingLine text="Checking the token…" />}
      {!data && error && <ErrorLine message={error} onRetry={() => void reload()} />}
    </SettingsCard>
  )
}
