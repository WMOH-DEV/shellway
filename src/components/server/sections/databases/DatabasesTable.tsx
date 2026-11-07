import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { formatFileSize } from '@/utils/fileSize'
import { linkedSite } from '@/utils/server/databases/sites'
import type { DbDatabase, EngineFacts, SiteEnv } from '@/utils/server/databases/types'
import { Label } from '@/components/server/kit'

const COLUMNS = 'grid grid-cols-[minmax(0,1fr)_80px_70px_minmax(0,1fr)_auto] items-center gap-3.5 px-4'

interface Props {
  data: EngineFacts
  sites: SiteEnv[]
  onOpen(name: string): void
  onBackup(name: string): void
  onDrop(name: string): void
}

function UsedBy({ data, sites, database }: { data: EngineFacts; sites: SiteEnv[]; database: DbDatabase }) {
  const link = linkedSite(data.engine, database.name, sites)
  if (!link) return <span className="truncate text-[12.5px] text-nd-text-muted">no site</span>
  return (
    <span className="truncate text-[12.5px] text-nd-text-secondary" title={link.byName ? 'Matched by name, not found in the site env' : undefined}>
      {link.site}
      {link.byName && <span className="text-nd-text-muted"> (by name)</span>}
    </span>
  )
}

export function DatabasesTable({ data, sites, onOpen, onBackup, onDrop }: Props) {
  const databases = data.databases.filter((database) => !database.system)
  return (
    <section aria-label="Databases" className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-nd-border bg-nd-surface">
      <div className={`${COLUMNS} border-b border-nd-border py-2.5`}>
        <Label>Database</Label>
        <Label>Size</Label>
        <Label>Tables</Label>
        <Label>Used by</Label>
        <span />
      </div>
      {databases.length === 0 && <p className="px-4 py-6 text-[13px] text-nd-text-muted">No databases yet. Create one for a site.</p>}
      {databases.map((database) => (
        <div key={database.name} className={`${COLUMNS} py-2.5 hover:bg-nd-surface-hover`}>
          <span className="truncate font-mono text-[12.5px] text-nd-text-primary">{database.name}</span>
          <span className="font-mono text-xs text-nd-text-muted">{formatFileSize(database.sizeBytes)}</span>
          <span className="font-mono text-xs text-nd-text-muted">{database.tables ?? '—'}</span>
          <UsedBy data={data} sites={sites} database={database} />
          <span className="flex justify-end gap-1">
            <Button size="sm" variant="secondary" onClick={() => onOpen(database.name)}>Open in SQL</Button>
            <Button size="sm" variant="secondary" onClick={() => onBackup(database.name)}>Backup</Button>
            <Button size="sm" variant="ghost" aria-label={`Drop ${database.name}`} title="Drop" onClick={() => onDrop(database.name)}>
              <Trash2 size={13} />
            </Button>
          </span>
        </div>
      ))}
    </section>
  )
}
