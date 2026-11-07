import { useState, type FormEvent, type ReactNode } from 'react'
import { Download, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Chip } from '@/components/server/kit'
import { imageLabel } from '@/utils/server/docker/images'
import { formatSize } from '@/utils/server/docker/size'
import type { DockerContainer, DockerImage, DockerNetwork, DockerVolume } from '@/utils/server/docker/types'

function Table({ label, columns, children }: { label: string; columns: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-nd-border bg-nd-surface">
      <div role="list" className={`grid ${columns}`}>{children}</div>
    </section>
  )
}

const ROW = 'contents [&>*]:border-t [&>*]:border-nd-border [&>*]:px-4 [&>*]:py-2.5 [&>*]:flex [&>*]:items-center [&>*]:min-w-0 [&:first-child>*]:border-t-0'

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-[13px] text-nd-text-muted">{children}</p>
}

export function ImagesTab({ images, onPull, onRemove }: { images: DockerImage[]; onPull(reference: string): void; onRemove(reference: string): void }) {
  const [reference, setReference] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (reference.trim()) onPull(reference.trim())
  }
  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex items-end gap-2">
        <div className="w-80"><Input aria-label="Image to pull" placeholder="nginx:1.27" value={reference} onChange={(event) => setReference(event.target.value)} className="font-mono" /></div>
        <Button type="submit" disabled={!reference.trim()}><Download size={14} />Pull</Button>
      </form>
      {images.length === 0 ? <Empty>No images on this server.</Empty> : (
        <Table label="Images" columns="grid-cols-[minmax(0,2fr)_auto_auto_auto_auto]">
          {images.map((image) => {
            const label = imageLabel(image)
            const reference = image.repository ? label : image.id
            return (
              <div role="listitem" key={`${image.id}-${label}`} className={ROW}>
                <span className="truncate font-mono text-[13px] text-nd-text-primary">{label}</span>
                <span>{image.dangling ? <Chip dense>untagged</Chip> : image.usedBy > 0 ? <Chip tone="success" dense>used by {image.usedBy}</Chip> : <Chip dense>unused</Chip>}</span>
                <span className="text-xs text-nd-text-secondary">{formatSize(image.size)}</span>
                <span className="text-xs text-nd-text-muted">{image.createdSince}</span>
                <span className="justify-end gap-0.5">
                  {image.repository && image.tag && <Button size="sm" variant="ghost" aria-label={`Pull ${label} again`} onClick={() => onPull(label)}><Download size={14} /></Button>}
                  <Button size="sm" variant="ghost" aria-label={`Remove ${label}`} disabled={image.usedBy > 0} onClick={() => onRemove(reference)}><Trash2 size={14} /></Button>
                </span>
              </div>
            )
          })}
        </Table>
      )}
    </div>
  )
}

function volumeUsers(containers: DockerContainer[]): Map<string, string[]> {
  const users = new Map<string, string[]>()
  for (const container of containers) {
    for (const mount of container.mounts) {
      if (mount.type === 'volume' && mount.name) users.set(mount.name, [...(users.get(mount.name) ?? []), container.name])
    }
  }
  return users
}

export function VolumesTab({ volumes, containers }: { volumes: DockerVolume[]; containers: DockerContainer[] }) {
  if (volumes.length === 0) return <Empty>No volumes on this server.</Empty>
  const users = volumeUsers(containers)
  return (
    <Table label="Volumes" columns="grid-cols-[minmax(0,2fr)_auto_minmax(0,1.5fr)]">
      {volumes.map((volume) => {
        const usedBy = users.get(volume.name) ?? []
        return (
          <div role="listitem" key={volume.name} className={ROW}>
            <span className="truncate font-mono text-[13px] text-nd-text-primary" title={volume.mountpoint}>{volume.name}</span>
            <span>{volume.dangling ? <Chip dense>unused</Chip> : <Chip tone="success" dense>in use</Chip>}</span>
            <span className="truncate font-mono text-xs text-nd-text-muted">{usedBy.join(', ')}</span>
          </div>
        )
      })}
    </Table>
  )
}

export function NetworksTab({ networks, containers }: { networks: DockerNetwork[]; containers: DockerContainer[] }) {
  if (networks.length === 0) return <Empty>No networks found.</Empty>
  const counts = new Map<string, number>()
  for (const container of containers) for (const name of container.networks) counts.set(name, (counts.get(name) ?? 0) + 1)
  return (
    <Table label="Networks" columns="grid-cols-[minmax(0,2fr)_auto_auto_auto]">
      {networks.map((network) => (
        <div role="listitem" key={network.id} className={ROW}>
          <span className="truncate font-mono text-[13px] text-nd-text-primary">{network.name}</span>
          <span className="gap-1.5 text-xs text-nd-text-secondary">{network.driver}{network.internal && <Chip dense>internal</Chip>}</span>
          <span className="text-xs text-nd-text-muted">{network.scope}</span>
          <span className="text-xs text-nd-text-muted">{counts.get(network.name) ?? 0} containers</span>
        </div>
      ))}
    </Table>
  )
}
