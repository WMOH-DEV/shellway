import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { formatFileSize } from '@/utils/fileSize'
import { scheduleLabel } from '@/utils/server/databases/actions/backup'
import { BACKUP_DIR } from '@/utils/server/databases/backupScripts'
import type { BackupFacts, BackupFile, BackupLastResult } from '@/utils/server/databases/types'
import { Label } from '@/components/server/kit'
import { cn } from '@/utils/cn'

const SHOWN = 5

interface Props {
  backups: BackupFacts
  files: BackupFile[]
  downloading: string | null
  onSettings(): void
  onRestore(file?: string): void
  onDownload(file: string): void
}

const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

function lastText(last: BackupLastResult | null): { text: string; failed: boolean } {
  if (!last) return { text: 'no nightly run yet', failed: false }
  const when = new Date(last.at).toLocaleString()
  if (last.ok) return { text: `last: ${when} · ${last.saved} saved · ok`, failed: false }
  return { text: `last: ${when} · failed${last.note ? ` (${last.note.replace(/ /g, ', ')})` : ''}`, failed: true }
}

function FileRow({ file, downloading, onRestore, onDownload }: { file: BackupFile; downloading: boolean; onRestore(): void; onDownload(): void }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 rounded-[10px] px-2 py-1.5 hover:bg-nd-surface-hover">
      <span className="truncate font-mono text-xs text-nd-text-primary">{fileName(file.path)}</span>
      <span className="text-xs text-nd-text-muted">{new Date(file.modifiedAt).toLocaleString()}</span>
      <span className="w-16 text-right font-mono text-xs text-nd-text-muted">{formatFileSize(file.sizeBytes)}</span>
      <span className="flex gap-1">
        <Button size="sm" variant="secondary" onClick={onRestore}>Restore…</Button>
        <Button size="sm" variant="ghost" aria-label={`Download ${fileName(file.path)} to this PC`} title="Download to this PC" disabled={downloading} onClick={onDownload}>
          {downloading ? <Spinner size="sm" /> : <Download size={13} />}
        </Button>
      </span>
    </div>
  )
}

export function BackupsCard({ backups, files, downloading, onSettings, onRestore, onDownload }: Props) {
  const [showAll, setShowAll] = useState(false)
  const last = lastText(backups.last)
  const shown = showAll ? files : files.slice(0, SHOWN)
  return (
    <section aria-label="Backups" className="flex flex-col gap-3 rounded-xl border border-nd-border bg-nd-surface p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Label>Backups</Label>
        <span className="text-[13px] text-nd-text-secondary">
          {backups.schedule ? `Nightly dump of every database at ${scheduleLabel(backups.schedule)} · keeps ${backups.schedule.keepDays} days · ` : 'Not scheduled · '}
          <span className="font-mono text-xs">{BACKUP_DIR}</span>
        </span>
        <span className={cn('text-xs', last.failed ? 'text-nd-error-fg' : 'text-nd-text-muted')}>{last.text}</span>
        <div className="flex-1" />
        <Button size="sm" variant="secondary" disabled={files.length === 0} onClick={() => onRestore()}>Restore…</Button>
        <Button size="sm" variant={backups.schedule ? 'secondary' : 'primary'} onClick={onSettings}>{backups.schedule ? 'Settings' : 'Schedule backups'}</Button>
      </div>
      {files.length > 0 && (
        <div className="flex flex-col">
          {shown.map((file) => (
            <FileRow key={file.path} file={file} downloading={downloading === file.path} onRestore={() => onRestore(file.path)} onDownload={() => onDownload(file.path)} />
          ))}
          {files.length > SHOWN && (
            <button type="button" onClick={() => setShowAll(!showAll)} className="self-start px-2 pt-1 text-xs text-nd-accent hover:underline">
              {showAll ? 'Show fewer' : `Show all ${files.length}`}
            </button>
          )}
          <p className="px-2 pt-2 text-xs text-nd-text-muted">
            Backups can only be read by root. Download copies the file to a private temporary file in your home folder on the server, saves it to this PC, then deletes the copy.
          </p>
        </div>
      )}
    </section>
  )
}
